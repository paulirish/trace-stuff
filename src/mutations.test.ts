import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { DeterministicOriginProxy } from './proxy.ts';
import { BrowserDriver } from './browser.ts';
import { evaluateExperimentOutcome, generateBlockOrder } from './stats.ts';
import {
  compareDOMStructures,
  verifyPostCompletionHorizon,
  evaluateGuardrails,
} from './guardrails.ts';
import { publicGridScenario } from './scenarios/grid.ts';
import type { DefaultBrowserPolicy, RawTrialObservation } from './types.ts';

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

test('Proving App Mutation 1: Large real win returns ACCEPT', async () => {
  const appDir = path.join(process.cwd(), 'proving-app');

  const proxy = new DeterministicOriginProxy();
  proxy.setVariants(appDir, appDir);
  const port = await proxy.start();

  try {
    const trials: RawTrialObservation[] = [];
    const blockOrder = generateBlockOrder(2, 101);

    let trialIdx = 0;
    for (let b = 0; b < blockOrder.length; b++) {
      for (const variant of blockOrder[b]) {
        proxy.setActiveVariant(variant);
        const mutationParam = variant === 'A' ? '1_baseline' : '0';

        const driver = new BrowserDriver();
        await driver.launch({ policy: defaultPolicy, url: `http://127.0.0.1:${port}/index.html?mutation=${mutationParam}` });

        await driver.navigate(`http://127.0.0.1:${port}/index.html?mutation=${mutationParam}`);
        await driver.waitForSemanticState('grid-ready');

        const stimStartUs = await driver.getMonotonicTimeUs();
        await publicGridScenario.stimulate(driver);
        const completionUs = await driver.waitForCompletion(publicGridScenario.completion);

        const durationMs = (completionUs - stimStartUs) / 1000;

        trials.push({
          trialIndex: trialIdx++,
          variant,
          blockIndex: b,
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
    }

    const calibration = { estimatedDetectableEffect: 0.016, aaPassed: true, blockCount: 2, trialsPerBlock: 4, sampleTimeSeconds: 10 };
    const result = evaluateExperimentOutcome(trials, 0.02, calibration, true);

    assert.equal(result.outcome, 'ACCEPT');
    assert.ok(result.objective.relativeChange < -0.02);
  } finally {
    await proxy.stop();
  }
});

test('Proving App Mutation 3: Visual cheat returns REJECT', async () => {
  const appDir = path.join(process.cwd(), 'proving-app');

  const proxy = new DeterministicOriginProxy();
  proxy.setVariants(appDir, appDir);
  const port = await proxy.start();

  try {
    const driverA = new BrowserDriver();
    await driverA.launch({ policy: defaultPolicy, url: `http://127.0.0.1:${port}/index.html?mutation=0` });
    await driverA.navigate(`http://127.0.0.1:${port}/index.html?mutation=0`);
    await driverA.waitForSemanticState('grid-ready');
    await publicGridScenario.stimulate(driverA);
    await driverA.waitForCompletion(publicGridScenario.completion);
    const domA = await driverA.getDOMSnapshot();
    await driverA.close();

    const driverB = new BrowserDriver();
    await driverB.launch({ policy: defaultPolicy, url: `http://127.0.0.1:${port}/index.html?mutation=3` });
    await driverB.navigate(`http://127.0.0.1:${port}/index.html?mutation=3`);
    await driverB.waitForSemanticState('grid-ready');
    await publicGridScenario.stimulate(driverB);
    await driverB.waitForCompletion(publicGridScenario.completion);
    const domB = await driverB.getDOMSnapshot();
    await driverB.close();

    const domCheck = compareDOMStructures(domA, domB);
    assert.equal(domCheck.match, false);

    const guardrails = evaluateGuardrails(true, domCheck.match, true, true, true, true);
    assert.equal(guardrails.allPassed, false);
  } finally {
    await proxy.stop();
  }
});

test('Proving App Mutation 4: Deferred work cheat returns REJECT', async () => {
  const trials: RawTrialObservation[] = [
    { trialIndex: 0, variant: 'A', blockIndex: 0, stimulusStartUs: 0, completionUs: 100000, durationMs: 100, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
    { trialIndex: 1, variant: 'B', blockIndex: 0, stimulusStartUs: 0, completionUs: 80000, durationMs: 80, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 250 },
  ];

  const postComp = verifyPostCompletionHorizon(trials, 200);
  assert.equal(postComp.pass, false);

  const guardrails = evaluateGuardrails(true, true, true, true, true, postComp.pass);
  assert.equal(guardrails.allPassed, false);
});
