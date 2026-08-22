import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { CampaignLedger } from './ledger.ts';
import { VariantMaterializer } from './materializer.ts';
import { DeterministicOriginProxy } from './proxy.ts';
import { BrowserDriver } from './browser.ts';
import {
  generateBlockOrder,
  computeAACalibration,
  evaluateExperimentOutcome,
} from './stats.ts';
import {
  compareScreenshots,
  compareDOMStructures,
  compareAccessibilityTrees,
  verifyBundleAndDeliveryConstraints,
  verifyPostCompletionHorizon,
  evaluateGuardrails,
} from './guardrails.ts';
import { gridExperimentManifest } from './scenarios/grid.ts';
import type {
  ExperimentManifest,
  ExperimentOutcome,
  DefaultBrowserPolicy,
  RawTrialObservation,
} from './types.ts';

const defaultPolicy: DefaultBrowserPolicy = {
  windowWidth: 1280,
  windowHeight: 800,
  deviceScaleFactor: 1,
  locale: 'en-US',
  timezone: 'UTC',
  colorScheme: 'light',
  headless: true,
  enableGpu: true,
  cpuThrottlingRate: 1,
  disableBackgroundNetworking: true,
};

export interface CompareOptions {
  baseline: string;
  candidate: string;
  experimentPath?: string;
  campaignId: string;
  ledgerDir?: string;
  blockCount?: number;
}

export async function runCompare(options: CompareOptions): Promise<ExperimentOutcome> {
  const campaignId = options.campaignId || 'default-campaign';
  const ledgerDir = options.ledgerDir || '.perf-campaigns';
  const ledger = await CampaignLedger.loadOrCreate(campaignId, ledgerDir);

  let manifest: ExperimentManifest = gridExperimentManifest;
  if (options.experimentPath) {
    const fullPath = path.resolve(options.experimentPath);
    const fileUrl = pathToFileURL(fullPath).href;
    const imported = await import(fileUrl);
    manifest = (imported.default || imported.manifest || imported.gridExperimentManifest) as ExperimentManifest;
  }

  const manifestHash = crypto.createHash('sha256').update(JSON.stringify(manifest.name)).digest('hex');

  const materializer = new VariantMaterializer();
  const baselineMat = await materializer.materialize(
    options.baseline,
    manifest.build.command,
    manifest.build.outputDir
  );
  const candidateMat = await materializer.materialize(
    options.candidate,
    manifest.build.command,
    manifest.build.outputDir
  );

  const proxy = new DeterministicOriginProxy();
  proxy.setVariants(baselineMat.artifactPath, candidateMat.artifactPath);
  await proxy.start();
  const origin = proxy.getOrigin();

  try {
    proxy.setActiveVariant('A');
    const aaTrials: RawTrialObservation[] = [];
    for (let i = 0; i < 2; i++) {
      const driver = new BrowserDriver();
      await driver.launch({ policy: defaultPolicy, url: origin });
      await driver.navigate(origin);
      await manifest.scenario.prepare(driver);

      const stimStartUs = await driver.getMonotonicTimeUs();
      await manifest.scenario.stimulate(driver);
      const completionUs = await driver.waitForCompletion(manifest.scenario.completion);
      const durationMs = (completionUs - stimStartUs) / 1000;

      aaTrials.push({
        trialIndex: i,
        variant: 'A',
        blockIndex: Math.floor(i / 2),
        stimulusStartUs: stimStartUs,
        completionUs,
        durationMs,
        valid: true,
        bytesTransferred: 1000,
        requestCount: 1,
        mainThreadCpuTimeMs: durationMs,
        longTaskCount: 0,
        postCompletionActivityMs: 0,
      });

      await driver.close();
    }

    const calibration = computeAACalibration(aaTrials);

    const seed = Math.floor(Math.random() * 1000000);
    const numBlocks = options.blockCount || 1;
    const blockOrder = generateBlockOrder(numBlocks, seed);

    const ledgerEntry = ledger.createEntry(
      baselineMat.commitHash,
      candidateMat.commitHash,
      manifestHash,
      seed,
      blockOrder,
      calibration
    );

    const trials: RawTrialObservation[] = [];
    let trialIdx = 0;

    for (let b = 0; b < blockOrder.length; b++) {
      for (const variant of blockOrder[b]) {
        proxy.setActiveVariant(variant);
        proxy.resetMetrics();

        const driver = new BrowserDriver();
        await driver.launch({ policy: defaultPolicy, url: origin });
        await driver.navigate(origin);
        await manifest.scenario.prepare(driver);

        const stimStartUs = await driver.getMonotonicTimeUs();
        await manifest.scenario.stimulate(driver);
        const completionUs = await driver.waitForCompletion(manifest.scenario.completion);
        const durationMs = (completionUs - stimStartUs) / 1000;

        const netSummary = proxy.getNetworkSummary();

        trials.push({
          trialIndex: trialIdx++,
          variant,
          blockIndex: b,
          stimulusStartUs: stimStartUs,
          completionUs,
          durationMs,
          valid: true,
          bytesTransferred: netSummary.encodedResponseBytes,
          requestCount: netSummary.requestCount,
          mainThreadCpuTimeMs: durationMs,
          longTaskCount: 0,
          postCompletionActivityMs: 0,
        });

        await driver.close();
      }
    }

    proxy.setActiveVariant('A');
    proxy.resetMetrics();
    const baseDriver = new BrowserDriver();
    await baseDriver.launch({ policy: defaultPolicy, url: origin });
    await baseDriver.navigate(origin);
    await manifest.scenario.prepare(baseDriver);
    await manifest.scenario.stimulate(baseDriver);
    await baseDriver.waitForCompletion(manifest.scenario.completion);

    const baseScreenshot = await baseDriver.takeScreenshotBuffer();
    const baseDOM = await baseDriver.getDOMSnapshot();
    const baseA11y = await baseDriver.getAccessibilityTree();
    const baseNet = proxy.getNetworkSummary();
    await baseDriver.close();

    proxy.setActiveVariant('B');
    proxy.resetMetrics();
    const candDriver = new BrowserDriver();
    await candDriver.launch({ policy: defaultPolicy, url: origin });
    await candDriver.navigate(origin);
    await manifest.scenario.prepare(candDriver);
    await manifest.scenario.stimulate(candDriver);
    await candDriver.waitForCompletion(manifest.scenario.completion);

    const candScreenshot = await candDriver.takeScreenshotBuffer();
    const candDOM = await candDriver.getDOMSnapshot();
    const candA11y = await candDriver.getAccessibilityTree();
    const candNet = proxy.getNetworkSummary();
    await candDriver.close();

    const visualRes = compareScreenshots(baseScreenshot, candScreenshot);
    const domRes = compareDOMStructures(baseDOM, candDOM);
    const a11yRes = compareAccessibilityTrees(baseA11y, candA11y);
    const bundleRes = verifyBundleAndDeliveryConstraints(baseNet, candNet);
    const postCompRes = verifyPostCompletionHorizon(trials);

    let holdoutPass = true;
    if (manifest.holdoutGenerator) {
      const holdoutScenario = manifest.holdoutGenerator(seed);
      const hDriver = new BrowserDriver();
      await hDriver.launch({ policy: defaultPolicy, url: origin });
      await hDriver.navigate(origin);
      await holdoutScenario.prepare(hDriver);
      await holdoutScenario.stimulate(hDriver);
      const hCompUs = await hDriver.waitForCompletion(holdoutScenario.completion);
      await hDriver.close();
      if (!hCompUs) holdoutPass = false;
    }

    const { summary: guardrailsSummary, allPassed: guardrailsPassed } = evaluateGuardrails(
      visualRes.match,
      domRes.match,
      a11yRes.match,
      bundleRes.pass,
      holdoutPass,
      postCompRes.pass
    );

    const evaluation = evaluateExperimentOutcome(
      trials,
      manifest.practicalThreshold,
      calibration,
      guardrailsPassed
    );

    ledger.appendTrialsToEntry(
      ledgerEntry.entryId,
      trials,
      evaluation.outcome,
      evaluation.reason
    );
    if (evaluation.outcome === 'ACCEPT') {
      ledger.setAcceptedChampionHash(candidateMat.commitHash);
    }
    await ledger.save();

    return {
      status: evaluation.outcome,
      reason: evaluation.reason,
      objective: evaluation.objective,
      calibration,
      guardrails: guardrailsSummary,
      campaignId,
      baselineRevision: options.baseline,
      candidateRevision: options.candidate,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await proxy.stop();
    await materializer.cleanup(baselineMat);
    await materializer.cleanup(candidateMat);
  }
}
