import fs from 'fs';
import {strict as assert} from 'assert';
import {saveTrace, readJson} from './trace-file-utils.mjs';
import {TraceProcessor} from '../lighthouse/core/lib/tracehouse/trace-processor.js';

const passedArg = process.argv[2];
const tracefilename = passedArg ? passedArg : './myjansatta.json';
const filename = tracefilename;

console.log('reading', tracefilename);

const text = fs.readFileSync(tracefilename, 'utf-8');
const newlines = text.split('\n').length;

let trace = JSON.parse(text);

if (Array.isArray(trace)) {
  trace = {
    traceEvents: trace,
  };
}
assert.ok(Array.isArray(trace.traceEvents) && trace.traceEvents.length);
console.log('Refomatting', trace.traceEvents.length, 'events');

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
await saveTrace(trace, afterFilename);

const after = readJson(afterFilename);
const afterText = fs.readFileSync(afterFilename, 'utf-8');
const afterNewlines = afterText.split('\n').length;
console.log('lineCount: ', newlines, '==>', afterNewlines);

if (text !== afterText && newlines !== afterNewlines) {
  console.log(`File with NEW contents written.\n  mv -f ${afterFilename} ${filename}\nChecking equality…`);
} else {
  console.log('File with SAME contents written. Checking equality…');
}

try {
  assert.deepStrictEqual(trace.traceEvents.length, after.traceEvents.length, `mismatched traceEvent lengths: ${trace.traceEvents.length.toLocaleString()} vs ${after.traceEvents.length.toLocaleString()}`);
  assert.deepStrictEqual(trace, after);
} catch (e) {
  console.error('❌ NOT A MATCH', e.message);
}
