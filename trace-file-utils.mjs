// pulled from DT FE savefileformatter.ts, which was based on lighthouse's asset-saver.

import stream from 'stream';
import fs from 'fs';
import zlib from 'zlib';
import {strict as assert} from 'assert';

/**
 * Generates a JSON representation of an array of objects with the objects
 * printed one per line for a more readable (but not too verbose) version.
 * @param {Array<unknown>} arrayOfObjects
 * @return {IterableIterator<string>}
 */
function* arrayOfObjectsJsonGenerator(arrayOfObjects) {
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
export function* traceJsonGenerator(trace) {
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
export async function saveTrace(trace, traceFilename) {
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
export function saveCpuProfile(profile, cpuProfileFilename) {
  const writeStream = fs.createWriteStream(cpuProfileFilename);

  return stream.promises.pipeline(function* () {
    yield '{\n';

    for (const [key, val] of Object.entries(profile)) {
      if (key === 'nodes') { // i dont know ideal formatting for samples and timeDeltas
        // this relies on nodes always being first..
        yield `"${key}": `;
        yield* arrayOfObjectsJsonGenerator(val);
      } else {
        yield `,\n"${key}": `;
        yield JSON.stringify(val);
      }
    }

    yield '\n}\n';
  }, writeStream);
}


/**
 * A simple version of LH's test-util's readJson. TBD if it needs more import.meta complexity.
 *
 * @deprecated use `loadTraceEventsFromFile` instead.
 * @param {string} filePath Can be an absolute or relative path.
 */
export function readJson(filePath) {
  // filePath = path.resolve(dir, filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * @param {string=} filename
 * @returns TraceEvent[]
 */
export function loadTraceEventsFromFile(filename) {
  if (!fs.existsSync(filename)) {
    throw new Error('File not found. ' + filename);
  }
  const fileBuf = fs.readFileSync(filename);
  let data;
  if (isGzip(fileBuf)) {
    data = zlib.gunzipSync(fileBuf);
  } else {
    data = fileBuf.toString('utf8');
  }
  const json = JSON.parse(data);
  const traceEvents = json.traceEvents ?? json;
  assert.ok(Array.isArray(traceEvents) && traceEvents.length, 'No trace events array');
  // TODO, also extract metadata
  return traceEvents;
}

/**
 * Read the first 3 bytes looking for the gzip signature in the file header
 * https://www.rfc-editor.org/rfc/rfc1952#page-6
 * @param {ArrayBuffer} ab
 * @returns boolean
 */
function isGzip(ab) {
  const buf = new Uint8Array(ab);
  if (!buf || buf.length < 3) {
    return false;
  }
  return buf[0] === 0x1F && buf[1] === 0x8B && buf[2] === 0x08;
}

