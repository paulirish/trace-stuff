#!/usr/bin/env node

/**
 * Textual Flamechart
 *
 * Usage:
 *   ./textual-flamechart.mjs <input-trace.json> [output-file.txt] [--limit=150]
 *
 * Description:
 *   This script produces a human-readable text-based call tree (textual flamegraph)
 *   from a Chromium trace file. It shows thread-grouped events with their relative
 *   start times, durations, and nesting depth via indentation.
 */

import fs from 'node:fs';
import path from 'node:path';
import {loadTraceEventsFromFile} from './trace-file-utils.mjs';

/**
 * Port of trace_to_text.py to JavaScript.
 * Converts trace events into a human-readable text representation of the call stack.
 *
 * @param {string} inputFile
 * @param {string} [outputFile]
 * @param {number} [limit=150]
 */
export async function traceToText(inputFile, outputFile, limit = 75) {
  const events = await loadTraceEventsFromFile(inputFile);

  const threadNames = new Map();
  const filteredEvents = [];

  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') {
      threadNames.set(`${e.pid}:${e.tid}`, e.args?.name);
    } else if (e.ph === 'X') {
      filteredEvents.push(e);
    }
  }

  if (filteredEvents.length === 0) {
    console.log('No duration events found.');
    return;
  }

  // Determine threshold based on the desired limit of events to show.
  const allDurs = filteredEvents.map(e => e.dur || 0).sort((a, b) => b - a);
  const thresholdMs = allDurs[Math.min(limit, allDurs.length) - 1] || 0;

  // Global start time and total duration for relative offsets
  let minTs = Infinity;
  let maxEndTs = -Infinity;
  for (const e of filteredEvents) {
    if (e.ts < minTs) minTs = e.ts;
    const endTs = e.ts + (e.dur || 0);
    if (endTs > maxEndTs) maxEndTs = endTs;
  }

  // Group by PID/TID
  const threads = new Map();
  for (const e of filteredEvents) {
    const key = `${e.pid}:${e.tid}`;
    if (!threads.has(key)) {
      threads.set(key, []);
    }
    threads.get(key).push(e);
  }

  // Sort threads by activity (unfiltered event count)
  const threadKeys = Array.from(threads.keys()).sort((a, b) => {
    return threads.get(b).length - threads.get(a).length;
  });

  const outputLines = [];

  outputLines.push('Grouped by thread. Indentation represents call stack depth.');
  outputLines.push('Columns: [Offset from start (ms)] [Duration (ms)] [Event Name]');

  if (thresholdMs > 0) {
    outputLines.push(`\n[Showing ~${limit} events with duration >= ${(thresholdMs / 1000).toFixed(2)}ms]`);
  }

  for (const key of threadKeys) {
    const tEvents = threads.get(key);
    const [pid, tid] = key.split(':');
    const name = threadNames.get(key) || `Process ${pid} Thread ${tid}`;

    // Check if thread has any events after filtering
    const hasVisibleEvents = tEvents.some(e => e.dur >= thresholdMs);
    if (!hasVisibleEvents) continue;

    outputLines.push(`
[Thread: ${name}] (${tEvents.length} events)`);

    // Sort by start time (ts) and then by duration (descending)
    tEvents.sort((a, b) => a.ts - b.ts || b.dur - a.dur);

    const stack = [];
    for (const e of tEvents) {
      if (e.dur < thresholdMs) continue;

      const startOffset = (e.ts - minTs) / 1000.0; // ms
      const duration = e.dur / 1000.0; // ms

      while (stack.length > 0 && (stack[stack.length - 1].ts + stack[stack.length - 1].dur < e.ts + e.dur)) {
        stack.pop();
      }

      const indent = '  '.repeat(stack.length);

      const rawName = e.name;
      let cleanName = rawName;
      if (rawName.includes(' (') && rawName.endsWith(')')) {
        const lastOpenParenIndex = rawName.lastIndexOf(' (');
        const baseName = rawName.substring(0, lastOpenParenIndex);
        let pathInfo = rawName.substring(lastOpenParenIndex + 2, rawName.length - 1);

        const fileName = pathInfo.includes('/') ? pathInfo.split('/').pop() : pathInfo;
        cleanName = `${baseName} (${fileName})`;
      }

      const startStr = startOffset.toFixed(1).padStart(8);
      const durStr = duration.toFixed(1).padStart(8);
      outputLines.push(`${indent}${startStr} ${durStr} ${cleanName}`);
      stack.push(e);
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

// CLI direct invocation
if (import.meta.url.endsWith(process?.argv[1]) || (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname))) {
  let limit = undefined;
  let inputFile = null;
  let outputFile = null;

  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--limit=')) {
      limit = parseInt(arg.split('=')[1], 10);
    } else if (!inputFile) {
      inputFile = arg;
    } else if (!outputFile) {
      outputFile = arg;
    }
  }

  if (!inputFile) {
    console.error('Usage: ./textual-flamechart.mjs <input-trace.json> [output-file.txt] [--limit=75]');
    process.exit(1);
  }

  traceToText(inputFile, outputFile, limit).catch(console.error);
}
