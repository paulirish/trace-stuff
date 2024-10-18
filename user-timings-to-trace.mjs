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

/** @typedef {number&{_tag: 'MilliSeconds'}} MilliSeconds */
/** @typedef {number&{_tag: 'MicroSeconds'}} MicroSeconds */

/** @param {number} num */
export const toMicrosec = num => /** @type MicroSeconds */ (num * 1000);

/**
 * Generates a Chrome trace file from user timing measures
 *
 * Originally adapted from https://github.com/tdresser/performance-observer-tracing
 *
 * @param {PerformanceEntryList} entries user timing entries
 * @param {number=} threadId Can be provided to separate a series of trace events into another thread, useful if timings do not share the same timeOrigin, but should both be "left-aligned".
 */
export function generateTraceEvents(entries, threadId = 8) {
  /** @type {TraceEvent[]} */
  const currentTrace = [];
  const baseEvt = {
    pid: 7,
    tid: threadId,
    args: {},
    // Hack: Use one to avoid some mishandling in the devtools of valid trace events
    // with a ts of 0. We should fix the bug there, but making this a microsecond off
    // seems an okay tradeoff.
    ts: /** @type MicroSeconds */ (1),
    name: '',
  };

  const frameData = {
    processId: baseEvt.pid,
    frame: '_frameid_',
    name: '_frame_name_',
    url: 'https://www.UNSET_URL.com/',
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

  threadId === 8 && currentTrace.push(({
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
  }));

  threadId === 8 && currentTrace.push(({
    ...metaEvtBase,
    cat: 'disabled-by-default-devtools.timeline',
    name: 'FrameCommittedInBrowser',
    ph: 'I',
    args: {
      data: frameData,
    },
  }));
  }
  addBaselineTraceEvents();

  entries.sort((a, b) => a.startTime - b.startTime);
  // TODO: handle mark.
  entries.forEach((entry, i) => {
    /** @type {TraceEvent} */
    const startEvt = {
      ...baseEvt,
      // FYI Colons in user_timing names get special handling in about:tracing you may not want. https://github.com/catapult-project/catapult/blob/b026043a43f9ce3f37c1cd57269f92cb8bee756c/tracing/tracing/extras/importer/trace_event_importer.html#L1643-L1654
      // But no adjustments made here.
      name: entry.name,
      cat: 'blink.user_timing',
      ts: entry.startTime * 1000,
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
