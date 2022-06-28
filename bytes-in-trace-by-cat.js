/* eslint-disable */
'use strict';

let trace = require('./jansatta-profile-report.json');




// const cats = {};
// // aggregate
// trace.traceEvents.forEach(e => {
//   let eventCat = e.cat;
//   if (e.name === 'ThreadControllerImpl::RunTask') eventCat += '::::::::RunTask';
//   const cat = cats[eventCat] || {bytes: 0, events: 0};
//   cat.bytes += JSON.stringify(e).length;
//   cat.events += 1;
//   cats[eventCat] = cat;
// });

// // obj to array
// const totals = [];
// Object.keys(cats).forEach(catname => {
// 	const cat = cats[catname];
// 	totals.push({name: catname, bytes: cat.bytes, events: cat.events});
// });

// // sort and log
// console.log('Bytes', '\t', 'Count', '\t', 'Event Name')
// totals.sort((a, b) => b.bytes - a.bytes).forEach((tot, i) => {
// 	console.log(tot.bytes.toLocaleString(), i < 8 ? '\t' : '\t', tot.events, '\t', tot.name);
// })


// const {traceCategories} = require('../lighthouse-core/gather/driver');

const traceCats = {};
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
  for (let eventCat of eventCats.split(',')) {
    // don't process cats we dont trace
    // if (!traceCategories.includes(eventCat)) return;
    if (e.name === 'ThreadControllerImpl::RunTask') eventCat += '::::::::RunTask';
    const cat = traceCats[eventCat] || {bytes: 0, events: 0};
    const bytes = JSON.stringify(e).length;
    cat.bytes += bytes;
    totalBytes += bytes;
    cat.events += 1;
    totalEvents += 1;
    traceCats[eventCat] = cat;
  }
});




// obj to array
const traceTotals = [];
Object.keys(traceCats).forEach(catname => {
	const cat = traceCats[catname];
	traceTotals.push({name: catname, bytes: cat.bytes, events: cat.events});
});

// sort and log
console.log('Bytes'.padStart(16), '\t', 'Count'.padStart(7), '\t', 'Event Name'.padStart(18))
traceTotals.sort((a, b) => b.bytes - a.bytes).forEach((tot, i) => {
	console.log(
    tot.bytes.toLocaleString().padStart(15), 
    `${(tot.bytes * 100/ totalBytes).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
    '\t', 
    tot.events.toString().padStart(9), 
    `${(tot.events * 100/ totalEvents).toLocaleString(undefined, {maximumFractionDigits: 1})}%`.padStart(6),
    '\t', 
    tot.name
  );
})

