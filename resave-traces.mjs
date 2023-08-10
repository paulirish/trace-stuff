import fs from 'fs';
import {strict as assert} from 'assert';

import {saveTrace, readJson} from './save-file-formatter.mjs';
import {TraceProcessor} from '../lighthouse/core/lib/tracehouse/trace-processor.js';

const passedArg = process.argv[2];
const tracefilename = passedArg ? passedArg : './myjansatta.json';
const filename = tracefilename;

console.log('reading', tracefilename);

const text = fs.readFileSync(tracefilename, 'utf-8');
const newlines = text.split('\n').length;

console.log({newlines});
let trace = JSON.parse(text);
let events = trace.traceEvents || trace;

if (Array.isArray(trace)) {
  trace = {
    traceEvents: trace,
  };
}
console.log('ok', trace.traceEvents.length);
assert.ok(Array.isArray(events) && events.length);

// // remove stuff i guess?
// const sorted = TraceProcessor.filteredTraceSort(trace.traceEvents, e => {
//     // // strip these events out of the new one
//     // if ([
//     //   //'V8.ParseFunction', 'V8.CompileIgnition', 'V8.CompileIgnitionFinalization', 'v8.compile',
//     //   'V8.CompileCode'].includes(e.name)) return false;

//     // // Crop trace by time range ( think)
//     // return e.ts === 0 || (e.ts > 437555855961 && e.ts < 437555867350) || e.name.startsWith('Profile') ||
//     //   ['FrameCommittedInBrowser', 'TracingStartedInBrowser'].includes(e.name);
// });

const afterFilename = `${filename}.formatted.json`;
debugger;
await saveTrace(trace, afterFilename);

const after = readJson(afterFilename);
const afterText = fs.readFileSync(afterFilename, 'utf-8');
const afterNewlines = afterText.split('\n').length;
console.log(newlines, '==>', afterNewlines);

if (text !== afterText && newlines !== afterNewlines) {
  console.log(`mv -f ${afterFilename} ${filename}\n`);
} else {
  console.log('');
}

try {
  assert.deepStrictEqual(trace.traceEvents.length, after.traceEvents.length, `mismatched traceEvent lengths: ${trace.traceEvents.length.toLocaleString()} vs ${after.traceEvents.length.toLocaleString()}`);
  assert.deepStrictEqual(trace, after);
} catch (e) {
  console.error('❌ NOT A MATCH', e.message);
}
