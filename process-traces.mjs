/**
 * Copyright 2023 The Lighthouse Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'assert';
import os from 'node:os';
import glob from 'glob';
// Lighthouse
import {LH_ROOT} from 'lighthouse/shared/root.js';
import {TraceProcessor} from 'lighthouse/core/lib/tracehouse/trace-processor.js';
import {MainThreadTasks as MainThreadTasks_} from 'lighthouse/core/lib/tracehouse/main-thread-tasks.js';

// DevTools
import {polyfillDOMRect} from '@paulirish/trace_engine/analyze-trace.mjs';
import * as TraceEngine from '@paulirish/trace_engine';

// trace-stuff
import {loadTraceEventsFromFile} from './trace-file-utils.mjs';

const passedArg = process.argv[2]?.trim();
let filenames = [];

if (passedArg) {
  filenames.push(passedArg);
} else {
  filenames.push(
    ...[
      ...glob.sync(`${LH_ROOT}/latest*/defaultPass.trace.json`),
      ...glob.sync(`${LH_ROOT}/core/test/fixtures/traces/**.json`), // catches a bunch of other non-trace json. eh.
      ...glob.sync(`${LH_ROOT}/core/test/fixtures/**/trace.json`),
      ...glob.sync(`${os.homedir()}/chromium-devtools/devtools-frontend/front_end/panels/timeline/fixtures/traces/*.gz`),
      ...glob.sync(`${os.homedir()}/Downloads/traces/**.json`),
      ...glob.sync(`${os.homedir()}/Downloads/traces/**.json.gz`),
    ].filter(filename => {
      const blocklist = ['devtoolslog', 'devtools.log', 'network-records', 'cpuprofile'];
      return !blocklist.some(blocklistItem => filename.includes(blocklistItem));
    })
  );
}

filenames = Array.from(new Set(filenames)).sort(); // uniq
polyfillDOMRect();

// console.log(filenames);
// process.exit(0);

for (const filename of filenames) {
  await parseTraceText(filename);
}

async function parseTraceText(filename) {
  console.log('\n\n🥳 Loading…', filename);

  let traceEvents;
  try {
    traceEvents = loadTraceEventsFromFile(filename);
  } catch (e) {
    console.warn(e.message);
    return;
  }

  const trace = {
    traceEvents,
  };
  if (typeof trace?.traceEvents?.at(0)?.pid === 'undefined') {
    console.log('❌ ... skipping. not an actual trace.', filename);
    return;
  }

  console.log('Processing trace...');
  const logFailure = tag => e => console.error(` - ‼️ ${tag} FAILURE: `, e.message);


  const proTrace = await processWithLighthouse(trace).catch(logFailure('LH processor'));
  proTrace && assertLighthouseData(proTrace).catch(logFailure('LH assertion'));


  const result = await processWithTraceEngine(trace).catch(logFailure('Trace engine parse'));
  result && assertEngineData(result.data).catch(logFailure('Trace engine assertion'));
  // also result.insights
}

async function processWithLighthouse(trace) {
  const proTrace = await TraceProcessor.processTrace(trace);

  const processedNavigation = await TraceProcessor.processNavigation(proTrace);
  const longTasks = TraceProcessor.getMainThreadTopLevelEvents(proTrace);
  const mainTT = MainThreadTasks_.getMainThreadTasks(
    proTrace.mainThreadEvents,
    proTrace.frames,
    proTrace.timestamps.traceEnd,
    proTrace.timestamps.timeOrigin
  );
  return proTrace;
}

async function assertLighthouseData(proTrace) {
  // name all pid & tids we find in the frame tree
  const processTree = new Map();
  proTrace.frameTreeEvents.forEach(e => processTree.set(`p_${e.pid}_t_${e.tid}`, undefined));
  for (const pidtid of processTree.keys()) {
    const [pid, tid] = pidtid
      .replace('p_', '')
      .split('_t_')
      .map(n => parseInt(n, 10));
    const threadnames = proTrace._keyEvents.filter(e => e.cat === '__metadata' && e.name === 'thread_name');
    const name = threadnames.find(e => e.pid === pid && e.tid === tid)?.args?.name;
    processTree.set(pidtid, name);
  }

  // console.log(' - ok 1/2', {
  //   frames: proTrace.frames.length,
  //   ids: proTrace.mainFrameIds ?? proTrace.mainFrameInfo,
  //   processTree: processTree.size,
  //   rendererPidToTid: proTrace._rendererPidToTid,
  // });

  // console.log(' - ok 2/2', {timings: processedNavigation.timings});

  // console.log('- ok 2/2', {
  //   longtasks: longTasks.length,
  //   'main thread tasks': proTrace.mainThreadEvents.length,
  //   mainTT: mainTT.length,
  // });

  // const str = MainThreadTasks_.printTaskTreeToDebugString(mainTT, {printWidth: process.stdout.columns - 3});
  // console.log(str);
}

async function processWithTraceEngine(trace) {
    const model = TraceEngine.TraceModel.Model.createWithAllHandlers(TraceEngine.Types.Configuration.DEFAULT);
    await model.parse(trace.traceEvents);
    const data = model.traceParsedData(); // used to be .data()
    const insights = model.traceInsights();
    return {data, insights};
}

async function assertEngineData(data) {
  // assertions extrcted from trace_engine/test-trace-engine.mjs
  assert.equal(data.Renderer.allTraceEntries.length > 1, true);
  // assert.equal(data.Screenshots.length > 2, true);
  assert.equal(data.Meta.threadsInProcess.size > 0, true);
  // assert.equal(data.Meta.mainFrameNavigations.length > 0, true);

  const shouldBeNumbers = [
    data.Meta.traceBounds.min,
    data.Meta.traceBounds.max,
    data.Meta.traceBounds.range,
    data.Meta.browserProcessId,
    data.Meta.browserThreadId,
    data.Meta.gpuProcessId,
    data.Meta.gpuThreadId,
    Array.from(data.Meta.topLevelRendererIds.values()).at(0),
    Array.from(data.Meta.frameByProcessId.keys()).at(0),
  ];
  for (const datum of shouldBeNumbers) {
    assert.equal(isNaN(datum), false);
    assert.equal(typeof datum, 'number');
    assert.equal(datum > 10, true);
  }
  const shouldBeStrings = [
    data.Meta.mainFrameId,
    data.Meta.mainFrameURL,
    Array.from(data.Meta.navigationsByFrameId.keys()).at(0),
    Array.from(data.Meta.navigationsByNavigationId.keys()).at(0),
    data.Meta.mainFrameId,
  ];

  for (const datum of shouldBeStrings) {
    assert.equal(typeof datum, 'string');
    assert.equal(datum.length > 10, true);
  }
}


// extra parsing handling that I may want in the future
  // let trace;
  // try {
  //   text = text.trim();
  //   if (text.length === 0) {
  //     console.log('❌ ... empty file', filename); return;
  //   }
  //   const firstChar = text.at(0);
  //   if (firstChar !== '{' && firstChar !== '[') {
  //     console.log('😞 ... Does not look like json', filename, text.slice(0, 200).replace(/\n/g, ' '));
  //     return;
  //   }
  //   trace = JSON.parse(text);
  //   text = undefined;
  // } catch (e) {
  //   if (text.at(-1) === ',') {
  //     text = text.slice(0, text.length - 1) + ']';
  //     console.log(' ... JSON ending with a comma, trying to fix it...', filename);
  //     return parseTraceText(filename);
  //   }
  //   console.log('❌ ... invalid json', filename, e.message); return;
  // }

  // if (Array.isArray(trace)) {
  //   trace = {
  //     traceEvents: trace,
  //   };
  // }