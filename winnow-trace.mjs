// Use a filter predicate to remove excess stuff. eg: stripping down to a timerange, only keeping metadata, just removing `disabled-by-default.v8.compile`

import path from 'node:path';
import {saveTrace, loadTraceEventsFromFile} from './trace-file-utils.mjs';
// TODO: get rid of this dependency.
import {TraceProcessor} from '../lighthouse/core/lib/tracehouse/trace-processor.js';

// return true to keep. false to drop
function filterEventFn(e) {
  return true;

  // Crop trace by time range. works, but the CPU Profiles dont get cropped which gets kinda weird.
  // return e.ts === 0 || e.ts > 79939510042 || e.name.startsWith('Profile') ||
  //   ['FrameCommittedInBrowser', 'TracingStartedInBrowser'].includes(e.name);

  // if (e.cat === '__metadata') return true;
  // if (e.ts < 460744042539) return true;
  // if (e.tid === 259) return true;
  // if (['V8.ParseFunction', 'V8.CompileIgnition', 'V8.CompileIgnitionFinalization', 'v8.compile', 'V8.CompileCode'].includes(e.name)) return false;
}

export async function resaveTrace(filename, filterEventFn) {
  const traceEvents = loadTraceEventsFromFile(filename);
  console.log('Refomatting', traceEvents.length, 'events');

  const afterTraceEvents = TraceProcessor.filteredTraceSort(traceEvents, e => filterEventFn(e));

  const afterFilename = `${filename}.winnowed.json`;
  await saveTrace({traceEvents: afterTraceEvents}, afterFilename);
  console.log(`Written: ${afterFilename}`);

  console.log('eventCount: ', traceEvents.length, '==>', afterTraceEvents.length);
}

// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli() {
  const filename = path.resolve(process.cwd(), process.argv[2]);
  await resaveTrace(filename, filterEventFn);
}
