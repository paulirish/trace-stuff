
// Save a "properly formatted" version of the trace (with a new filename). 

import path from 'node:path';
import type * as TraceEvents from '@paulirish/trace_engine/models/trace/types/TraceEvents.js';
import {saveTrace, loadTraceEventsFromFile} from './trace-file-utils.ts';

export async function resaveTrace(
  filename: string,
  _filterEventFn?: (event: TraceEvents.Event) => boolean,
): Promise<void> {
  const traceEvents = await loadTraceEventsFromFile(filename);
  const afterFilename = `${filename}.formatted.json`;
  await saveTrace({traceEvents}, afterFilename);
  console.log(`Written: ${afterFilename}`);
}

// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli(): Promise<void> {
  const filename = path.resolve(process.cwd(), process.argv[2]);
  await resaveTrace(filename); // , filterEventFn);
}
