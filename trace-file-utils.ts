// pulled from DT FE savefileformatter.ts, which was based on lighthouse's asset-saver.

import stream from 'stream';
import fs from 'fs';
import zlib from 'zlib';
import {strict as assert} from 'assert';

import {open, stat} from 'node:fs/promises';
import type * as TraceEvents from '@paulirish/trace_engine/models/trace/types/TraceEvents.js';

import {TraceEventStreamingParser, parseTraceJsonAsStream} from './trace-stream-parse.mts'

type TraceFile = {
  traceEvents: readonly TraceEvents.Event[];
  metadata?: unknown;
  [key: string]: unknown;
};

type Netlog = {
  events: unknown[];
  constants: unknown;
  [key: string]: unknown;
};

export type LoadedTraceEvents = TraceEvents.Event[] & {metadata?: unknown};

/**
 * Generates a JSON representation of an array of objects with the objects
 * printed one per line for a more readable (but not too verbose) version.
 * @param {Array<unknown>} arrayOfObjects
 * @return {IterableIterator<string>}
 */
function* arrayOfObjectsJsonGenerator(arrayOfObjects: readonly unknown[]): IterableIterator<string> {
  const ITEMS_PER_ITERATION = 10_000;

  // Stringify and emit items separately to avoid a giant string in memory.
  yield '[\n';
  if (arrayOfObjects.length > 0) {
    const itemsIterator = arrayOfObjects[Symbol.iterator]();
    // Emit first item manually to avoid a trailing comma.
    const firstItem = itemsIterator.next().value;
    yield `  ${JSON.stringify(firstItem)}`;

    let itemsRemaining = ITEMS_PER_ITERATION;
    let itemsJSON = '';
    for (const item of itemsIterator) {
      itemsJSON += `,\n  ${JSON.stringify(item)}`;
      itemsRemaining--;
      if (itemsRemaining === 0) {
        yield itemsJSON;
        itemsRemaining = ITEMS_PER_ITERATION;
        itemsJSON = '';
      }
    }
    yield itemsJSON;
  }
  yield '\n]';
}




/**
 * Generates a JSON representation of trace line-by-line for a nicer printed
 * version with one trace event per line.
 * @param {readonly TraceEngine.Types.TraceEvents.TraceEventData[]} traceEvents 
 * @param {Readonly<TraceEngine.Types.File.MetaData>|null} metadata
 * @return IterableIterator<string>
 */
export function* traceJsonGenerator(trace: TraceFile): IterableIterator<string> {
const {traceEvents, metadata, ...rest} = trace;
  if (Object.keys(rest).length) throw new Error('unexpected contents in tracefile. not traceEvents or metadata! : ' + JSON.stringify(rest).slice(0, 1000));

  yield '{"traceEvents": ';
  yield* arrayOfObjectsJsonGenerator(traceEvents);
  if (metadata) {
    yield `,\n"metadata": ${JSON.stringify(metadata, null, 2)}`;
  }
  yield '}\n';
}

/**
 * Save a trace as JSON by streaming to disk at traceFilename.
 * @param {LH.Trace} trace
 * @param {string} traceFilename
 * @return {Promise<void>}
 */
export async function saveTrace(trace: TraceFile, traceFilename: string): Promise<void> {
  const traceIter = traceJsonGenerator(trace);
  const writeStream = fs.createWriteStream(traceFilename);

  return stream.promises.pipeline(traceIter, writeStream);
}

/**
 * Save a devtoolsLog as JSON by streaming to disk at devtoolLogFilename.
 * @param {any} profile
 * @param {string} cpuProfileFilename
 * @return {Promise<void>}
 */
export function saveCpuProfile(profile: Record<string, unknown>, cpuProfileFilename: string): Promise<void> {
  const writeStream = fs.createWriteStream(cpuProfileFilename);

  return stream.promises.pipeline(function* () {
    yield '{\n';

    for (const [key, val] of Object.entries(profile)) {
      if (key === 'nodes') { // i dont know ideal formatting for samples and timeDeltas
        // this relies on nodes always being first..
        yield `"${key}": `;
        yield* arrayOfObjectsJsonGenerator(val as unknown[]);
      } else {
        yield `,\n"${key}": `;
        yield JSON.stringify(val);
      }
    }

    yield '\n}\n';
  }, writeStream);
}


/**
 * @return {Promise<void>}
 * @param {string} filename
 */
export async function saveNetlog(netlog: Netlog, filename: string): Promise<void> {
  const writeStream = fs.createWriteStream(filename);

  const {events, constants, ...rest} = netlog;
  if (Object.keys(rest).length) throw new Error('unexpected contents in netlog! : ' + JSON.stringify(rest).slice(0, 1000));

  return stream.promises.pipeline(function* () {
    yield '{\n';
    yield `"constants": ${JSON.stringify(constants, null, 2)}`;
    yield ',\n"events": ';
    yield* arrayOfObjectsJsonGenerator(events);
    yield '}\n';
  }, writeStream);
}



/**
 * A simple version of LH's test-util's readJson. TBD if it needs more import.meta complexity.
 *
 * @deprecated use `loadTraceEventsFromFile` instead.
 * @param {string} filePath Can be an absolute or relative path.
 */
export function readJson(filePath: string): unknown {
  // filePath = path.resolve(dir, filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * @param {string} filename
 * @returns TraceEvent[]
 */
export async function loadTraceEventsFromFile(filename: string): Promise<LoadedTraceEvents> {
  if (!fs.existsSync(filename)) {
    throw new Error('File not found. ' + filename);
  }
  const fileBuf = fs.readFileSync(filename);
  let data = '';
  let json: TraceFile|unknown[];
  try {
    if (isGzip(fileBuf)) {
      data = zlib.gunzipSync(fileBuf).toString('utf8');
    } else {
      data = fileBuf.toString('utf8');
    }
    json = JSON.parse(data);
  }catch (e) {
    const {size} = await stat(filename);
    const forceUngzip = isGzip(fileBuf);
    const file = await open(filename);
    const readStream = file.readableWebStream({});
    // const file = new File([fileBuf], 'trace.json', {type: 'application/json'});
    json = await parseTraceJsonAsStream(readStream as unknown as ReadableStream, {forceUngzip, size}) as TraceFile;

    await file.close();
    // console.warn('omg error unzipping. trying as utf8', e);
  }

  // clear memory
  data = '';
  const traceEvents = ('traceEvents' in json ? json.traceEvents : json) as LoadedTraceEvents;
  assert.ok(Array.isArray(traceEvents) && traceEvents.length, 'No trace events array');
  // TODO, do something less gross.
  traceEvents.metadata = 'metadata' in json ? json.metadata : undefined;
  return traceEvents;
}

/**
 * Read the first 3 bytes looking for the gzip signature in the file header
 * https://www.rfc-editor.org/rfc/rfc1952#page-6
 * @param {ArrayBuffer} ab
 * @returns boolean
 */
export function isGzip(ab: ArrayBuffer|ArrayBufferView) {
  const buf = ab instanceof ArrayBuffer
    ? new Uint8Array(ab)
    : new Uint8Array(ab.buffer, ab.byteOffset, ab.byteLength);
  if (!buf || buf.length < 3) {
    return false;
  }
  return buf[0] === 0x1F && buf[1] === 0x8B && buf[2] === 0x08;
}
