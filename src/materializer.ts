import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MaterializedVariant {
  revision: string;
  commitHash: string;
  worktreePath: string;
  artifactPath: string;
  buildDurationMs: number;
  artifactHash: string;
  lockfileHash: string;
  stdout: string;
  stderr: string;
}

export class VariantMaterializer {
  private baseDir: string;

  constructor(baseDir: string = path.join(process.cwd(), '.tmp-worktrees')) {
    this.baseDir = baseDir;
  }

  public async materialize(
    revision: string,
    buildCommand: string,
    outputSubdir: string
  ): Promise<MaterializedVariant> {
    await fs.mkdir(this.baseDir, { recursive: true });

    let commitHash = revision;
    let isGitRev = false;

    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', '--verify', `${revision}^{commit}`]);
      commitHash = stdout.trim();
      isGitRev = true;
    } catch {
      // Not a valid git commit/ref
    }

    const sanitizedRev = revision.replace(/[^a-zA-Z0-9_-]/g, '_');
    const worktreePath = path.join(this.baseDir, `wt-${sanitizedRev}-${Date.now()}`);
    await fs.mkdir(worktreePath, { recursive: true });

    if (isGitRev) {
      const archiveTarPath = path.join(this.baseDir, `archive-${sanitizedRev}-${Date.now()}.tar`);
      await execFileAsync('git', ['archive', '--format=tar', '-o', archiveTarPath, commitHash]);
      await execFileAsync('tar', ['-xf', archiveTarPath, '-C', worktreePath]);
      await fs.rm(archiveTarPath, { force: true });
    } else {
      let sourceDir = process.cwd();
      if (await this.pathExists(revision)) {
        sourceDir = path.resolve(revision);
      }
      await this.copyDirectory(sourceDir, worktreePath);
    }

    const lockfileHash = await this.computeLockfileHash(worktreePath);

    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    if (buildCommand && buildCommand.trim() !== '') {
      const parts = buildCommand.trim().split(/\s+/);
      const cmd = parts[0];
      const args = parts.slice(1);
      const res = await execFileAsync(cmd, args, { cwd: worktreePath });
      stdout = res.stdout;
      stderr = res.stderr;
    }
    const buildDurationMs = Date.now() - startTime;

    const artifactPath = outputSubdir && outputSubdir !== '.' ? path.join(worktreePath, outputSubdir) : worktreePath;
    const artifactHash = await this.computeDirectoryHash(artifactPath);

    return {
      revision,
      commitHash,
      worktreePath,
      artifactPath,
      buildDurationMs,
      artifactHash,
      lockfileHash,
      stdout,
      stderr,
    };
  }

  public async cleanup(variant: MaterializedVariant): Promise<void> {
    try {
      await fs.rm(variant.worktreePath, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.stat(p);
      return true;
    } catch {
      return false;
    }
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.tmp-worktrees' ||
        entry.name === '.tmp-test-ledger' ||
        entry.name === '.perf-campaigns'
      ) {
        continue;
      }
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async computeLockfileHash(dirPath: string): Promise<string> {
    const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
    const hash = crypto.createHash('sha256');

    for (const file of lockfiles) {
      const fullPath = path.join(dirPath, file);
      if (await this.pathExists(fullPath)) {
        const content = await fs.readFile(fullPath);
        hash.update(content);
      }
    }
    return hash.digest('hex');
  }

  private async computeDirectoryHash(dirPath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    if (!(await this.pathExists(dirPath))) {
      return hash.digest('hex');
    }

    const files = await this.getAllFilesSorted(dirPath);
    for (const file of files) {
      const content = await fs.readFile(file);
      hash.update(path.relative(dirPath, file));
      hash.update(content);
    }
    return hash.digest('hex');
  }

  private async getAllFilesSorted(dirPath: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        results.push(...(await this.getAllFilesSorted(full)));
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
    return results.sort();
  }
}
