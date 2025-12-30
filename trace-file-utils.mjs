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
 * @return {Promise<void>}
 * @param {string} filename
 */
export async function saveNetlog(netlog, filename) {
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
  let fileBuf = fs.readFileSync(filename);
  let data;
  if (isGzip(fileBuf)) {
    data = zlib.gunzipSync(fileBuf);
  } else {
    data = fileBuf.toString('utf8');
  }
  const json = JSON.parse(data);
  // clear memory
  fileBuf = data = '';
  const traceEvents = json.traceEvents ?? json;
  assert.ok(Array.isArray(traceEvents) && traceEvents.length, 'No trace events array');
  // TODO, do something less gross.
  traceEvents.metadata = json.metadata;
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

/**
 * Parses a trace file (which may be gzipped) in a streaming manner.
 * @param {string} filePath
 * @param {object} options
 * @param {boolean} [options.earlyReturnOnEnhancedTrace]
 * @param {ReadableStream} [options.plainStreamForTest]
 * @returns {Promise<{metadata: any, traceEvents: any[]}>}
 */
export async function parseTraceJsonAsStream(
    filePath, {earlyReturnOnEnhancedTrace = false, plainStreamForTest = undefined} = {}) {
  let events = [];
  let metadata = {};

  let inputStream;
  if (!plainStreamForTest) {
    // Check for gzip
    const fd = fs.openSync(filePath, 'r');
    const buffer = new Uint8Array(3);
    fs.readSync(fd, buffer, 0, 3, 0);
    fs.closeSync(fd);

    const isGzipped = isGzip(buffer);

    let webStream = stream.Readable.toWeb(fs.createReadStream(filePath));
    if (isGzipped) {
        webStream = webStream.pipeThrough(new DecompressionStream('gzip'));
    }
    inputStream = webStream.pipeThrough(new TextDecoderStream('utf-8'));
  } else {
    inputStream = plainStreamForTest;
  }

  const parser = new TraceEventStreamingParser(earlyReturnOnEnhancedTrace);
  const parsedStream = inputStream.pipeThrough(parser);

  for await (const value of parsedStream) {
    if (value.type === 'metadata') {
      metadata = value.data;
    } else if (value.type === 'events') {
      events = events.concat(value.data);
    }
  }
  return {metadata, traceEvents: events};
}

/**
 * A TransformStream that parses a Chrome trace file chunk by chunk.
 * It emits the metadata object first, and then emits arrays of trace events as they are parsed.
 */
export class TraceEventStreamingParser extends TransformStream {
  #buffer = '';
  #state = 'metadata';
  #earlyReturnOnEnhancedTrace = false;

  constructor(earlyReturnOnEnhancedTrace = false) {
    super({
      transform: (chunk, controller) => this.#handleChunk(chunk, controller),
      flush: controller => this.#handleFlush(controller),
    });
    this.#earlyReturnOnEnhancedTrace = earlyReturnOnEnhancedTrace;
  }

  #handleChunk(chunk, controller) {
    this.#buffer += chunk;

    if (this.#state === 'metadata') {
      const metaEndMarker = new RegExp(',?\\s*"traceEvents"\\s*:\\s*\\[');
      const match = this.#buffer.match(metaEndMarker);

      if (match?.index !== undefined) {
        // metadataSection is the JSON string immediately surrounding the metadata object: `{"metadata":{ ... }` + '}'`
        const metadataSection = this.#buffer.substring(0, match.index) + '}';
        try {
          const metadataWrapper = JSON.parse(metadataSection);
          if (metadataWrapper.metadata) {
            controller.enqueue({type: 'metadata', data: metadataWrapper.metadata});

            if (this.#earlyReturnOnEnhancedTrace && 'enhancedTraceVersion' in metadataWrapper.metadata) {
              return controller.terminate();
            }
          }
        } catch (e) {
          return controller.error(new Error(`Failed to parse trace metadata: ${(e).message}`));
        }

        // Advance the buffer past the metadata and switch state.
        this.#buffer = this.#buffer.substring(match.index + match[0].length);
        this.#state = 'events';
      }
    }

    if (this.#state === 'events') {
        const { events, remaining, done } = this.#extractObjects(this.#buffer);
        this.#buffer = remaining;

        if (events.length > 0) {
            controller.enqueue({type: 'events', data: events});
        }

        if (done) {
            this.#state = 'metadata_end';
            // The buffer already points past the closing `]`.
        }
    }
  }

  #extractObjects(buffer) {
      const events = [];
      let i = 0;
      let depth = 0;
      let inString = false;
      let escape = false;
      let start = 0;
      let done = false;

      // We scan the buffer for objects separated by commas or the end of the array `]`.

      for (; i < buffer.length; i++) {
          const char = buffer[i];

          if (escape) {
              escape = false;
              continue;
          }
          if (char === '\\') {
              escape = true;
              continue;
          }
          if (char === '"') {
              inString = !inString;
              continue;
          }

          if (!inString) {
              if (char === '{') {
                  depth++;
              } else if (char === '}') {
                  depth--;
              } else if (char === ']' && depth === 0) {
                  // End of array.
                  const slice = buffer.substring(start, i).trim();
                  if (slice && slice !== ',') {
                      // slice might have trailing comma from previous iteration if we didn't advance start properly?
                      // If slice is `...obj`.
                      // Trailing comma check?
                      let cleanSlice = slice;
                      if (cleanSlice.endsWith(',')) cleanSlice = cleanSlice.slice(0, -1);
                      if (cleanSlice.trim()) {
                          try { events.push(JSON.parse(cleanSlice)); } catch(e) {}
                      }
                  }

                  return { events, remaining: buffer.substring(i + 1), done: true };
              } else if (char === ',' && depth === 0) {
                  // End of an object.
                  const slice = buffer.substring(start, i).trim();
                  if (slice) {
                      try {
                          events.push(JSON.parse(slice));
                      } catch (e) {
                          // Might be empty or just whitespace?
                      }
                  }
                  start = i + 1;
              }
          }
      }

      // If we are here, we ran out of buffer but did not find `]`.
      // We return what we parsed so far, and the remaining partial buffer.
      // `start` points to the beginning of the incomplete object.
      return { events, remaining: buffer.substring(start), done: false };
  }

  #handleFlush(controller) {
      if (this.#state === 'events') {
          // If state is events, we expect to have found `]`.
          // If we are here, we have remaining buffer.
          // Try to parse it?
          // If it is just whitespace, ignore.
          // If it is `...obj`, but no `]`.
          // If truncated file.
          if (this.#buffer.trim()) {
               try {
                   // Try wrapping in [] just in case?
                   // Or just parse?
                   // If it's one object:
                   const events = [];
                   let s = this.#buffer.trim();
                   if (s.endsWith(',')) s = s.slice(0, -1);
                   if (s) {
                        events.push(JSON.parse(s));
                        controller.enqueue({type: 'events', data: events});
                   }
               } catch(e) {
                   // Ignore
               }
          }
      }

      if (this.#state === 'metadata_end') {
          const remaining = this.#buffer.trim();
          if (!remaining || remaining === '}') return;

          let validJsonStr = remaining;
          if (validJsonStr.startsWith(',')) {
               // Replace comma with `{`
               validJsonStr = '{' + validJsonStr.substring(1);
          } else if (validJsonStr.startsWith('{')) {
               // Should be fine
          } else {
               if (remaining === '}') return;
               validJsonStr = '{' + validJsonStr;
          }

          try {
              const wrapper = JSON.parse(validJsonStr);
              if (wrapper.metadata) {
                  controller.enqueue({type: 'metadata', data: wrapper.metadata});
              }
          } catch(e) {
              // Ignore
          }
      }
  }
}
