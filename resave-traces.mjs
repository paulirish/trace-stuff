
// Save a "properly formatted" version of the trace (with a new filename). Optionally write a filter predicate to remove excess stuff.

import fs from 'node:fs';
import path from 'node:path';
import {strict as assert} from 'assert';
import {saveTrace, loadTraceEventsFromFile} from './trace-file-utils.mjs';
import {TraceProcessor} from '../lighthouse/core/lib/tracehouse/trace-processor.js';

export async function resaveTrace(filename, filterEventFn) {
  const traceEvents = loadTraceEventsFromFile(filename);
  const text = fs.readFileSync(filename, 'utf-8');
  const newlines = text.split('\n').length;

  console.log('Refomatting', traceEvents.length, 'events');

  const afterTraceEvents = TraceProcessor.filteredTraceSort(traceEvents, e => {
    // Remove events potentially
    if (typeof filterEventFn === 'function') {
      return filterEventFn(e);
    }
    return true;
  });

  const afterFilename = `${filename}.formatted.json`;
  await saveTrace({traceEvents: afterTraceEvents}, afterFilename);
  console.log(`Written: ${afterFilename}`);

  const afterText = fs.readFileSync(afterFilename, 'utf-8');
  const afterNewlines = afterText.split('\n').length;
  console.log('lineCount:  ', newlines, '==>', afterNewlines);
  console.log('eventCount: ', traceEvents.length, '==>', afterTraceEvents.length);

  if (text !== afterText && newlines !== afterNewlines) {
    console.log(`File with NEW contents written.\n  mv -f ${afterFilename} ${filename}\nChecking equality…`);
  } else {
    console.log('File with SAME contents written. Checking equality…');
  }

  try {
    assert.deepStrictEqual(afterTraceEvents.length, traceEvents.length, `mismatched traceEvent lengths: ${traceEvents.length.toLocaleString()} vs ${afterTraceEvents.length.toLocaleString()}`);
    // assert.deepStrictEqual(afterTraceEvents, traceEvents);
    console.log('✅');
  } catch (e) {
    console.error('❌ NOT A MATCH', e.message);
  }
}


// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli() {
  const filename = path.resolve(process.cwd(), process.argv[2]);
  await resaveTrace(filename); // , filterEventFn);
}


// return true to keep. false to drop
function filterEventFn(e) {
  // if (e.cat === '__metadata') return true;
  // if (e.ts < 460744042539) return true;
  // if (e.tid === 259) return true;

  return false;
}


  //     // // strip these events out of the new one
  //     // if ([
  //     //   //'V8.ParseFunction', 'V8.CompileIgnition', 'V8.CompileIgnitionFinalization', 'v8.compile',
  //     //   'V8.CompileCode'].includes(e.name)) return false;

  //     // // Crop trace by time range. works, but the CPU Profiles dont get cropped which gets kinda weird.
      // return e.ts === 0 || e.ts > 79939510042 || e.name.startsWith('Profile') ||
      //   ['FrameCommittedInBrowser', 'TracingStartedInBrowser'].includes(e.name);
    