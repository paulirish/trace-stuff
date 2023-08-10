// pulled from DT FE savefileformatter.ts, which was based on lighthouse's asset-saver.

import stream from 'stream';
import fs from 'fs';

/**
 * Generates a JSON representation of an array of objects with the objects
 * printed one per line for improved readability (but not *too* verbose).
 * @param {readonly TraceEngine.Types.TraceEvents.TraceEventData[]} arrayOfObjects
 * @return IterableIterator<string>
 */
export function* arrayOfObjectsJsonGenerator(arrayOfObjects) {
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
 * Generates a JSON representation of traceData line-by-line for a nicer printed
 * version with one trace event per line.
 * @param {readonly TraceEngine.Types.TraceEvents.TraceEventData[]} traceEvents 
 * @param {Readonly<TraceEngine.Types.File.MetaData>|null} metadata 
 * @return IterableIterator<string>
 */
export function* traceJsonGenerator(traceEvents, metadata) {
  yield '{"traceEvents": ';
  yield* arrayOfObjectsJsonGenerator(traceEvents);
  yield `,\n"metadata": ${JSON.stringify(metadata || {}, null, 2)}`;
  yield '}\n';
}

/**
 * Save a trace as JSON by streaming to disk at traceFilename.
 * @param {LH.Trace} traceData
 * @param {string} traceFilename
 * @return {Promise<void>}
 */
export async function saveTrace(traceData, traceFilename) {
  const traceIter = traceJsonGenerator(traceData);
  const writeStream = fs.createWriteStream(traceFilename);

  return stream.promises.pipeline(traceIter, writeStream);
}

/**
 * Generates a JSON representation of CPU profile.
 * @param {Protocol.Profiler.Profile} cpuprofile 
 * @returns string 
 */
export function cpuprofileJsonGenerator(cpuprofile){
  return JSON.stringify(cpuprofile);
}


/**
 * A simple version of LH's test-util's readJson. TBD if it needs more import.meta complexity.
 *
 * @param {string} filePath Can be an absolute or relative path.
 */
export function readJson(filePath) {
  // filePath = path.resolve(dir, filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}
