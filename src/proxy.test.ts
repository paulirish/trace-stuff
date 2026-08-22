import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DeterministicOriginProxy } from './proxy.ts';

test('DeterministicOriginProxy serves static files and records network metrics', async () => {
  const tmpDirA = path.join(process.cwd(), '.tmp-proxy-a');
  const tmpDirB = path.join(process.cwd(), '.tmp-proxy-b');

  await fs.mkdir(tmpDirA, { recursive: true });
  await fs.mkdir(tmpDirB, { recursive: true });

  await fs.writeFile(path.join(tmpDirA, 'index.html'), '<html><body>Variant A</body></html>', 'utf-8');
  await fs.writeFile(path.join(tmpDirB, 'index.html'), '<html><body>Variant B</body></html>', 'utf-8');

  const proxy = new DeterministicOriginProxy();
  proxy.setVariants(tmpDirA, tmpDirB);
  const port = await proxy.start();

  try {
    proxy.setActiveVariant('A');
    proxy.resetMetrics();

    const bodyA = await fetchText(`http://127.0.0.1:${port}/index.html`);
    assert.equal(bodyA, '<html><body>Variant A</body></html>');

    const metricsA = proxy.getNetworkSummary();
    assert.equal(metricsA.requestCount, 1);
    assert.equal(metricsA.htmlBytes, Buffer.from('<html><body>Variant A</body></html>').byteLength);

    proxy.setActiveVariant('B');
    proxy.resetMetrics();

    const bodyB = await fetchText(`http://127.0.0.1:${port}/index.html`);
    assert.equal(bodyB, '<html><body>Variant B</body></html>');

    const metricsB = proxy.getNetworkSummary();
    assert.equal(metricsB.requestCount, 1);
    assert.equal(metricsB.htmlBytes, Buffer.from('<html><body>Variant B</body></html>').byteLength);
  } finally {
    await proxy.stop();
    await fs.rm(tmpDirA, { recursive: true, force: true });
    await fs.rm(tmpDirB, { recursive: true, force: true });
  }
});

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
  });
}
