import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateBlockOrder,
  evaluateExperimentOutcome,
} from './stats.ts';
import type { RawTrialObservation } from './types.ts';

test('generateBlockOrder generates deterministic symmetric blocks from seed', () => {
  const blocks1 = generateBlockOrder(4, 42);
  const blocks2 = generateBlockOrder(4, 42);
  assert.deepEqual(blocks1, blocks2);
  assert.equal(blocks1.length, 4);
  assert.equal(blocks1[0].length, 4);
});

test('evaluateExperimentOutcome detects real win (ACCEPT)', () => {
  const trials: RawTrialObservation[] = [];
  for (let b = 0; b < 4; b++) {
    trials.push(
      { trialIndex: b * 4, variant: 'A', blockIndex: b, stimulusStartUs: 0, completionUs: 100000, durationMs: 100, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
      { trialIndex: b * 4 + 1, variant: 'B', blockIndex: b, stimulusStartUs: 0, completionUs: 90000, durationMs: 90, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
      { trialIndex: b * 4 + 2, variant: 'B', blockIndex: b, stimulusStartUs: 0, completionUs: 90000, durationMs: 90, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
      { trialIndex: b * 4 + 3, variant: 'A', blockIndex: b, stimulusStartUs: 0, completionUs: 100000, durationMs: 100, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 }
    );
  }

  const calibration = { estimatedDetectableEffect: 0.01, aaPassed: true, blockCount: 4, trialsPerBlock: 4, sampleTimeSeconds: 30 };
  const result = evaluateExperimentOutcome(trials, 0.02, calibration, true);

  assert.equal(result.outcome, 'ACCEPT');
  assert.ok(result.objective.relativeChange < -0.05);
});

test('evaluateExperimentOutcome detects regression (REJECT)', () => {
  const trials: RawTrialObservation[] = [];
  for (let b = 0; b < 4; b++) {
    trials.push(
      { trialIndex: b * 4, variant: 'A', blockIndex: b, stimulusStartUs: 0, completionUs: 100000, durationMs: 100, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
      { trialIndex: b * 4 + 1, variant: 'B', blockIndex: b, stimulusStartUs: 0, completionUs: 115000, durationMs: 115, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
      { trialIndex: b * 4 + 2, variant: 'B', blockIndex: b, stimulusStartUs: 0, completionUs: 115000, durationMs: 115, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 },
      { trialIndex: b * 4 + 3, variant: 'A', blockIndex: b, stimulusStartUs: 0, completionUs: 100000, durationMs: 100, valid: true, bytesTransferred: 0, requestCount: 1, mainThreadCpuTimeMs: 10, longTaskCount: 0, postCompletionActivityMs: 0 }
    );
  }

  const calibration = { estimatedDetectableEffect: 0.01, aaPassed: true, blockCount: 4, trialsPerBlock: 4, sampleTimeSeconds: 30 };
  const result = evaluateExperimentOutcome(trials, 0.02, calibration, true);

  assert.equal(result.outcome, 'REJECT');
});
