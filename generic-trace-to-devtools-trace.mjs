import fs from 'fs';
import { strict as assert } from 'assert';
import { loadTraceEventsFromFile } from './trace-file-utils.mjs';

const passedArg = process.argv[2];
const tracefilename = passedArg ? passedArg : './myjansatta.json';

/** @type {TraceEvent[]} */
const events = loadTraceEventsFromFile(tracefilename);

console.log(events.length);

const pidToProcessName = new Map();
const pidToThreads = new Map();
const rendererMainPidTids = new Map(); 
let minTs = Infinity;
let maxTs = -Infinity;

// metadataevents are always at the start
for (const e of events.slice(0, 1000)) {
  if (e.ph === 'M' && e.name === 'process_name') pidToProcessName.set(e.pid, e.args.name);
  if (e.ph === 'M' && e.name === 'thread_name') {
    const tidToThreadName = pidToThreads.get(e.pid) ?? new Map();
    tidToThreadName.set(e.tid, e.args.name);
    pidToThreads.set(e.pid, tidToThreadName);

    if (e.args.name === 'CrRendererMain') rendererMainPidTids.set(e.pid, e.tid);
  }
  if (e.ts !== 0) minTs = Math.min(minTs, e.ts);
}

console.log({ pidToProcessName, pidToThreads });

const pidTidEventCount = {};

for (const e of events) {
  const key = `p${e.pid}_t${e.tid}`;
  pidTidEventCount[key] = pidTidEventCount[key] ?? 0;
  pidTidEventCount[key]++;
}

const rendererMainPidTidsStrs = Array.from(rendererMainPidTids.entries()).map(([pid, tid]) => `p${pid}_t${tid}`);
const largest = Object.entries(pidTidEventCount).sort(([aPidTid, aCount], [bPidTid, bCount]) => bCount - aCount);

const busiestMainThread = largest.find(([pidtid, count]) => rendererMainPidTidsStrs.includes(pidtid));

console.log(busiestMainThread);
busiestMainThread.split('_');






const tracingStartedEvt = {
  args: {
    data: {
      frameTreeNodeId: 7878,
      // frames: [
      //   {
      //     frame: 'FBE5CC0E358F158E69EB601FF794BA9B',
      //     name: '',
      //     processId: 6365,
      //     url: 'https://dev-main.illustrator.adobe.com/pr/15144/id/urn:aaid:sc:AP:6e48239a-7409-411d-b858-26ed79ea89f6',
      //   },
      //   {
      //     frame: '870B7B9ED96BD3C2F79A01D571AEC041',
      //     name: '',
      //     parent: 'FBE5CC0E358F158E69EB601FF794BA9B',
      //     processId: 6365,
      //     url: 'https://creativecloud.adobe.com/upload',
      //   },
      // ],
      frames: [{frame: 'FRAMEID', url: 'about:blank', name: '', processId: 1}],
      persistentIds: true,
    },
  },
  cat: 'disabled-by-default-devtools.timeline',
  name: 'TracingStartedInBrowser',
  ph: 'I',
  pid: 97524,
  s: 't',
  tid: 259,
  ts: 48500079385,
  tts: 161494822,
};

events.push(tracingStartedEvt);

console.log({rendererMainPidTids, pidTidEventCount})
