#!/usr/bin/env node

import * as fs from 'node:fs/promises';
import { runCompare } from '../runner.ts';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'compare') {
    console.log(`Usage: perf-experiment compare --baseline <rev> --candidate <rev> [--campaign <id>] [--out <file>]`);
    process.exit(1);
  }

  let baseline = 'HEAD~1';
  let candidate = 'HEAD';
  let campaign = 'default-campaign';
  let experimentPath: string | undefined;
  let outFile: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--baseline' && i + 1 < args.length) {
      baseline = args[++i];
    } else if (arg === '--candidate' && i + 1 < args.length) {
      candidate = args[++i];
    } else if (arg === '--campaign' && i + 1 < args.length) {
      campaign = args[++i];
    } else if (arg === '--experiment' && i + 1 < args.length) {
      experimentPath = args[++i];
    } else if (arg === '--out' && i + 1 < args.length) {
      outFile = args[++i];
    }
  }

  try {
    const outcome = await runCompare({
      baseline,
      candidate,
      campaignId: campaign,
      experimentPath,
    });

    const jsonOutput = JSON.stringify(outcome, null, 2);
    console.log(jsonOutput);

    if (outFile) {
      await fs.writeFile(outFile, jsonOutput, 'utf-8');
    }

    if (outcome.status === 'REJECT') {
      process.exit(1);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('Error executing comparison:', errorMsg);
    process.exit(1);
  }
}

main();
