/* eslint-disable */
'use strict';


import fs from 'node:fs';
import type * as TraceEvents from '@paulirish/trace_engine/models/trace/types/TraceEvents.js';

type TraceFile = {
  traceEvents: TraceEvents.Event[];
};

type TraceTotal = {
  bytes: number;
  events: number;
};

const passedArg = process.argv[2];
const filename = passedArg ? passedArg : './scroll-tl-viewer.json';

console.log('Parsing: ', filename);
const stat = fs.statSync(filename);
console.log('size:' ,  ( stat.size / 1_000_000).toLocaleString(), 'MB');
console.log('first by event name + category. then by category');

let trace = JSON.parse(fs.readFileSync(filename, 'utf-8')) as TraceFile|TraceEvents.Event[];


function cool() {
  const eventNames: Record<string, unknown> = {};


  if (Array.isArray(trace)) {
    const traceEvents = trace;
    trace = {
      traceEvents,
    };
  }
  console.log('event count: ', trace.traceEvents.length.toLocaleString())

  trace.traceEvents.forEach(e => {
    let eventCats = e.cat;
    const frame = e.args && 'frame' in e.args ? e.args.frame : e.args?.data?.frame;

    if (e.ph === 'R' || e.ph === 'I') return;
    if (frame) {
      eventNames[`${e.cat.padEnd(50)} ${e.name}     ${e.ph}`] = frame;

    }

  });

  console.log(Object.keys(eventNames).sort());

  const argValues = Array.from(new Set(Object.values(eventNames)));

  console.log(argValues.sort());

} 


cool();




function groupAndOutput(
  traceCats: Record<string, TraceTotal>,
  totalBytes: number,
  totalEvents: number,
): void {
  // obj to array
  const traceTotals: Array<TraceTotal & {name: string}> = [];
  Object.keys(traceCats).forEach(catname => {
    const cat = traceCats[catname];
    traceTotals.push({name: catname, bytes: cat.bytes, events: cat.events});
  });

  // sort and log
  console.log('\n');
  console.log('Bytes'.padStart(16), '\t', 'Count'.padStart(7), '\t', 'Event Name'.padStart(18))
  
  let skipped = {bytes: 0, events: 0};
  traceTotals.sort((a, b) => b.bytes - a.bytes).forEach((tot, i) => {
    const bytesPct = tot.bytes * 100/ totalBytes;
    if (bytesPct < 1) {
      skipped.bytes += tot.bytes;
      skipped.events += tot.events;
      return; // dont output.
    }

    console.log(
      tot.bytes.toLocaleString().padStart(15), 
      `${(bytesPct).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
      '\t', 
      tot.events.toLocaleString().padStart(9), 
      `${(tot.events * 100/ totalEvents).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
      '\t', 
      tot.name
    );
  })

  // skipped
  console.log(
    skipped.bytes.toLocaleString().padStart(15), 
    `${( skipped.bytes * 100/ totalBytes).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
    '\t', 
    skipped.events.toLocaleString().padStart(9), 
    `${(skipped.events * 100/ totalEvents).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
    '\t', 
    '[(Rows that were < 1% of bytes)]'
  );
}
