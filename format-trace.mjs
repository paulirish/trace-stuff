
// Save a "properly formatted" version of the trace (with a new filename). 

import path from 'node:path';
import {saveTrace, loadTraceEventsFromFile} from './trace-file-utils.mjs';

export async function resaveTrace(filename, filterEventFn) {
  const traceEvents = loadTraceEventsFromFile(filename);
  const afterFilename = `${filename}.formatted.json`;
  await saveTrace({traceEvents}, afterFilename);
  console.log(`Written: ${afterFilename}`);
}

// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli() {
  const filename = path.resolve(process.cwd(), process.argv[2]);
  await resaveTrace(filename); // , filterEventFn);
}
