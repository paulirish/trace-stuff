/* eslint-disable */
'use strict';


import fs from 'node:fs';

const passedArg = process.argv[2];
const filename = passedArg ? passedArg : './scroll-tl-viewer.json';

console.log('Parsing: ', filename);
const stat = fs.statSync(filename);
console.log('size:' ,  ( stat.size / 1_000_000).toLocaleString(), 'MB');
console.log('first by event name + category. then by category');

let trace = JSON.parse(fs.readFileSync(filename, 'utf-8'));


function cool() {
  const eventNames = {};


  if (trace.length) {
    const traceEvents = trace;
    trace = {
      traceEvents,
    };
  }
  console.log('event count: ', trace.traceEvents.length.toLocaleString())

  trace.traceEvents.forEach(e => {
    let eventCats = e.cat;
    const frame = e.args.frame ?? e.args.data?.frame;

    if (e.ph === 'R' || e.ph === 'I') return;
    if (frame) {
      eventNames[`${e.cat.padEnd(50)} ${e.name}     ${e.ph}`] = frame;

    }

  });

  console.log(Object.keys(eventNames).sort());

  const argValues = Array.from(new Set(Object.values(eventNames)));

  console.log(argValues.sort());

} 


cool(false);




function groupAndOutput(traceCats, totalBytes, totalEvents) {
  // obj to array
  const traceTotals = [];
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
