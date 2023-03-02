

import fs from 'fs';
import {strict as assert} from 'assert';

import {saveTrace} from '../lighthouse/core/lib/asset-saver.js';
import {readJson} from '../lighthouse/core/test/test-utils.js';
import {TraceProcessor} from '../lighthouse/core/lib/tracehouse/trace-processor.js';


const passedArg = process.argv[2];
const tracefilename = passedArg ? passedArg : './myjansatta.json';
const filename = tracefilename;
let trace = JSON.parse(fs.readFileSync(tracefilename, 'utf-8'));
let events = trace.traceEvents || trace;




  console.log('reading', tracefilename);

  const text = fs.readFileSync(tracefilename, 'utf-8');
  const newlines = text.split('\n').length;



  if (Array.isArray(trace)) {
    trace = {
      traceEvents: trace,
    };
  }
  assert.ok(Array.isArray(events) && events.length);


  debugger;
  const sorted = TraceProcessor.filteredTraceSort(trace.traceEvents, e => {
    // return true;


    // remove these.
    if ([
      //'V8.ParseFunction', 'V8.CompileIgnition', 'V8.CompileIgnitionFinalization', 'v8.compile', 
      'V8.CompileCode'].includes(e.name)) return false;
    
    return e.ts === 0 || (e.ts > 437555855961 && e.ts < 437555867350) || e.name.startsWith('Profile') || 
    ['FrameCommittedInBrowser', 'TracingStartedInBrowser'].includes(e.name)
  });
  trace = {
      traceEvents: sorted,
    };

  // console.log(Object.keys(trace), trace.traceEvents?.length);

  const afterFilename = `${filename}.sorted.json`;
  await saveTrace(trace, afterFilename);

  const after = readJson(afterFilename, import.meta);
  const afterText = fs.readFileSync(afterFilename, 'utf-8');
  const afterNewlines = afterText.split('\n').length;
  console.log(newlines, '==>', afterNewlines);

  if (text !== afterText && newlines !== afterNewlines) {
    console.log(`mv -f ${afterFilename} ${filename}\n`);
  } else {
    console.log('');
  }

  try {
    assert.deepStrictEqual(trace, after, file);
  } catch (e) {
    console.error('❌ NOT A MATCH', e.message);
  }


