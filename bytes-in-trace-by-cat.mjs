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
console.log('event count: ', trace.traceEvents.length.toLocaleString())


iterateTrace();
iterateTrace({aggregateBy: true});


function iterateTrace(opts = {aggregateBy: false}) {
  const traceCats = {};
  const tracePhs = {};
  // aggregate
  let totalBytes = 0;
  let totalEvents = 0;

  if (trace.length) {
    const traceEvents = trace;
    trace = {
      traceEvents,
    };
  }
  
  trace.traceEvents.forEach(e => {
    let eventCats = e.cat;
    const splittedCats = opts.aggregateBy ? [eventCats] : eventCats.split(',');
    for (let eventId of splittedCats) {

      if (opts.aggregateBy) {
        eventId = `${e.name.padEnd(35)} (${eventId})`;
      }

      // if (e.name === 'ThreadControllerImpl::RunTask') eventId += '::::::::RunTask';
      const cat = traceCats[eventId] || {bytes: 0, count: 0};
      const bytes = JSON.stringify(e).length;
      cat.bytes += bytes;
      totalBytes += bytes;
      cat.count += 1;
      totalEvents += 1;
      traceCats[eventId] = cat;
    }
    tracePhs[e.ph] = tracePhs[e.ph] || 0;
    tracePhs[e.ph]++;
  });

  reportTotals(traceCats, totalBytes, totalEvents, tracePhs, opts);
} 


function reportTotals(traceCats, totalBytes, totalEvents, tracePhs, opts) {
  // obj to array
  const traceTotals = [];
  Object.keys(traceCats).forEach(eventId => {
    const {bytes, count} = traceCats[eventId];
    traceTotals.push({name: eventId, bytes, count});
  });

  // sort and log
  console.log('');
  console.log('Bytes'.padStart(16), '\t', 'Count'.padStart(16).padEnd(18), '\t', (opts.aggregateBy ? ('Event Name'.padEnd(35) + ' (cat)') : 'Category'))
  
  let skipped = {bytes: 0, count: 0};
  traceTotals.sort((a, b) => b.bytes - a.bytes).forEach((tot, i) => {  // sort by bytes.. can change to sort by eventCount here instead.
    const bytesPct = tot.bytes * 100/ totalBytes;
    if (bytesPct < 1) {
      skipped.bytes += tot.bytes;
      skipped.count += tot.count;
      return; // dont output.
    }

    console.log(
      tot.bytes.toLocaleString().padStart(15), 
      `${(bytesPct).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
      '\t', 
      tot.count.toLocaleString().padStart(9), 
      `${(tot.count * 100/ totalEvents).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
      '\t', 
      tot.name
    );
  })

  // skipped
  console.log(
    skipped.bytes.toLocaleString().padStart(15), 
    `${( skipped.bytes * 100/ totalBytes).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
    '\t', 
    skipped.count.toLocaleString().padStart(9), 
    `${(skipped.count * 100/ totalEvents).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
    '\t', 
    '[(Rows that were < 1% of bytes)]'
  );

  // phase counts
  // if (!opts.aggregateBy) {
  //   console.log('\n Phases:')
  //   Object.entries(tracePhs).sort((a, b) => b[1] - a[1]).forEach(([ph, count]) => console.log(`ph(${ph}): ${count.toLocaleString()}`) );
  //   // console.log({tracePhs});    
  // }
}
