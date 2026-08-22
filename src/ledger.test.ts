import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { CampaignLedger } from './ledger.ts';

test('CampaignLedger loads, creates, and appends entries', async () => {
  const tmpDir = path.join(process.cwd(), '.tmp-test-ledger');
  await fs.mkdir(tmpDir, { recursive: true });

  try {
    const ledger = await CampaignLedger.loadOrCreate('test-campaign', tmpDir);
    assert.equal(ledger.getEntries().length, 0);

    const calibration = {
      estimatedDetectableEffect: 0.016,
      aaPassed: true,
      blockCount: 4,
      trialsPerBlock: 4,
      sampleTimeSeconds: 30,
    };

    const entry = ledger.createEntry('base1', 'cand1', 'manifest1', 12345, [['A', 'B', 'B', 'A']], calibration);
    assert.equal(entry.baselineHash, 'base1');

    ledger.appendTrialsToEntry(
      entry.entryId,
      [
        {
          trialIndex: 0,
          variant: 'A',
          blockIndex: 0,
          stimulusStartUs: 1000,
          completionUs: 2000,
          durationMs: 100,
          valid: true,
          bytesTransferred: 500,
          requestCount: 2,
          mainThreadCpuTimeMs: 10,
          longTaskCount: 0,
          postCompletionActivityMs: 0,
        },
      ],
      'ACCEPT'
    );

    await ledger.save();

    const reloaded = await CampaignLedger.loadOrCreate('test-campaign', tmpDir);
    assert.equal(reloaded.getEntries().length, 1);
    assert.equal(reloaded.getEntries()[0].trials.length, 1);
    assert.equal(reloaded.getEntries()[0].outcome, 'ACCEPT');
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
