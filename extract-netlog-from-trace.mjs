// Extract netlog from a trace.
//

import fs from 'fs';
import path from 'node:path';
import {loadTraceEventsFromFile} from './trace-file-utils.mjs';

// this was in Constants in a real netlog
const logEntryPhase = {
  PHASE_BEGIN: 1,
  PHASE_END: 2,
  PHASE_NONE: 0,
};

const traceEventPhaseTologEntryhase = {
  b: 'PHASE_BEGIN',
  e: 'PHASE_END',
  n: 'PHASE_NONE',
};

const before = [
  {
    args: {
      params: {
        operation: 'send',
        partition_key: '(none)',
        status: 'EXCLUDE_DOMAIN_MISMATCH, EXCLUDE_SAMESITE_UNSPECIFIED_TREATED_AS_LAX, DO_NOT_WARN, NO_EXEMPTION',
      },
      source_type: 'URL_REQUEST',
    },
    cat: 'netlog',
    id: '0x851',
    name: 'COOKIE_INCLUSION_STATUS',
    ph: 'n',
    pid: 19088,
    scope: 'netlog',
    tid: 16976,
    ts: 1089320204,
  },
  {
    args: {
      params: {
        operation: 'send',
        partition_key: '(none)',
        status: 'EXCLUDE_DOMAIN_MISMATCH, EXCLUDE_SAMESITE_UNSPECIFIED_TREATED_AS_LAX, DO_NOT_WARN, NO_EXEMPTION',
      },
      source_type: 'URL_REQUEST',
    },
    cat: 'netlog',
    id: '0x851',
    name: 'COOKIE_INCLUSION_STATUS',
    ph: 'n',
    pid: 19088,
    scope: 'netlog',
    tid: 16976,
    ts: 1089320207,
  },
  {
    args: {
      params: {operation: 'send', partition_key: '(none)', status: 'EXCLUDE_DOMAIN_MISMATCH, WARN_THIRD_PARTY_PHASEOUT, NO_EXEMPTION'},
      source_type: 'URL_REQUEST',
    },
    cat: 'netlog',
    id: '0x851',
    name: 'COOKIE_INCLUSION_STATUS',
    ph: 'n',
    pid: 19088,
    scope: 'netlog',
    tid: 16976,
    ts: 1089320210,
  },
];

const afterIsh = [
  {
    phase: 0,
    source: {id: 4, start_time: '21250766', type: 26},
    time: '21250766',
    type: 450,
  },
  {
    params: {
      downstream_throughput_kbps: 1600,
      effective_connection_type: '4G',
      http_rtt_ms: 115,
      transport_rtt_ms: 125,
    },
    phase: 0,
    source: {id: 1, start_time: '21250253', type: 21},
    time: '21250766',
    type: 448,
  },
  { 
    params: {
      cors_preflight_policy: 'consider_preflight',
      headers: 'Origin: https://www.google.com\r\nContent-Type: application/x-www-form-urlencoded\r\n\r\n',
      is_revalidating: false,
      method: 'POST',
      url: 'https://accounts.google.com/ListAccounts?gpsia=1&source=ChromiumBrowser&json=standard',
    },
    phase: 1,
    source: {id: 5, start_time: '21250767', type: 1},
    time: '21250767',
    type: 506,
  },
];

// https://source.chromium.org/chromium/chromium/src/+/main:net/log/net_log_event_type_list.h
const logEntryTypes = [];

// https://source.chromium.org/chromium/chromium/src/+/main:net/log/net_log_source_type_list.h;l=15-58;drc=c27c88438da17b5103e304d807846f9b45067c40
const sourceTypes = ['NONE'];

// Basically the reverse of this https://source.chromium.org/chromium/chromium/src/+/main:net/log/trace_net_log_observer.cc;l=56-80;drc=6bfd45d97e9a780d2d5a6f04be930131848eb0b2
// See also https://source.chromium.org/chromium/chromium/src/+/main:net/log/net_log_entry.cc
function eventToLogEntry(event) {
  // build out these ENUM lookups and grab the index in the entry
  logEntryTypes.includes(event.name) || logEntryTypes.push(event.name);
  const logEntryTypeIndex = logEntryTypes.indexOf(event.name);
  sourceTypes.includes(event.args.source_type) || sourceTypes.push(event.args.source_type);
  const sourceTypeIndex = sourceTypes.indexOf(event.args.source_type);

  const logEntry = {
    params: event.args,
    phase: logEntryPhase[traceEventPhaseTologEntryhase[event.ph]],
    source: {
      // the source.id is used as event id. but perfetto strings it into hex. maybe this is fine. // https://source.chromium.org/chromium/chromium/src/+/main:net/log/trace_net_log_observer.cc;l=62;drc=6bfd45d97e9a780d2d5a6f04be930131848eb0b2
      id: parseInt(event.id),
      type: sourceTypeIndex,
      start_time: event.ts.toString(), // SAD. the true source.start_time is lost. This is approximate.
    },
    time: event.ts.toString(), // SAD. the true time value is lost. This is approximate.
    type: logEntryTypeIndex,
  };
  return logEntry;
}

function extractNetlog(traceEvents) {
  const events = traceEvents.map(eventToLogEntry);
  const constants = makeConstants();
  return {
    constants,
    events,
  };
}

function makeConstants() {
  const constants = {
    logEventTypes: Object.fromEntries(Array.from(logEntryTypes.entries()).map(([index, type]) => [type, index])),
    logSourceType: Object.fromEntries(Array.from(sourceTypes.entries()).map(([index, type]) => [type, index])),
    logEventPhase: logEntryPhase,
    // areValidConstants in netlog viewer needs quite a few to pass.
    // Shrug....
    clientInfo: {},
    loadFlag: {},
    netError: {},
    addressFamily: {},
    logFormatVersion: {},
    timeTickOffset: 0,
    logFormatVersion: 1,
  };
  return constants;
}

console.log('argv', process?.argv);
// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli() {
  const filename = path.resolve(process.cwd(), process.argv[2]);

  const traceEvents = loadTraceEventsFromFile(filename);
  // const traceEvents = before;
  const netlog = extractNetlog(traceEvents);
  // console.log(netlog.constants);
  // console.log(netlog.events);
  console.log(`counts:
    eventTypes: ${Object.keys(netlog.constants.logEventTypes).length},
    sourceTypes: ${Object.keys(netlog.constants.logSourceType).length}, 
    events: ${netlog.events.length}`);

  const netlogFilename = `${filename}.netlog.json`;
  fs.writeFileSync(netlogFilename, JSON.stringify(netlog));
  console.log('Wrote ' + netlogFilename + ' to disk. ' + new Date());
}
