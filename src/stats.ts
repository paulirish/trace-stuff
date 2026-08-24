import type {
  TrialVariant,
  RawTrialObservation,
  CalibrationSummary,
  MetricObjectiveResult,
  OutcomeStatus,
} from './types.ts';

export function createSeededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateBlockOrder(blockCount: number, seed: number): TrialVariant[][] {
  const rand = createSeededRandom(seed);
  const blocks: TrialVariant[][] = [];
  for (let i = 0; i < blockCount; i++) {
    if (rand() < 0.5) {
      blocks.push(['A', 'B', 'B', 'A']);
    } else {
      blocks.push(['B', 'A', 'A', 'B']);
    }
  }
  return blocks;
}

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

export function calculateStdDev(values: number[]): number {
  if (values.length <= 1) return 0;
  const mean = calculateMean(values);
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function computeBlockDeltas(trials: RawTrialObservation[]): number[] {
  const validTrials = trials.filter((t) => t.valid);
  const blockIndices = Array.from(new Set(validTrials.map((t) => t.blockIndex))).sort((a, b) => a - b);
  const blockDeltas: number[] = [];

  for (const bIdx of blockIndices) {
    const blockTrials = validTrials.filter((t) => t.blockIndex === bIdx);
    const candScores = blockTrials.filter((t) => t.variant === 'B').map((t) => t.durationMs);
    const baseScores = blockTrials.filter((t) => t.variant === 'A').map((t) => t.durationMs);

    if (candScores.length > 0 && baseScores.length > 0) {
      const meanLogCand = calculateMean(candScores.map((s) => Math.log(Math.max(s, 0.001))));
      const meanLogBase = calculateMean(baseScores.map((s) => Math.log(Math.max(s, 0.001))));
      blockDeltas.push(meanLogCand - meanLogBase);
    }
  }

  return blockDeltas;
}

export function computeAACalibration(aaTrials: RawTrialObservation[]): CalibrationSummary {
  const deltas = computeBlockDeltas(aaTrials);
  const std = calculateStdDev(deltas);
  const n = Math.max(deltas.length, 1);
  const tCrit = 2.0;
  const mdeLog = (tCrit * std) / Math.sqrt(n);
  const estimatedDetectableEffect = Math.expm1(mdeLog);

  return {
    estimatedDetectableEffect: Math.abs(estimatedDetectableEffect),
    aaPassed: Math.abs(estimatedDetectableEffect) < 0.10,
    blockCount: n,
    trialsPerBlock: 4,
    sampleTimeSeconds: Math.round((aaTrials.length * 2000) / 1000),
  };
}

export function evaluateExperimentOutcome(
  trials: RawTrialObservation[],
  practicalThreshold: number,
  calibration: CalibrationSummary,
  guardrailsPassed: boolean
): { outcome: OutcomeStatus; objective: MetricObjectiveResult; reason?: string } {
  const validTrials = trials.filter((t) => t.valid);
  if (validTrials.length === 0) {
    return {
      outcome: 'INVALID',
      reason: 'No valid trial observations recorded.',
      objective: {
        name: 'input-to-correct-frame',
        direction: 'lower-is-better',
        baselineMedianMs: 0,
        candidateMedianMs: 0,
        relativeChange: 0,
        confidenceInterval: [0, 0],
      },
    };
  }

  const baseDurations = validTrials.filter((t) => t.variant === 'A').map((t) => t.durationMs);
  const candDurations = validTrials.filter((t) => t.variant === 'B').map((t) => t.durationMs);

  const baseMedian = calculateMedian(baseDurations);
  const candMedian = calculateMedian(candDurations);

  const deltas = computeBlockDeltas(validTrials);
  const meanDelta = calculateMean(deltas);
  const stdDelta = calculateStdDev(deltas);
  const n = Math.max(deltas.length, 1);
  const effectiveStd = stdDelta > 0 ? stdDelta : Math.max(calibration.estimatedDetectableEffect, 0.005);
  const stderr = effectiveStd / Math.sqrt(n);
  const tCrit = 2.0;

  const ciLowerLog = meanDelta - tCrit * stderr;
  const ciUpperLog = meanDelta + tCrit * stderr;

  const relativeChange = Math.expm1(meanDelta);
  const ciLower = Math.expm1(ciLowerLog);
  const ciUpper = Math.expm1(ciUpperLog);

  const objective: MetricObjectiveResult = {
    name: 'input-to-correct-frame',
    direction: 'lower-is-better',
    baselineMedianMs: Math.round(baseMedian * 10) / 10,
    candidateMedianMs: Math.round(candMedian * 10) / 10,
    relativeChange: Math.round(relativeChange * 10000) / 10000,
    confidenceInterval: [Math.round(ciLower * 10000) / 10000, Math.round(ciUpper * 10000) / 10000],
  };

  if (!guardrailsPassed) {
    return {
      outcome: 'REJECT',
      reason: 'Guardrail check or correctness probe failed.',
      objective,
    };
  }

  if (relativeChange > 0.01 && ciLower > 0) {
    return {
      outcome: 'REJECT',
      reason: `Statistically significant performance regression detected: +${(relativeChange * 100).toFixed(2)}%.`,
      objective,
    };
  }

  if (calibration.estimatedDetectableEffect > practicalThreshold * 2) {
    return {
      outcome: 'INCONCLUSIVE',
      reason: `Environment noise floor (${(calibration.estimatedDetectableEffect * 100).toFixed(1)}%) exceeds target sensitivity (${(practicalThreshold * 100).toFixed(1)}%).`,
      objective,
    };
  }

  if (relativeChange <= -practicalThreshold && ciUpper < 0) {
    return {
      outcome: 'ACCEPT',
      reason: `Candidate produced a real, statistically sound performance improvement of ${Math.abs(relativeChange * 100).toFixed(2)}%.`,
      objective,
    };
  }

  return {
    outcome: 'INCONCLUSIVE',
    reason: `Interval [${(ciLower * 100).toFixed(2)}%, ${(ciUpper * 100).toFixed(2)}%] includes both target improvement and no effect.`,
    objective,
  };
}
