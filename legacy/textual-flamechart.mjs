#!/usr/bin/env node

/**
 * Textual Flamechart
 *
 * Usage:
 *   ./textual-flamechart.mjs <input-trace.json> [output-file.txt] [options]
 *
 * Options:
 *   --limit=75        Target number of events to show (default: 75)
 *   --start=0         Start time in ms (relative to trace start)
 *   --end=Infinity    End time in ms (relative to trace start)
 *   --no-summary      Disable aggregate time summary
 *   --include-args    Show event arguments
 *   --find=pattern    Only show events (and their ancestors) matching pattern
 */

import fs from 'node:fs';
import path from 'node:path';
import {loadTraceEventsFromFile} from './trace-file-utils.mjs';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgBlue: '\x1b[44m',
};

/**
 * Converts trace events into a human-readable text representation.
 *
 * @param {string} inputFile
 * @param {string} [outputFile]
 * @param {Object} [options]
 */
export async function traceToText(inputFile, outputFile, options = {}) {
  let {
    limit = 75,
    start = 0,
    end = Infinity,
    summary = true,
    includeArgs = false,
    find = null
  } = options;

  if (limit <= 0) limit = 75;

  const events = await loadTraceEventsFromFile(inputFile);

  const threadNames = new Map();
  const allDurationEvents = [];

  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') {
      threadNames.set(`${e.pid}:${e.tid}`, e.args?.name);
    } else if (e.ph === 'X') {
      allDurationEvents.push(e);
    }
  }

  if (allDurationEvents.length === 0) {
    console.log('No duration events found.');
    return;
  }

  let globalMinTs = Infinity;
  for (const e of allDurationEvents) {
    if (e.ts < globalMinTs) globalMinTs = e.ts;
  }

  const rangeEvents = allDurationEvents.filter(e => {
    const eventStartMs = (e.ts - globalMinTs) / 1000;
    const eventEndMs = (e.ts + (e.dur || 0) - globalMinTs) / 1000;
    return eventEndMs >= start && eventStartMs <= end;
  });

  if (rangeEvents.length === 0) {
    console.log(`No events found in range ${start}ms to ${end}ms.`);
    return;
  }

  const allDurs = rangeEvents.map(e => e.dur || 0).sort((a, b) => b - a);
  const thresholdMs = allDurs[Math.min(limit, allDurs.length) - 1] || 0;

  const threads = new Map();
  for (const e of rangeEvents) {
    const key = `${e.pid}:${e.tid}`;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(e);
  }

  const findRegex = find ? new RegExp(find, 'i') : null;
  const outputLines = [];

    const showSummary = summary && !find;



    if (showSummary) {

      const stats = new Map();


    for (const [key, tEvents] of threads) {
      tEvents.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
      const stack = [];
      for (const e of tEvents) {
        while (stack.length > 0 && (stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts)) {
          stack.pop();
        }
        if (!stats.has(e.name)) stats.set(e.name, {totalTime: 0, selfTime: 0, count: 0});
        const s = stats.get(e.name);
        s.totalTime += e.dur || 0;
        s.selfTime += e.dur || 0;
        s.count++;
        if (stack.length > 0) {
          const parent = stats.get(stack[stack.length - 1].name);
          parent.selfTime -= e.dur || 0;
        }
        stack.push(e);
      }
    }

    const sortedByTotal = Array.from(stats.entries()).sort((a, b) => b[1].totalTime - a[1].totalTime);
    const sortedBySelf = Array.from(stats.entries()).sort((a, b) => b[1].selfTime - a[1].selfTime);

    outputLines.push(`${C.bold}${C.bgBlue} === Aggregate Summaries (ms) === ${C.reset}`);
    outputLines.push(`  ${C.dim}${'Total'.padStart(10)}  ${'Self'.padStart(10)}  ${'Count'.padStart(8)}  Event Name${C.reset}`);
    outputLines.push(`  ${C.cyan}--- Top Total Duration ---${C.reset}`);
    for (const [name, s] of sortedByTotal.slice(0, 10)) {
      outputLines.push(`  ${C.green}${(s.totalTime / 1000).toFixed(2).padStart(10)}${C.reset}  ${(s.selfTime / 1000).toFixed(2).padStart(10)}  ${C.dim}${String(s.count).padStart(8)}${C.reset}  ${name}`);
    }
    outputLines.push(`  ${C.cyan}--- Top Self Duration ---${C.reset}`);
    for (const [name, s] of sortedBySelf.slice(0, 10)) {
      outputLines.push(`  ${(s.totalTime / 1000).toFixed(2).padStart(10)}  ${C.green}${(s.selfTime / 1000).toFixed(2).padStart(10)}${C.reset}  ${C.dim}${String(s.count).padStart(8)}${C.reset}  ${name}`);
    }
    outputLines.push('');
  }
  outputLines.push(`${C.bold}${C.bgBlue} === Textual Flamechart === ${C.reset}`);
  const columns = [
    `${C.dim}[Offset (ms)]${C.reset}`,
    `${C.green}[Total Duration (ms)]${C.reset}`,
    `[Event Name]`,
  ];
  if (includeArgs) columns.push(`${C.dim}[Args]${C.reset}`);
  outputLines.push(`${columns.join(' ')}`);

  if (thresholdMs > 0) {
    const rangeStr = `${start}-${end === Infinity ? 'max' : end}ms`;
    outputLines.push(`\n${C.yellow}[Range: ${rangeStr} | Showing ~${limit} events with duration >= ${(thresholdMs / 1000).toFixed(2)}ms]${C.reset}`);
  }

  const threadKeys = Array.from(threads.keys()).sort((a, b) => threads.get(b).length - threads.get(a).length);

  for (const key of threadKeys) {
    const tEvents = threads.get(key);
    const name = threadNames.get(key) || `Process ${key}`;

    const hasVisibleEvents = tEvents.some(e => e.dur >= thresholdMs);
    if (!hasVisibleEvents) continue;

    tEvents.sort((a, b) => a.ts - b.ts || b.dur - a.dur);

    const threadOutput = [];
    const stack = [];
    let matchesFoundInThread = false;

    for (const e of tEvents) {
      if (e.dur < thresholdMs) continue;

      while (stack.length > 0 && (stack[stack.length - 1].ts + stack[stack.length - 1].dur <= e.ts)) {
        stack.pop();
      }

      const rawName = e.name;
      let cleanName = rawName;
      if (rawName.includes(' (') && rawName.endsWith(')')) {
        const lastOpenParenIndex = rawName.lastIndexOf(' (');
        const baseName = rawName.substring(0, lastOpenParenIndex);
        let pathInfo = rawName.substring(lastOpenParenIndex + 2, rawName.length - 1);
        const fileName = pathInfo.includes('/') ? pathInfo.split('/').pop() : pathInfo;
        cleanName = `${baseName} (${fileName})`;
      }

      const startOffset = (e.ts - globalMinTs) / 1000.0;
      const duration = (e.dur || 0) / 1000.0;
      const startStr = C.dim + startOffset.toFixed(1).padStart(8) + C.reset;
      const durStr = C.green + duration.toFixed(1).padStart(8) + C.reset;
      const indent = '  '.repeat(stack.length);

      let line = `${indent}${startStr} ${durStr} ${cleanName}`;
      if (includeArgs && e.args && Object.keys(e.args).length > 0) {
        line += ` ${C.dim}| args: ${JSON.stringify(e.args)}${C.reset}`;
      }

      const isMatch = findRegex ? (findRegex.test(cleanName) || (e.args && findRegex.test(JSON.stringify(e.args)))) : true;
      if (isMatch) matchesFoundInThread = true;

      threadOutput.push({line, isMatch, depth: stack.length});
      stack.push(e);
    }

    if (findRegex) {
      const kept = new Set();
      for (let i = 0; i < threadOutput.length; i++) {
        if (threadOutput[i].isMatch) {
          kept.add(i);
          let depth = threadOutput[i].depth;
          for (let j = i - 1; j >= 0; j--) {
            if (threadOutput[j].depth < depth) {
              kept.add(j);
              depth = threadOutput[j].depth;
            }
          }
        }
      }
      if (kept.size === 0) continue;

      outputLines.push(`\n${C.bold}${C.magenta}[Thread: ${name}]${C.reset} ${C.dim}(${tEvents.length} events)${C.reset}`);
      for (let i = 0; i < threadOutput.length; i++) {
        let line = threadOutput[i].line;
        if (threadOutput[i].isMatch) line = line.replace(findRegex, m => `${C.bgBlue}${C.bold}${m}${C.reset}`);
        if (kept.has(i)) outputLines.push(line);
      }
    } else {
      outputLines.push(`\n${C.bold}${C.magenta}[Thread: ${name}]${C.reset} ${C.dim}(${tEvents.length} events)${C.reset}`);
      for (const item of threadOutput) outputLines.push(item.line);
    }
  }

  const isFiltering = find !== null || start !== 0 || (end !== Infinity && end !== 999999);
  if (!isFiltering) {
    const relPath = path.relative(process.cwd(), inputFile);
    outputLines.push(`${C.bold}${C.bgBlue} === Investigation Guide === ${C.reset}`);
    outputLines.push(`  ${C.cyan}1. High-Level Overview${C.reset}`);
    outputLines.push(`     See which events consume the most time.`);
    outputLines.push(`     ${C.dim}./textual-flamechart.mjs ${relPath} --summary --limit=1000${C.reset}`);

    outputLines.push(`\n  ${C.cyan}2. Investigate Script Execution with Arguments${C.reset}`);
    outputLines.push(`     Identify exactly which scripts were running.`);
    outputLines.push(`     ${C.dim}./textual-flamechart.mjs ${relPath} --limit=50 --include-args --find="EvaluateScript"${C.reset}`);

    outputLines.push(`\n  ${C.cyan}3. Zoom into a specific "Jank" window${C.reset}`);
    outputLines.push(`     Crop the trace to a specific timeframe (e.g. 3000ms-3500ms).`);
    outputLines.push(`     ${C.dim}./textual-flamechart.mjs ${relPath} --start=3000 --end=3500 --limit=100${C.reset}`);

    outputLines.push(`\n  ${C.cyan}4. Trace specific Protocol Paths${C.reset}`);
    outputLines.push(`     Search for specific events like "DispatchProtocolCommand".`);
    outputLines.push(`     ${C.dim}./textual-flamechart.mjs ${relPath} --find="DispatchProtocolCommand" --limit=200${C.reset}`);

    outputLines.push(`\n  ${C.cyan}5. Deep Dive${C.reset}`);
    outputLines.push(`     Combine zoom, summary, and arguments.`);
    outputLines.push(`     ${C.dim}./textual-flamechart.mjs ${relPath} --start=2700 --end=3000 --summary --include-args --limit=50${C.reset}`);
  }

  const outputContent = outputLines.join('\n');
  if (outputFile) {
    fs.writeFileSync(outputFile, outputContent.replace(/\x1b\[[0-9;]*m/g, ''));
    console.log(`Trace text saved to ${outputFile} (colors stripped)`);
  } else {
    console.log(outputContent);
  }
}

function printHelp() {
  const relPath = '<trace-file.json>';
  console.log(`${C.bold}Textual Flamechart${C.reset}`);
  console.log(`  Usage: ./textual-flamechart.mjs <input-trace.json> [output-file.txt] [options]\n`);
  console.log(`${C.bold}Options:${C.reset}`);
  console.log(`  ${C.cyan}--limit=N${C.reset}        Target number of events to show in the tree (default: 75)`);
  console.log(`  ${C.cyan}--start=MS${C.reset}       Start time in ms (relative to trace start)`);
  console.log(`  ${C.cyan}--end=MS${C.reset}         End time in ms (relative to trace start)`);
  console.log(`  ${C.cyan}--no-summary${C.reset}     Disable the aggregate time summary tables`);
  console.log(`  ${C.cyan}--include-args${C.reset}   Show event arguments in the tree`);
  console.log(`  ${C.cyan}--find="pattern"${C.reset} Filter the tree for specific event names or arguments (case-insensitive)`);
  console.log(`  ${C.cyan}--help${C.reset}           Show this help information`);

  console.log(`\n${C.bold}${C.bgBlue} === Investigation Guide === ${C.reset}`);
  console.log(`  ${C.cyan}1. High-Level Overview${C.reset}`);
  console.log(`     See which events consume the most time.`);
  console.log(`     ${C.dim}./textual-flamechart.mjs ${relPath} --summary --limit=1000${C.reset}`);

  console.log(`\n  ${C.cyan}2. Investigate Script Execution with Arguments${C.reset}`);
  console.log(`     Identify exactly which scripts were running.`);
  console.log(`     ${C.dim}./textual-flamechart.mjs ${relPath} --limit=50 --include-args --find="EvaluateScript"${C.reset}`);

  console.log(`\n  ${C.cyan}3. Zoom into a specific "Jank" window${C.reset}`);
  console.log(`     Crop the trace to a specific timeframe (e.g. 3000ms-3500ms).`);
  console.log(`     ${C.dim}./textual-flamechart.mjs ${relPath} --start=3000 --end=3500 --limit=100${C.reset}`);

  console.log(`\n  ${C.cyan}4. Trace specific Protocol Paths${C.reset}`);
  console.log(`     Search for specific events like "DispatchProtocolCommand".`);
  console.log(`     ${C.dim}./textual-flamechart.mjs ${relPath} --find="DispatchProtocolCommand" --limit=200${C.reset}`);

  console.log(`\n  ${C.cyan}5. Deep Dive${C.reset}`);
  console.log(`     Combine zoom, summary, and arguments.`);
  console.log(`     ${C.dim}./textual-flamechart.mjs ${relPath} --start=2700 --end=3000 --summary --include-args --limit=50${C.reset}`);
}

if (import.meta.url.endsWith(process?.argv[1]) || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  const options = { limit: 75, summary: true, start: 0, end: Infinity };
  let inputFile = null;
  let outputFile = null;

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--limit=')) options.limit = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--start=')) options.start = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--end=')) options.end = parseFloat(arg.split('=')[1]);
    else if (arg === '--summary') options.summary = true;
    else if (arg === '--no-summary') options.summary = false;
    else if (arg === '--include-args') options.includeArgs = true;
    else if (arg.startsWith('--find=')) options.find = arg.split('=')[1];
    else if (!inputFile) inputFile = arg;
    else if (!outputFile) outputFile = arg;
  }

  if (!inputFile) {
    console.error('Usage: ./textual-flamechart.mjs <input-trace.json> [output-file.txt] [options]');
    process.exit(1);
  }

  traceToText(inputFile, outputFile, options).catch(console.error);
}
