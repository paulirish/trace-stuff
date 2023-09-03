import { loadTraceEventsFromFile, saveTrace } from './trace-file-utils.mjs';

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

const threads = [];
const pidToThreadLookup = {};
const eventToThread = new Map(); // maybe also thread needs an array of events?

class Thread {
  constructor(pid, tid, thread_name) {
    this.pid = pid;
    this.tid = tid;
    this.thread_name = thread_name;
    this.process_name;
    this.events = [];

    threads.push(this);
    pidToThreadLookup[pid] = pidToThreadLookup[pid] ?? {};
    pidToThreadLookup[pid][tid] = this;
  }
}


// metadataevents are always at the start
for (const e of events.slice(0, 1000)) {
  if (e.ph === 'M' && e.name === 'thread_name') {
    const thread = threads.find(t => t.tid === e.tid && t.pid === e.pid) ?? new Thread(e.pid, e.tid, e.args.name);
    eventToThread.set(e, thread);
  }
  if (e.ph === 'M' && e.name === 'process_name') {
    threads.filter(t => t.pid === e.pid).forEach(t => t.process_name = e.args.name);
  }
}

for (const e of events) {
  if (e.ph === 'M') continue; // dont attempt with metadata
  const thread = pidToThreadLookup[e.pid][e.tid];
  if (!thread) throw new Error(`no thread for ${e.pid} ${e.tid}`);
  thread.events.push(e);

  if (e.ts !== 0) {
    minTs = Math.min(minTs, e.ts);
  }
}

const rendererMains = threads.filter(t => t.thread_name === 'CrRendererMain' && t.process_name === 'Renderer');
rendererMains.sort((aThread, bThread) => bThread.events.length - aThread.events.length);

const busiestMainThread = rendererMains.at(0);

// console.log(busiestMainThread);
// busiestMainThread.split('_');


const frames = new Set();
busiestMainThread.events.forEach(e => {
  const frame = e.args.frame ?? e.args.data?.frame;
  if (!frame || typeof frame !== 'string') return;
  frames.add(frame);
});


console.log(frames)


// p77830_t259


  const baseEvent = {pid: 22854, tid: 259, cat: 'devtools.timeline'};


  /**
   * @return {LH.TraceEvent}
   */
  function createFakeTracingStartedEvent() {
    const argsData = {
      frameTreeNodeId: 1,
      sessionId: '1.1',
      page: '_FRAMEID_',
      persistentIds: true,
      frames: [{frame: '_FRAMEID_', url: 'about:blank', name: '', processId: 1}],
    };

    return {
      ...baseEvent,
      ts: minTs,
      ph: 'I',
      s: 't',
      cat: 'disabled-by-default-devtools.timeline',
      name: 'TracingStartedInPage',
      args: {data: argsData},
      dur: 0,
    };
  }

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
  pid: 77830,
  s: 't',
  tid: 259,
  ts: minTs,
  ts: minTs,
};

events.push(createFakeTracingStartedEvent());
events.push({...createFakeTracingStartedEvent(), name: 'TracingStartedInBrowser'});
// console.log({rendererMainPidTids, pidTidEventCount})
const sorted = events.sort((a, b) => a.ts - b.ts);

await saveTrace({traceEvents: sorted}, `${tracefilename}.dt.json`);

