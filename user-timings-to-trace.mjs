// Most of this file is from Lighthouse: https://github.com/GoogleChrome/lighthouse/blob/0da3e1d85d1920e3e75e423e6f905ddf4bd8fd53/core/lib/timing-trace-saver.js
// But I've adapted it to be solo and modernized it a tad. ~Paul. 2024-10

/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
performance.mark('top');

import fs from 'fs';
import path from 'path';

performance.mark('importdone');

/** @typedef {import('./types/chromium-trace').TraceEvent} TraceEvent */

/**
 * Generates a Chrome trace file from user timing measures
 *
 * Originally adapted from https://github.com/tdresser/performance-observer-tracing
 *
 * @param {PerformanceEntryList} entries user timing entries
 * @param {number=} threadId Can be provided to separate a series of trace events into another thread, useful if timings do not share the same timeOrigin, but should both be "left-aligned".
 */
export function generateTraceEvents(entries, threadId = 0) {
  /** @type {TraceEvent[]} */
  const currentTrace = [];
  entries.sort((a, b) => a.startTime - b.startTime);
  entries.forEach((entry, i) => {
    /** @type {TraceEvent} */
    const startEvt = {
      // FYI Colons in user_timing names get special handling in about:tracing you may not want. https://github.com/catapult-project/catapult/blob/b026043a43f9ce3f37c1cd57269f92cb8bee756c/tracing/tracing/extras/importer/trace_event_importer.html#L1643-L1654
      // But no adjustments made here.
      name: entry.name,
      cat: 'blink.user_timing',
      ts: entry.startTime * 1000,
      args: {},
      dur: 0,
      pid: 0,
      tid: threadId,
      ph: 'b',
      id: '0x' + (i++).toString(16),
    };

    const endEvt = {
      ...startEvt,
      ph: 'e',
      ts: startEvt.ts + entry.duration * 1000,
    };

    currentTrace.push(startEvt);
    currentTrace.push(endEvt);
  });

  // Add labels
  /** @type {TraceEvent} */
  const metaEvtBase = {
    pid: 0,
    tid: threadId,
    ts: 0,
    dur: 0,
    ph: 'M',
    cat: '__metadata',
    name: 'process_labels',
    args: {labels: 'Default'},
  };
  currentTrace.push(Object.assign({}, metaEvtBase, {args: {labels: 'User Timing'}}));

  // Only inject TracingStartedInBrowser once
  if (threadId === 0) {
    currentTrace.push(
      Object.assign({}, metaEvtBase, {
        cat: 'disabled-by-default-devtools.timeline',
        name: 'TracingStartedInBrowser',
        ph: 'I',
        args: {
          data: {
            frameTreeNodeId: 1,
            persistentIds: true,
            frames: [],
          },
        },
      })
    );
  }
  return currentTrace;
}

/**
 * Writes a trace file to disk
 * @param {PerformanceEntryList} entries
 * @return {string}
 */
export function createTraceString(entries) {
  if (!Array.isArray(entries) || !entries[0].entryType) throw new Error('This doesnt look like measures/marks');

  performance.mark('genTrace-b');
  const traceEvents = generateTraceEvents(entries);
  performance.measure('generateTraceEvents', {start: 'genTrace-b', end: performance.now()});

  performance.mark('stringify-b');

  const jsonStr = `{"traceEvents":[
${traceEvents.map(evt => JSON.stringify(evt)).join(',\n')}
]}`;

  performance.measure('stringify', {start: 'stringify-b', end: performance.now()});

  return jsonStr;
}

// CLI direct invocation?
if (import.meta.url.endsWith(process.argv[1])) {
  cli();
}

async function cli() {
  const filename = process.argv[2] && path.resolve(process.cwd(), process.argv[2]);
  if (!filename || !fs.existsSync(filename)) {
    throw new Error(`File not found: ${filename}`);
  }

  const entries = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const jsonStr = createTraceString(entries);

  const pathObj = path.parse(filename);
  const traceFilePath = path.join(pathObj.dir, `${pathObj.name}.trace.json`);
  fs.writeFileSync(traceFilePath, jsonStr, 'utf8');

  performance.mark('alldone');
  performance.measure('imports', {start: 'top', end: 'importdone'});
  performance.measure('all', {start: 'top', end: 'alldone'});
  // if (process.env.TIMING)  {
  fs.writeFileSync('./selftimings.json', JSON.stringify(performance.getEntries()), 'utf8');
  // }

  console.log(`
  > Timing trace saved to: ${traceFilePath}
  > View in DevTools perf panel, Perfetto UI or https://trace.cafe
`);
}
