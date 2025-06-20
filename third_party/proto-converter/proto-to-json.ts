// Copyright 2019 the V8 project authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// From https://chromium-review.googlesource.com/c/v8/v8/+/1535823
/**
 *               TRACE_STUFF NOTES
 * 
 * 1. use node 23+ to run this .ts without compiling. https://nodejs.org/en/learn/typescript/run-natively
 * 1. open ui.perfetto.dev. load chrome example. hit download.
 * 1. node proto-to-json.ts $HOME/chromium/src/third_party/perfetto/protos/perfetto/trace/trace.proto $HOME/Downloads/chrome_example_wikipedia.perfetto_trace.gz ./out-converted.json

 *  Something dumb about proto path resolving.. i need an edit in `node_modules/protobufjs/src/root.js`. add this line  within the `fetch` function. L128:
                 filename = filename.replace('protos/protos', 'protos')

 This fails on a newly captured trace, which doesn't make sense since we're refererencing ToT protos.
  Much of the logic is definitely outdated and it'll take work to nurse it back to something useful.

 * 
 * */

import * as fs from 'fs';
import * as path from 'path';
import pkg from 'protobufjs';
const {Root} = pkg;
import {saveTrace} from '../../trace-file-utils.mjs';

// Usage: node proto-to-json.ts path_to_trace.proto input_file output_file

// Converts a binary proto file to a 'Trace Event Format' compatible .json file
// that can be used with chrome://tracing. Documentation of this format:
// https://docs.google.com/document/d/1CvAClvFfyA5R-PhYUmn5OOQtYMH4h6I0nSsKchNAySU

// Attempts to reproduce the logic of the JSONTraceWriter in V8 in terms of the
// JSON fields it will include/exclude based on the data present in the trace
// event.

// Convert a string representing an int or uint (64 bit) to a Number or throw
// if the value won't fit.
function parseIntOrThrow(int: string) {
  if (BigInt(int) > Number.MAX_SAFE_INTEGER) {
    throw new Error('Loss of int precision');
  }
  return Number(int);
}

function uint64AsHexString(val: string): string {
  return '0x' + BigInt(val).toString(16);
}

function parseArgValue(arg: any): any {
  if (arg.jsonValue) {
    return JSON.parse(arg.jsonValue);
  }
  if (typeof arg.stringValue !== 'undefined') {
    return arg.stringValue;
  }
  if (typeof arg.uintValue !== 'undefined') {
    return parseIntOrThrow(arg.uintValue);
  }
  if (typeof arg.intValue !== 'undefined') {
    return parseIntOrThrow(arg.intValue);
  }
  if (typeof arg.boolValue !== 'undefined') {
    return arg.boolValue;
  }
  if (typeof arg.doubleValue !== 'undefined') {
    // Handle [-]Infinity and NaN which protobufjs outputs as strings here.
    return typeof arg.doubleValue === 'string' ? arg.doubleValue : Number(arg.doubleValue);
  }
  if (typeof arg.pointerValue !== 'undefined') {
    return uint64AsHexString(arg.pointerValue);
  }
}

// These come from
// https://cs.chromium.org/chromium/src/base/trace_event/common/trace_event_common.h
const TRACE_EVENT_FLAG_HAS_ID: number = 1 << 1;
const TRACE_EVENT_FLAG_FLOW_IN: number = 1 << 8;
const TRACE_EVENT_FLAG_FLOW_OUT: number = 1 << 9;

async function main() {
  const root = new Root();
  const {resolvePath} = root;
  const numDirectoriesToStrip = 2;
  let initialOrigin: string | null;
  root.resolvePath = (origin, target) => {
    if (!origin) {
      initialOrigin = target;
      for (let i = 0; i <= numDirectoriesToStrip; i++) {
        initialOrigin = path.dirname(initialOrigin);
      }
      return resolvePath(origin, target);
    }
    return path.resolve(initialOrigin!, target);
  };
  const traceProto = await root.load(process.argv[2]);
  const Trace = traceProto.lookupType('Trace');
  const payload = await fs.promises.readFile(process.argv[3]);
  const msg = Trace.decode(payload).toJSON();

  const toJSONEvent = (e: any) => {
    const bind_id = e.flags & (TRACE_EVENT_FLAG_FLOW_IN | TRACE_EVENT_FLAG_FLOW_OUT) ? e.bindId : undefined;
    const scope = e.flags & TRACE_EVENT_FLAG_HAS_ID && e.scope ? e.scope : undefined;

    return {
      pid: e.trustedPid,
      tid: e.trustedUid,
      ts: parseIntOrThrow(e.timestamp),
      // tts: parseIntOrThrow(e.threadTimestamp),
      ph: String.fromCodePoint(e.phase),
      cat: e.categoryGroupName,
      name: e.name,
      dur: parseIntOrThrow(e.duration),
      tdur: parseIntOrThrow(e.threadDuration),
      bind_id: bind_id,
      flow_in: e.flags & TRACE_EVENT_FLAG_FLOW_IN ? true : undefined,
      flow_out: e.flags & TRACE_EVENT_FLAG_FLOW_OUT ? true : undefined,
      scope: scope,
      id: e.flags & TRACE_EVENT_FLAG_HAS_ID ? uint64AsHexString(e.id) : undefined,
      args: (e.args || []).reduce((js_args: any, proto_arg: any) => {
        js_args[proto_arg.name] = parseArgValue(proto_arg);
        return js_args;
      }, {}),
    };
  };

  debugger;

  // const chromeEventsPkts = msg.packet.filter((packet: any) => !!packet.chromeEvents);
  const trackEventPkts = msg.packet.filter((packet: any) => !!packet.trackEvent);

  // TODO: do something with msg.packet.filter((packet: any) => !!packet.chromeEvents).map(e => e.chromeEvents.metadata)
  // TODO: maybe there's something hiding in chromeEvents.traceEvents but i think not.

  const traceEvents = trackEventPkts.map(toJSONEvent).flat();

  const output = {
    traceEvents,
  };

  await saveTrace(output, process.argv[4]);
  // await fs.promises.writeFile(process.argv[4], JSON.stringify(output, null, 2));
}

main().catch(console.error);
