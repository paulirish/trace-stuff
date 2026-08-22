import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DeterministicOriginProxy } from './proxy.ts';
import { BrowserDriver } from './browser.ts';
import type { DefaultBrowserPolicy } from './types.ts';

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

test('BrowserDriver handles navigation, virtual time rules, and snapshot collection', async () => {
  const tmpDir = path.join(process.cwd(), '.tmp-browser-test');
  await fs.mkdir(tmpDir, { recursive: true });

  const html = `<!DOCTYPE html>
<html>
<body>
  <div id="root">
    <input id="filter" data-testid="grid-filter" type="text" />
    <div id="results" data-testid="visible-row-count">0 results</div>
  </div>
  <script>
    window.__SEMANTIC_STATE__ = 'ready';
    const input = document.getElementById('filter');
    input.addEventListener('input', () => {
      document.getElementById('results').textContent = input.value === 'performance' ? '137 results' : '0 results';
    });
  </script>
</body>
</html>`;

  await fs.writeFile(path.join(tmpDir, 'index.html'), html, 'utf-8');

  const proxy = new DeterministicOriginProxy();
  proxy.setVariants(tmpDir, tmpDir);
  const port = await proxy.start();

  const driver = new BrowserDriver();

  try {
    await driver.launch({
      policy: defaultPolicy,
      url: `http://127.0.0.1:${port}/index.html`,
    });

    await driver.navigate(`http://127.0.0.1:${port}/index.html`);
    await driver.waitForSemanticState('ready');

    await driver.enableVirtualTime(100);
    assert.equal(driver.isVirtualTimeActive(), true);

    await driver.disableVirtualTime();
    assert.equal(driver.isVirtualTimeActive(), false);

    await driver.focus('#filter');
    await driver.typeTrusted('performance');

    const completionUs = await driver.waitForCompletion({
      selector: '[data-testid="visible-row-count"]',
      expectedText: '137 results',
    });
    assert.ok(completionUs > 0);

    const dom = await driver.getDOMSnapshot();
    assert.equal(dom.tagName, 'body');

    const screenshot = await driver.takeScreenshotBuffer();
    assert.ok(screenshot.length > 0);
  } finally {
    await driver.close();
    await proxy.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
