//  Take some user timings (performance.measure/mark) and generate a trace for visualization.
//  Perfect if you instrment in Node.js with performance mark()/measure(), or the NPM marky package.
//  Run like:
//     node user-timings-to-trace.mjs user-timings.json
//
// Most of this file is from Lighthouse: https://github.com/GoogleChrome/lighthouse/blob/0da3e1d85d1920e3e75e423e6f905ddf4bd8fd53/core/lib/timing-trace-saver.js
// But I've adapted it to be solo and modernized it a tad. ~Paul. 2024-10
/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';

/** @typedef {import('./types/chromium-trace').TraceEvent} TraceEvent */

/**
 * Generates a Chrome trace file from user timing measures
 *
 * Originally adapted from https://github.com/tdresser/performance-observer-tracing
 *
 * @param {PerformanceEntryList} entries user timing entries
 * @param {number=} threadId Can be provided to separate a series of trace events into another thread, useful if timings do not share the same timeOrigin, but should both be "left-aligned".
 */
export function generateTraceEvents(entries, threadId = 8) {
  entries.sort((a, b) => a.startTime - b.startTime);

  /** @type {TraceEvent[]} */
  const currentTrace = [];
  const baseEvt = {
    pid: 7,
    tid: threadId,
    args: {},
    // Hack: Use one to avoid some mishandling in the devtools of valid trace events
    // with a ts of 0. We should fix the bug there, but making this a microsecond off
    // seems an okay tradeoff.
    ts: 1,
    name: '',
  };

  const frameData = {
    processId: baseEvt.pid,
    frame: '_frameid_',
    name: '_frame_name_',
    url: '',
    navigationId: '_navid_',
  };

  function addBaselineTraceEvents() {
    /** @type {TraceEvent} */
    const metaEvtBase = {
      ...baseEvt,
      cat: '__metadata',
      ph: 'M',
    };

    currentTrace.push({
      ...metaEvtBase,
      name: 'process_labels',
      args: {labels: 'User Timing'},
    });

    currentTrace.push({
      ...metaEvtBase,
      name: 'thread_name',
      args: {
        name: 'CrRendererMain',
      },
    });

    currentTrace.push({
      ...metaEvtBase,
      name: 'process_name',
      args: {
        name: 'Renderer',
      },
    });

    threadId === 8 &&
      currentTrace.push({
        ...metaEvtBase,
        cat: 'disabled-by-default-devtools.timeline',
        name: 'TracingStartedInBrowser',
        ph: 'I',
        // s: 't',
        args: {
          data: {
            frameTreeNodeId: 1,
            persistentIds: true,
            frames: [frameData],
          },
        },
      });

    threadId === 8 &&
      currentTrace.push({
        ...metaEvtBase,
        cat: 'disabled-by-default-devtools.timeline',
        name: 'FrameCommittedInBrowser',
        ph: 'I',
        args: {
          data: frameData,
        },
      });
  }
  addBaselineTraceEvents();

  entries.forEach((entry, i) => {
    if (entry.entryType === 'mark') {
      const markEvt = {
        ...baseEvt,
        name: entry.name,
        cat: 'blink.user_timing',
        ts: entry.startTime * 1000,
        ph: 'I',
      };
      return currentTrace.push(markEvt);
    }

    /** @type {TraceEvent} */
    const measureBeginEvt = {
      ...baseEvt,
      // FYI Colons in user_timing names get special handling in about:tracing you may not want. https://github.com/catapult-project/catapult/blob/b026043a43f9ce3f37c1cd57269f92cb8bee756c/tracing/tracing/extras/importer/trace_event_importer.html#L1643-L1654
      // But no adjustments made here.
      name: entry.name,
      cat: 'blink.user_timing',
      ts: entry.startTime * 1000,
      id2: {local: '0x' + (i + 1).toString(16)},
      ph: 'b',
    };

    const measureEndEvt = {
      ...measureBeginEvt,
      ph: 'e',
      ts: measureBeginEvt.ts + entry.duration * 1000,
    };

    currentTrace.push(measureBeginEvt);
    currentTrace.push(measureEndEvt);
  });

  // DevTools likes to calculate trace bounds with 'real' events.
  // We'll give it a little breathing room for more enjoyable UI.
  const firstTs = (entries.at(0)?.startTime ?? 0) * 1000;
  const lastTs = currentTrace.at(-1)?.ts ?? currentTrace.reduce((acc, e) => (e.ts + (e.dur ?? 0) > acc ? e.ts + (e.dur ?? 0) : acc), 0);
  const finalTs = 2.1 * lastTs - firstTs;
  const zeroEvent = {
    ...baseEvt,
    name: 'RunTask',
    cat: 'disabled-by-default-devtools.timeline',
    ph: 'X',
    ts: firstTs * 0.9,
    dur: 2,
  };
  const finalEvent = {
    ...zeroEvent,
    ts: finalTs,
  };
  currentTrace.push(zeroEvent);
  currentTrace.push(finalEvent);

  return currentTrace;
}

/**
 * Writes a trace file to disk
 * @param {PerformanceEntryList} entries
 * @return {string}
 */
export function createTraceString(entries) {
  if (!Array.isArray(entries) || !entries[0].entryType) {
    throw new Error('This doesnt look like measures/marks');
  }

  const traceEvents = generateTraceEvents(entries);

  const jsonStr = `{"traceEvents":[
${traceEvents.map(evt => JSON.stringify(evt)).join(',\n')}
]}`;
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

  const mark = performance.mark.bind(performance);
  mark('1');
  const entries = JSON.parse(fs.readFileSync(filename, 'utf8'));
  mark('2');
  const jsonStr = createTraceString(entries);
  mark('3');

  const pathObj = path.parse(filename);
  const traceFilePath = path.join(pathObj.dir, `${pathObj.name}.trace.json`);
  fs.writeFileSync(traceFilePath, jsonStr, 'utf8');
  mark('4');

  if (process.env.TIMING) {
    performance.measure('all', '1', '4');
    performance.measure('read json', '1', '2');
    performance.measure('craft trace', '2', '3');
    performance.measure('write file', '3', '4');
    fs.writeFileSync('./selftimings.json', JSON.stringify(performance.getEntries()), 'utf8');
  }
 
  console.log(`
  > Timing trace saved to: ${traceFilePath}
  > View in DevTools perf panel, https://ui.perfetto.dev or https://trace.cafe
`);
}
