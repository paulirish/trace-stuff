import type {
  SerializedDOMNode,
  SerializedA11yNode,
  GuardrailsSummary,
  RawTrialObservation,
} from './types.ts';
import type { NetworkAccountingSummary } from './proxy.ts';

export function compareScreenshots(bufA: Buffer, bufB: Buffer): { match: boolean; diffPixels: number } {
  if (bufA.equals(bufB)) {
    return { match: true, diffPixels: 0 };
  }
  let diffCount = Math.abs(bufA.length - bufB.length);
  const minLen = Math.min(bufA.length, bufB.length);
  for (let i = 0; i < minLen; i++) {
    if (bufA[i] !== bufB[i]) {
      diffCount++;
    }
  }
  const match = diffCount === 0;
  return { match, diffPixels: diffCount };
}

export function compareDOMStructures(nodeA: SerializedDOMNode, nodeB: SerializedDOMNode): { match: boolean; diffCount: number } {
  let diffs = 0;

  if (nodeA.tagName !== nodeB.tagName) diffs++;
  if (nodeA.id !== nodeB.id) diffs++;
  if (nodeA.className !== nodeB.className) diffs++;
  if (nodeA.textContent !== nodeB.textContent) diffs++;

  const lenA = nodeA.children ? nodeA.children.length : 0;
  const lenB = nodeB.children ? nodeB.children.length : 0;
  diffs += Math.abs(lenA - lenB);

  const minLen = Math.min(lenA, lenB);
  for (let i = 0; i < minLen; i++) {
    const childRes = compareDOMStructures(nodeA.children[i], nodeB.children[i]);
    diffs += childRes.diffCount;
  }

  return { match: diffs === 0, diffCount: diffs };
}

export function compareAccessibilityTrees(treeA: SerializedA11yNode, treeB: SerializedA11yNode): { match: boolean; diffCount: number } {
  let diffs = 0;
  if (treeA.role !== treeB.role) diffs++;
  if (treeA.name !== treeB.name) diffs++;

  const lenA = treeA.children ? treeA.children.length : 0;
  const lenB = treeB.children ? treeB.children.length : 0;
  diffs += Math.abs(lenA - lenB);

  const minLen = Math.min(lenA, lenB);
  for (let i = 0; i < minLen; i++) {
    const res = compareAccessibilityTrees(treeA.children[i], treeB.children[i]);
    diffs += res.diffCount;
  }

  return { match: diffs === 0, diffCount: diffs };
}

export function verifyBundleAndDeliveryConstraints(
  baselineNet: NetworkAccountingSummary,
  candidateNet: NetworkAccountingSummary
): { pass: boolean; reason?: string } {
  if (candidateNet.externalRequestCount > baselineNet.externalRequestCount) {
    return { pass: false, reason: 'Candidate made unexpected external network requests.' };
  }

  if (candidateNet.jsBytes > baselineNet.jsBytes * 1.5 + 5000) {
    return { pass: false, reason: 'Candidate bundle size increased significantly (> 50%).' };
  }

  return { pass: true };
}

export function verifyPostCompletionHorizon(
  trials: RawTrialObservation[],
  maxPostActivityMs: number = 200
): { pass: boolean; reason?: string } {
  const candTrials = trials.filter((t) => t.variant === 'B' && t.valid);
  for (const t of candTrials) {
    if (t.postCompletionActivityMs > maxPostActivityMs) {
      return {
        pass: false,
        reason: `Deferred work detected: ${t.postCompletionActivityMs}ms activity after completion frame (max ${maxPostActivityMs}ms).`,
      };
    }
  }
  return { pass: true };
}

export function evaluateGuardrails(
  visualMatch: boolean,
  domMatch: boolean,
  a11yMatch: boolean,
  bundlePass: boolean,
  holdoutPass: boolean,
  postCompPass: boolean
): { summary: GuardrailsSummary; allPassed: boolean } {
  const summary: GuardrailsSummary = {
    visual: visualMatch ? 'pass' : 'fail',
    dom: domMatch ? 'pass' : 'fail',
    accessibility: a11yMatch ? 'pass' : 'fail',
    bundleBytes: bundlePass ? 'pass' : 'fail',
    holdout: holdoutPass ? 'pass' : 'fail',
    postCompletion: postCompPass ? 'pass' : 'fail',
  };

  const allPassed =
    visualMatch && domMatch && a11yMatch && bundlePass && holdoutPass && postCompPass;

  return { summary, allPassed };
}
