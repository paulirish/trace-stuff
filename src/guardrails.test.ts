import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareScreenshots,
  compareDOMStructures,
  verifyBundleAndDeliveryConstraints,
} from './guardrails.ts';

test('compareScreenshots detects identical vs different buffers', () => {
  const buf1 = Buffer.from('png-data-1');
  const buf2 = Buffer.from('png-data-1');
  const buf3 = Buffer.from('png-data-2');

  assert.equal(compareScreenshots(buf1, buf2).match, true);
  assert.equal(compareScreenshots(buf1, buf3).match, false);
});

test('compareDOMStructures detects structural changes', () => {
  const dom1 = { tagName: 'div', children: [{ tagName: 'span', children: [] }] };
  const dom2 = { tagName: 'div', children: [{ tagName: 'span', children: [] }] };
  const dom3 = { tagName: 'div', children: [] };

  assert.equal(compareDOMStructures(dom1, dom2).match, true);
  assert.equal(compareDOMStructures(dom1, dom3).match, false);
});

test('verifyBundleAndDeliveryConstraints catches excessive bundle size increase', () => {
  const baseNet = { requestCount: 1, encodedResponseBytes: 1000, decodedResponseBytes: 1000, htmlBytes: 200, jsBytes: 800, cssBytes: 0, externalRequestCount: 0 };
  const candNet1 = { requestCount: 1, encodedResponseBytes: 1050, decodedResponseBytes: 1050, htmlBytes: 200, jsBytes: 850, cssBytes: 0, externalRequestCount: 0 };
  const candNet2 = { requestCount: 1, encodedResponseBytes: 10000, decodedResponseBytes: 10000, htmlBytes: 200, jsBytes: 9800, cssBytes: 0, externalRequestCount: 0 };

  assert.equal(verifyBundleAndDeliveryConstraints(baseNet, candNet1).pass, true);
  assert.equal(verifyBundleAndDeliveryConstraints(baseNet, candNet2).pass, false);
});
