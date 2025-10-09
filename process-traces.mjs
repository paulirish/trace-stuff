/**
 * Copyright 2023 The Lighthouse Authors
 * SPDX-License-Identifier: Apache-2.0
 */

import {strict as assert} from 'node:assert';
import os from 'node:os';
import test from 'node:test';

import {glob} from 'glob';
// Lighthouse
// import {LH_ROOT} from 'lighthouse/shared/root.js';
// import {TraceProcessor} from 'lighthouse/core/lib/tracehouse/trace-processor.js';
// import {MainThreadTasks as MainThreadTasks_} from 'lighthouse/core/lib/tracehouse/main-thread-tasks.js';

// DevTools
import {polyfillDOMRect} from '../trace_engine/analyze-trace.mjs';
import * as Trace from '../trace_engine/models/trace/trace.js';

// import pkg from '@paulirish/trace_engine/package.json'  with { "type": "json" };

// console.log('@paulirish/trace_engine', {version: pkg.version});

// trace-stuff
import {loadTraceEventsFromFile} from './trace-file-utils.mjs';

// (async function main() {

const passedArg = process.argv[2]?.trim();
let filenames = [];

if (passedArg) {
  filenames.push(passedArg);
} else {
  filenames.push(
    ...[
      // ...glob.sync(`${LH_ROOT}/latest*/defaultPass.trace.json`),
      // ...glob.sync(`${LH_ROOT}/core/test/fixtures/traces/**.json`), // catches a bunch of other non-trace json. eh.
      // ...glob.sync(`${LH_ROOT}/core/test/fixtures/**/trace.json`),
      // ...glob.sync(`${LH_ROOT}/core/test/fixtures/traces/load.json`),

      // ...glob.sync(`${os.homedir()}/chromium-devtools/devtools-frontend/front_end/panels/timeline/fixtures/traces/*.gz`),
      ...glob.sync(`${os.homedir()}/Downloads/traces/**.json`),
      // ...glob.sync(`${os.homedir()}/Downloads/traces/tracecafe-stored-traces/traces/*`),
      ...glob.sync(`${os.homedir()}/Downloads/traces/**.json.gz`),
    ].filter(filename => {
      const blocklist = ['devtoolslog', 'devtools.log', 'network-records', 'cpuprofile', 'BUG', 'Busted', 'Profile-'];
      return !blocklist.some(blocklistItem => filename.includes(blocklistItem));
    })
  );
}

filenames = Array.from(new Set(filenames)).sort() // .slice(0, 3); // uniq


polyfillDOMRect();

const allFailures = new Map();

process.on('SIGINT', () => {
  console.log('\n\nFatal parsing errors, grouped:\n', allFailures);
  process.exit(0); // Exit code 0 indicates success
});


// test('ok', async () => {
for (const filename of filenames) {

  await parseTraceText(filename);
}
// });

console.log('\n\nFatal parsing errors, grouped:\n', allFailures);

// })();

async function parseTraceText(filename) {
  process.stderr.write(`\n🥳 Loading… ${filename.replace(os.homedir(), '$HOME')}`);

  let traceEvents;
  try {
    traceEvents = loadTraceEventsFromFile(filename);
  } catch (e) {
    console.warn(e.message);
    return;
  }

  process.stderr.write(`  ${traceEvents.length.toLocaleString()} evts\n`);
  const trace = {
    traceEvents,
  };
  if (typeof trace?.traceEvents?.at(0)?.pid === 'undefined') {
    console.error('\n❌ ... skipping. not an actual trace.', filename);
    return;
  }


  const logFatal = tag => e => { 
    process.stdout.write(`\n- ‼️ ${tag} FATAL: ${e.message}`) && false;
    const signature = e.stack.split('\n').slice(0,2).join(' | ')
    const failuresPerMessage = allFailures.get(signature) ?? [];
    failuresPerMessage.push(filename);
    allFailures.set(signature, failuresPerMessage);
  };
  const logFail = tag => e => process.stdout.write(`\n- 😞 ${tag} fail: ${e.message}`) && false;


  // const proTrace = await processWithLighthouse(trace).catch(logFatal('LH processor'));
  // proTrace && assertLighthouseData(proTrace).catch(logFail('LH assertion'));


  let model = await processWithTraceEngine(trace).catch(logFatal('Trace engine parse'));
  model && assertEngineData(model, filename).catch(logFail('Trace engine assertion'));
  // also result.insights

  model.resetProcessor();
  model = undefined;
  traceEvents = [];
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
    const model = Trace.TraceModel.Model.createWithAllHandlers(Trace.Types.Configuration.DEFAULT);
    await model.parse(trace.traceEvents);
    return model; 
}

async function assertEngineData(model, filename) {

  filename = filename.split('/').at(-1);
  const data = model.parsedTrace();
  const insights = model.traceInsights()


  // // return;
  // // test(`engine data looks good for ${filename}`, t => {
  // // assertions extrcted from trace_engine/test-trace-engine.mjs
  // assert.equal(data.Renderer.allTraceEntries.length > 1, true);
  // // assert.equal(data.Screenshots.length > 2, true);
  // assert.equal(data.Meta.threadsInProcess.size > 0, true);
  // // assert.equal(data.Meta.mainFrameNavigations.length > 0, true);

  // const shouldBeNumbers = {
  //   traceBounds: data.Meta.traceBounds.min,
  //   traceBounds: data.Meta.traceBounds.max,
  //   traceBounds: data.Meta.traceBounds.range,
  //   browserProcessId: data.Meta.browserProcessId,
  //   browserThreadId: data.Meta.browserThreadId,
  //   gpuProcessId: data.Meta.gpuProcessId,
  //   // gpuThreadId: data.Meta.gpuThreadId,
  //   topLevelRendererIds: Array.from(data.Meta.topLevelRendererIds.values()).at(0),
  //   frameByProcessId: Array.from(data.Meta.frameByProcessId.keys()).at(0),
  // };

  // Object.entries(shouldBeNumbers).forEach(([key, val], i) => {
  //   assert.equal(isNaN(val), false, `${key} is NaN`);
  //   assert.equal(typeof val, 'number', `${key} is not a number`);
  //   assert.equal(val > 10, true, `${key} is not more than 10`);
  // });
  // const shouldBeStrings = {
  //   mainFrameId: data.Meta.mainFrameId,
  //   mainFrameURL: data.Meta.mainFrameURL,
  //   // navigationsByFrameId: Array.from(data.Meta.navigationsByFrameId.keys()).at(0),
  //   // navigationsByNavigationId: Array.from(data.Meta.navigationsByNavigationId.keys()).at(0),
  //   mainFrameId: data.Meta.mainFrameId,
  // };


  // Object.entries(shouldBeStrings).forEach(([key, val], i) => {
  //   assert.equal(typeof val, 'string',`${key} isn't a string, but instead it's: ${typeof val}.}`, );
  //   assert.equal(val.length > 10, true, `${key} is not more than 10`);
  // });
  // // });
 // const test = (d, fn) => fn();


test('key values are populated. ' + filename, t => {
  // assert.equal((data.Screenshots.legacySyntheticScreenshots?.length ?? 0) > 2, true);
  assert.equal(data.Meta.threadsInProcess.size > 0, true);
  assert.equal(data.Meta.mainFrameNavigations.length > 0, true);
});

test('numeric values are set and look legit. ' + filename, t => {
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
    assert.equal(typeof datum, 'number');
    if (typeof datum !== 'number')
      throw new Error();
    assert.equal(isNaN(datum), false);
    assert.equal(datum > 10, true);
  }
});

test('string values are set and look legit. ' + filename, t => {
  const shouldBeStrings = [
    data.Meta.mainFrameId,
    data.Meta.mainFrameURL,
    Array.from(data.Meta.navigationsByFrameId.keys()).at(0),
    Array.from(data.Meta.navigationsByNavigationId.keys()).at(0),
    data.Meta.mainFrameId,
  ];

  for (const datum of shouldBeStrings) {
    assert.equal(typeof datum, 'string');
    if (typeof datum !== 'string')
      throw new Error();
    assert.equal(datum.length > 10, true);
  }
});

test('insights look ok. ' + filename, t => {
  if (insights === null) {
    throw new Error('insights null');
  }
  const insightSet = Array.from(insights.values()).at(-1);
  if (typeof insightSet === 'undefined') {
    throw new Error();
  }
  const keys = Object.keys(insightSet.model);
  assert.deepStrictEqual(keys, [
    'INPBreakdown',
    'LCPBreakdown',
    'LCPDiscovery',
    'CLSCulprits',
    'RenderBlocking',
    'NetworkDependencyTree',
    'ImageDelivery',
    'DocumentLatency',
    'FontDisplay',
    'Viewport',
    'DOMSize',
    'ThirdParties',
    'DuplicatedJavaScript',
    'SlowCSSSelector',
    'ForcedReflow',
    'Cache',
    'ModernHTTP',
    'LegacyJavaScript',
  ]);
  for (const [insightName, insightItem] of Object.entries(insightSet.model)) {
    const msg = insightItem instanceof Error ?
        `${insightName} is an error. ${insightItem.toString()} ${insightItem.stack?.toString()}` :
        '';
    assert.ok(insightItem instanceof Error === false, msg);
    assert.ok(typeof insightItem === 'object', `insightName ${insightName} is not an object`);
  }

});

test('bottom-up summary is good. ' + filename, t => {
  const parsedTrace = data;
  const visibleEvents = Trace.Helpers.Trace.VISIBLE_TRACE_EVENT_TYPES.values().toArray();
  const filter = new Trace.Extras.TraceFilter.VisibleEventsFilter(
      visibleEvents.concat([Trace.Types.Events.Name.SYNTHETIC_NETWORK_REQUEST]));
  const milliBounds = Trace.Helpers.Timing.traceWindowMilliSeconds(parsedTrace.Meta.traceBounds);


  const mainThreadProbably =
      Trace.Handlers.Threads.threadsInTrace(parsedTrace)
          .filter(t => t.type === Trace.Handlers.Threads.ThreadType.MAIN_THREAD && t.processIsOnMainFrame)
          .sort((a, b) => b.entries.length - a.entries.length)
          .at(0);
  if (!mainThreadProbably)
    assert.fail('No main thread found in trace');

  /** @param {Trace.Types.Events.Event} event  */
  const groupingFunction = event => event.name;

  const node = new Trace.Extras.TraceTree.BottomUpRootNode([...mainThreadProbably.entries], {
    textFilter: new Trace.Extras.TraceFilter.ExclusiveNameFilter([]),
    filters: [filter],
    startTime: milliBounds.min,
    endTime: milliBounds.max,
    eventGroupIdCallback: groupingFunction,
  });

  const bottomUpByName =
      Array.from(node.children().values())
          .map(c => [c.id.toString().padEnd(30), c.selfTime.toLocaleString().padStart(10) + 'ms'].join('\t'));
  assert.ok(bottomUpByName);
});



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