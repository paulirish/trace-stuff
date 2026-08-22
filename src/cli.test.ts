import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { runCompare } from './runner.ts';

test('End-to-end compare execution with proving app baseline vs candidate', async () => {
  const appDir = path.join(process.cwd(), 'proving-app');
  const ledgerDir = path.join(process.cwd(), '.tmp-e2e-ledger');

  try {
    const outcome = await runCompare({
      baseline: appDir,
      candidate: appDir,
      campaignId: 'e2e-test-campaign',
      ledgerDir,
      blockCount: 1,
    });

    assert.ok(outcome.timestamp);
    assert.equal(outcome.campaignId, 'e2e-test-campaign');
    assert.equal(outcome.guardrails.visual, 'pass');
    assert.equal(outcome.guardrails.dom, 'pass');
    assert.ok(outcome.objective.baselineMedianMs > 0);
  } finally {
    await fs.rm(ledgerDir, { recursive: true, force: true });
  }
});
