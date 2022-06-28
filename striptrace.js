/* eslint-disable */

// run with:
// node .generatereporthtml.js > fast.html; open fast.html
'use strict';

const fs = require('fs');

const trace = require('../lighthouse-core/test/fixtures/traces/ .......');

// const events = trace.traceEvents.filter(e =>
//   !e.cat.includes('toplevel') && !e.cat.includes('netlog'));

const evtNames = [
  'navigationStart',
  'TracingStartedInPage',
  'firstContentfulPaint',
  'firstPaint',
  'firstContentfulPaint',
  'firstMeaningfulPaint',
  'firstMeaningfulPaintCandidate',
];

const events = trace.traceEvents.filter(e => evtNames.includes(e.name));

const json = JSON.stringify({traceEvents: events}, null, 2);
fs.writeFileSync('../paulirish.stripped.json', json);
