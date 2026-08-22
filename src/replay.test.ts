import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NetworkRecordReplayer } from './replay.ts';
import { DeterministicOriginProxy } from './proxy.ts';

test('NetworkRecordReplayer records and replays responses', async () => {
  const tmpDir = path.join(process.cwd(), '.tmp-replay-test');
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(path.join(tmpDir, 'index.html'), '<h1>Network Replay App</h1>', 'utf-8');

  const proxy = new DeterministicOriginProxy();
  proxy.setVariants(tmpDir, tmpDir);
  const port = await proxy.start();

  try {
    proxy.setReplayMode('record');
    const res1 = await fetch(`http://127.0.0.1:${port}/index.html`);
    const text1 = await res1.text();
    assert.equal(text1, '<h1>Network Replay App</h1>');

    const archivePath = path.join(tmpDir, 'archive.json');
    await proxy.getReplayer().saveArchive(archivePath);

    const replayer = new NetworkRecordReplayer('replay');
    await replayer.loadArchive(archivePath);

    const match = replayer.findResponse('GET', '/index.html');
    assert.ok(match);
    assert.equal(Buffer.from(match.bodyBase64, 'base64').toString('utf-8'), '<h1>Network Replay App</h1>');
  } finally {
    await proxy.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
