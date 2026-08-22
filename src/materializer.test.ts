import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { VariantMaterializer } from './materializer.ts';

test('VariantMaterializer copies directory, computes lockfile hash, and runs build command', async () => {
  const tmpSrc = path.join(process.cwd(), '.tmp-mat-src');
  await fs.mkdir(path.join(tmpSrc, 'dist'), { recursive: true });
  await fs.writeFile(path.join(tmpSrc, 'pnpm-lock.yaml'), 'lockfile-data', 'utf-8');
  await fs.writeFile(path.join(tmpSrc, 'dist', 'app.js'), 'console.log("built")', 'utf-8');

  const materializer = new VariantMaterializer(path.join(process.cwd(), '.tmp-mat-worktrees'));

  try {
    const materialized = await materializer.materialize(tmpSrc, '', 'dist');
    assert.ok(materialized.lockfileHash.length > 0);
    assert.ok(materialized.artifactHash.length > 0);
    assert.ok(await fs.stat(path.join(materialized.artifactPath, 'app.js')));

    await materializer.cleanup(materialized);
  } finally {
    await fs.rm(tmpSrc, { recursive: true, force: true });
    await fs.rm(path.join(process.cwd(), '.tmp-mat-worktrees'), { recursive: true, force: true });
  }
});
