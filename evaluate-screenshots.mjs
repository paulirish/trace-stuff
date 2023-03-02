/* eslint-disable */
'use strict';


import fs from 'node:fs';

const passedArg = process.argv[2];
const filename = passedArg ? passedArg : './scroll-tl-viewer.json';

console.log('Parsing: ', filename);
const stat = fs.statSync(filename);
console.log('size:' ,  ( stat.size / 1_000_000).toLocaleString(), 'MB');

let trace = JSON.parse(fs.readFileSync(filename, 'utf-8'));

if (trace.length) {
  const traceEvents = trace;
  trace = {
    traceEvents,
  };
}


console.log('event count: ', trace.traceEvents.length.toLocaleString())

const screenshotEvts = trace.traceEvents.filter(e => {
  return e.cat === 'disabled-by-default-devtools.screenshot';
}).sort((a, b) => a.ts - b.ts);

console.log('screenshot event count: ', screenshotEvts.length.toLocaleString())
const timeDeltas = screenshotEvts.map((evt, i) => {
  if (i === 0) return 0;
  return evt.ts - screenshotEvts[i - 1].ts
});
const timeDeltaMap = new Map();
for (const delta of timeDeltas) {
  let sum = timeDeltaMap.get(delta) || 0;
  sum++;
  timeDeltaMap.set(delta, sum);
}

console.log({timeDeltaMap})


let sizeSum = 0;
screenshotEvts.forEach(e => {
  sizeSum += (JSON.stringify(e).length);
})

console.log({sizeSum: (sizeSum / 1000).toLocaleString() + ' kb'})



const duration = (screenshotEvts.at(-1).ts - screenshotEvts.at(0).ts) / 1000;
console.log({duration});

console.log('bitrate (bytes per sec): ', sizeSum / (duration / 1000));
// the video is roughly 10x more byte-cost effective. (a tenth of the size)


const droppedFramePct = screenshotEvts.length / (duration / 16.66666);
console.log('dropped frame %:', ((1 - droppedFramePct) * 100).toLocaleString())

