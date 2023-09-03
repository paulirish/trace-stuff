import {loadTraceEventsFromFile, saveTrace} from './trace-file-utils.mjs';

const passedArg = process.argv[2];
const tracefilename = passedArg ? passedArg : './myjansatta.json';

/** @type {TraceEvent[]} */
const events = loadTraceEventsFromFile(tracefilename);
console.log(events.length);

let minTs = Infinity;
const threads = [];
const pidToThreadLookup = {};
const eventToThread = new Map();

class Thread {
  constructor(pid, tid, thread_name) {
    this.pid = pid;
    this.tid = tid;
    this.thread_name = thread_name;

    this.events = [];
    this.label;
    this.process_name;

    threads.push(this);
    pidToThreadLookup[pid] = pidToThreadLookup[pid] ?? {};
    pidToThreadLookup[pid][tid] = this;
  }
}

// metadataevents are always at the start
for (const e of events.slice(0, 1000)) {
  if (e.ph === 'M' && e.name === 'thread_name') {
    const thread =
      threads.find(t => t.tid === e.tid && t.pid === e.pid) ??
      new Thread(e.pid, e.tid, e.args.name);
    eventToThread.set(e, thread);
  }
  if (e.ph === 'M' && e.name === 'process_name') {
    threads.filter(t => t.pid === e.pid).forEach(t => (t.process_name = e.args.name));
  }
}

// Loop over all. assign events to threads. collect minTs
for (const e of events) {
  if (e.ph === 'M' && e.name === 'process_labels') {
    const thread = pidToThreadLookup[e.pid][e.tid];
    thread.label = e.args.labels;
  }
  if (e.ph === 'M') continue; // dont attempt with metadata
  const thread = pidToThreadLookup[e.pid][e.tid];
  if (!thread) throw new Error(`no thread for ${e.pid} ${e.tid}`);
  thread.events.push(e);

  if (e.ts !== 0) {
    minTs = Math.min(minTs, e.ts);
  }
}

// Find busiest main thread and frame
const rendererMains = threads.filter(
  t => t.thread_name === 'CrRendererMain' && t.process_name === 'Renderer'
);
rendererMains.sort((aThread, bThread) => bThread.events.length - aThread.events.length);
const busiestMainThread = rendererMains.at(0);

const frameToCount = new Map();
busiestMainThread.events.forEach(e => {
  const frame = e.args.frame ?? e.args.data?.frame;
  if (!frame || typeof frame !== 'string') return;

  let count = frameToCount.get(frame) ?? 0;
  count++;
  frameToCount.set(frame, count);
});

const busiestFrame = Array.from(frameToCount.entries())
  .sort(([aFrame, aCount], [bBrame, bCount]) => bCount - aCount)
  .at(0);
const busiestFrameId = busiestFrame[0];


/**
 * @return {LH.TraceEvent}
 */
function createFakeTracingStartedInPage() {
  return {
    pid: busiestMainThread.pid,
    tid: busiestMainThread.tid,
    cat: 'devtools.timeline',
    ts: minTs,
    ph: 'I',
    s: 't',
    cat: 'disabled-by-default-devtools.timeline',
    name: 'TracingStartedInPage',
    args: {
      data: {
        frameTreeNodeId: 1,
        page: busiestFrameId,
        persistentIds: true,
        frames: [
          {frame: busiestFrameId, url: 'https://sdflkdsf.com', name: busiestMainThread.label, processId: busiestMainThread.pid},
        ],
      },
    },
    dur: 0,
  };
}

// startedinpage is LEGACY behavior but... i need it right now cuz the inbrowser path aint working. and im too lazy to figure out why
events.push(createFakeTracingStartedInPage());
// events.push({...createFakeTracingStartedInPage(), name: 'TracingStartedInBrowser'});
// events.sort((a, b) => a.ts - b.ts); // apparently this still works even with startedinpage is at the end.
 
await saveTrace({traceEvents: events}, `${tracefilename}.dt.json`);

console.log('done');