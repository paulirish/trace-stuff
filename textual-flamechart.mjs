#!/usr/bin/env node

/**
 * Textual Flamechart
 *
 * Usage:
 *   ./textual-flamechart.mjs <input-trace.json> [output-file.txt] [options]
 *
 * Options:
 *   --limit=150       Target number of events to show (default: 150)
 *   --start=0         Start time in ms (relative to trace start)
 *   --end=999999      End time in ms (relative to trace start)
 *   --summary         Show aggregate time summary
 *   --include-args    Show event arguments
 *   --find=pattern    Only show events (and their ancestors) matching pattern
 */

import fs from 'node:fs';
import path from 'node:path';
import {loadTraceEventsFromFile} from './trace-file-utils.mjs';

/**
 * Converts trace events into a human-readable text representation.
 *
 * @param {string} inputFile
 * @param {string} [outputFile]
 * @param {Object} [options]
 */
export async function traceToText(inputFile, outputFile, options = {}) {
  const {
    limit = 150,
    start = 0,
    end = Infinity,
    summary = false,
    includeArgs = false,
    find = null
  } = options;

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

  // Determine global minTs from all events for relative offsets
  let globalMinTs = Infinity;
  for (const e of allDurationEvents) {
    if (e.ts < globalMinTs) globalMinTs = e.ts;
  }

  // Filter by time range
  const rangeEvents = allDurationEvents.filter(e => {
    const eventStartMs = (e.ts - globalMinTs) / 1000;
    const eventEndMs = (e.ts + (e.dur || 0) - globalMinTs) / 1000;
    return eventEndMs >= start && eventStartMs <= end;
  });

  if (rangeEvents.length === 0) {
    console.log(`No events found in range ${start}ms to ${end}ms.`);
    return;
  }

  // Determine threshold based on the desired limit of events to show in this range.
  const allDurs = rangeEvents.map(e => e.dur || 0).sort((a, b) => b - a);
  const thresholdMs = allDurs[Math.min(limit, allDurs.length) - 1] || 0;

  // Group by PID/TID
  const threads = new Map();
  for (const e of rangeEvents) {
    const key = `${e.pid}:${e.tid}`;
    if (!threads.has(key)) threads.set(key, []);
    threads.get(key).push(e);
  }

  const findRegex = find ? new RegExp(find, 'i') : null;
  const outputLines = [];

  if (summary) {
    const stats = new Map(); // name -> {totalTime, selfTime, count}
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

    outputLines.push('=== SUMMARY (Aggregate Times in ms) ===');
    outputLines.push('  ' + 'Total'.padStart(10) + '  ' + 'Self'.padStart(10) + '  ' + 'Count'.padStart(8) + '  ' + 'Event Name');
    const sortedStats = Array.from(stats.entries()).sort((a, b) => b[1].totalTime - a[1].totalTime);
    for (const [name, s] of sortedStats.slice(0, 20)) {
      outputLines.push(`  ${(s.totalTime / 1000).toFixed(2).padStart(10)}  ${(s.selfTime / 1000).toFixed(2).padStart(10)}  ${String(s.count).padStart(8)}  ${name}`);
    }
    outputLines.push('');
  }

  outputLines.push('Textual Flamechart | Columns: [Offset from start (ms)] [Duration (ms)] [Event Name]');
  if (thresholdMs > 0) {
    outputLines.push(`[Range: ${start}-${end === Infinity ? 'max' : end}ms | Showing ~${limit} events with duration >= ${(thresholdMs / 1000).toFixed(2)}ms]`);
  }

  const threadKeys = Array.from(threads.keys()).sort((a, b) => threads.get(b).length - threads.get(a).length);

  for (const key of threadKeys) {
    const tEvents = threads.get(key);
    const [pid, tid] = key.split(':').map(Number);
    const name = threadNames.get(key) || `Process ${pid} Thread ${tid}`;

    const visibleEventsInThread = tEvents.filter(e => e.dur >= thresholdMs);
    if (visibleEventsInThread.length === 0) continue;

    // Build the tree for --find support
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
      const startStr = startOffset.toFixed(1).padStart(8);
      const durStr = duration.toFixed(1).padStart(8);
      const indent = '  '.repeat(stack.length);
      
      let line = `${indent}${startStr} ${durStr} ${cleanName}`;
      if (includeArgs && e.args) {
        line += ` | args: ${JSON.stringify(e.args)}`;
      }

      const isMatch = findRegex ? (findRegex.test(cleanName) || (e.args && findRegex.test(JSON.stringify(e.args)))) : true;
      if (isMatch) matchesFoundInThread = true;

      threadOutput.push({line, isMatch, depth: stack.length, ts: e.ts, end: e.ts + (e.dur || 0)});
      stack.push(e);
    }

    if (findRegex) {
      // Post-process threadOutput to only keep matches and their ancestors
      const kept = new Set();
      for (let i = 0; i < threadOutput.length; i++) {
        if (threadOutput[i].isMatch) {
          kept.add(i);
          // Mark ancestors
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
      
      outputLines.push(`
[Thread: ${name}] (${tEvents.length} events)`);
      for (let i = 0; i < threadOutput.length; i++) {
        if (kept.has(i)) outputLines.push(threadOutput[i].line);
      }
    } else {
      outputLines.push(`
[Thread: ${name}] (${tEvents.length} events)`);
      for (const item of threadOutput) outputLines.push(item.line);
    }
  }

  const outputContent = outputLines.join('\n');
  if (outputFile) {
    fs.writeFileSync(outputFile, outputContent);
    console.log(`Trace text saved to ${outputFile}`);
  } else {
    console.log(outputContent);
  }
}

if (import.meta.url.endsWith(process?.argv[1]) || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  const options = { limit: 150 };
  let inputFile = null;
  let outputFile = null;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--limit=')) options.limit = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--start=')) options.start = parseFloat(arg.split('=')[1]);
    else if (arg.startsWith('--end=')) options.end = parseFloat(arg.split('=')[1]);
    else if (arg === '--summary') options.summary = true;
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