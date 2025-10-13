import * as Trace from '@paulirish/trace_engine';

import {isGzip} from './trace-file-utils.mjs';

// https://chromium-review.googlesource.com/c/devtools/devtools-frontend/+/6941584


type ParserState = 'metadata'|'events';
type ParserOutput =|{
  type: 'metadata',
  data: Trace.Types.File.MetaData,
}|{
  type: 'events',
  data: Trace.Types.Events.Event[],
};


// Readable streams are async iterable, but TS is out of date. https://stackoverflow.com/a/77377871/89484
// Without this we'd use the wordy reader pattern: https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/getReader
type AsyncReadableStream<T> = ReadableStream<T>&AsyncIterable<T>;
export type AsyncReadableTraceParserStream = AsyncReadableStream<ParserOutput>;

/**
 * Parses a trace file (which may be gzipped) in a streaming manner.
 */
export async function parseTraceJsonAsStream(
    file: File|ReadableStream, {earlyReturnOnEnhancedTrace = false, plainStreamForTest = undefined, forceUngzip = false}: {
      earlyReturnOnEnhancedTrace?: boolean,
      forceUngzip?: boolean,
      plainStreamForTest?: ReadableStream,
    } = {}): Promise<Trace.Types.File.TraceFile> {
  let events: Trace.Types.Events.Event[] = [];
  let metadata: Trace.Types.File.MetaData = {};

  const inputStream = file instanceof ReadableStream ? file : await fileToStream(file);
  const parser = new TraceEventStreamingParser(earlyReturnOnEnhancedTrace);
  
  const chunker = new ChunkSizer({ chunkSize: 5_000_000 }); // 5M

  let stream = inputStream;
  stream = forceUngzip ? stream.pipeThrough(new DecompressionStream('gzip')) : stream;
  stream = !plainStreamForTest ? stream.pipeThrough(chunker).pipeThrough(new TextDecoderStream('utf-8')) : plainStreamForTest;
  const parsedStream = stream.pipeThrough(parser);

  for await (const value of (parsedStream as AsyncReadableTraceParserStream)) {
     if (value.type === 'events') {
      parser.count += value.data.length;
      const expectedEvtCount = 4_000_000;
      process.stdout.write(`\n${(parser.count / expectedEvtCount * 100).toLocaleString()}% `);

      events = events.concat(value.data);
    } else if (value.type === 'metadata') {
      process.stdout.write(`M`);
      metadata = value.data;
    }
  }
  return {metadata, traceEvents: events};
}


export async function fileToString(file: File): Promise<string> {
  const stream = await fileToStream(file);
  return await new Response(stream).text();
}

/** Returns a stream from a file (if gzipped it's also decompressed) */
export async function fileToStream(file: File): Promise<ReadableStream> {
  const first3Bytes = await file.slice(0, 3).arrayBuffer();
  const isGzipped = isGzip(first3Bytes);

  let stream = file.stream();
  if (isGzipped) {
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  return stream;
}

/**
 * A TransformStream that parses a Chrome trace file chunk by chunk.
 * It emits the metadata object first, and then emits arrays of trace events as they are parsed.
 */
export class TraceEventStreamingParser extends TransformStream<string, ParserOutput> {
  #buffer = '';
  #state: ParserState = 'metadata';
  #earlyReturnOnEnhancedTrace = false;
  count = 0;

  constructor(earlyReturnOnEnhancedTrace: boolean) {
    super({
      transform: (chunk, controller) => this.#handleChunk(chunk, controller),
      flush: controller => this.#handleFlush(controller),
    });
    this.#earlyReturnOnEnhancedTrace = earlyReturnOnEnhancedTrace;
  }

  #handleChunk(chunk: string, controller: TransformStreamDefaultController<ParserOutput>): void {
    this.#buffer += chunk;

    if (this.#state === 'metadata') {
      const metaEndMarker = new RegExp(',?\\s*"traceEvents": \\[');
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
          return controller.error(new Error(`Failed to parse trace metadata: ${(e as Error).message}`));
        }

        // Advance the buffer past the metadata and switch state.
        this.#buffer = this.#buffer.substring(match.index + match[0].length);
        this.#state = 'events';
      }
    }

    if (this.#state === 'events') {
      // The end of a trace file is predictable: it will end with the closing of the traceEvents array and the top-level object.
      const endOfFile = this.#buffer.trim().endsWith(`]}`);

      if (endOfFile) {
        // We have the final chunk. Process the entire buffer.
        this.#processBuffer(this.#buffer, controller, endOfFile);
        this.#buffer = '';  // Clear buffer as we are done.
      } else {
        // We are in the middle of the stream. Process up to the last newline to ensure we don't read a partial event.
        const lastNewline = this.#buffer.lastIndexOf('\n  {\"');
        if (lastNewline === -1) {
          return;  // Buffer has no complete lines yet.
        }
        const processable = this.#buffer.substring(0, lastNewline);
        this.#processBuffer(processable, controller);
        this.#buffer = this.#buffer.substring(lastNewline + 1);
      }
    }
  }

  #processBuffer(chunk: string, controller: TransformStreamDefaultController<ParserOutput>, endOfFile = false): void {
    let processable = chunk.trim();
    if (endOfFile) {
      // If the chunk contains the end of the array, we need to find the last ']' and slice to there to ensure we have a clean set of objects.
      const traceEventsCloseIndex = processable.lastIndexOf(']');
      if (traceEventsCloseIndex !== -1) {
        processable = processable.substring(0, traceEventsCloseIndex);
      }
    }

    // Remove any trailing comma from the batch.
    if (processable.endsWith(',')) {
      processable = processable.slice(0, -1);
    }
    if (!processable) {
      return;
    }

    try {
      const jsonArrayStr = `[${processable}]`;
      const events = JSON.parse(jsonArrayStr) as Trace.Types.Events.Event[];
      controller.enqueue({type: 'events', data: events});
    } catch (e) {
      throw new Error('Streaming trace JSON parse failed.', {cause: e});
    }
  }
  #handleFlush(_controller: TransformStreamDefaultController<ParserOutput>): void {
    // If there's anything left in the buffer when the stream ends, it's either a final incomplete object or the closing
    // characters of the trace file (e.g., ']}'). In a valid trace, we can safely ignore this.
    const remaining = this.#buffer.trim();
    if (remaining.length && remaining !== ']}' && remaining !== '}') {
      throw new Error('Trace stream ended with incomplete JSON');
    }
  }
}



/**
 * make chunks BIGGER.
 */
class ChunkSizer extends TransformStream {
  #chunkSize;
  #buffer = new Uint8Array(0);

  constructor({ chunkSize = 1024 * 1024 } = {}) { // Default to 1MB chunks
    super({
      transform: (chunk, controller) => {
        this.#handleChunk(chunk, controller);
      },
      flush: (controller) => {
        // When the stream ends, enqueue any remaining data in the buffer.
        if (this.#buffer.length > 0) {
          controller.enqueue(this.#buffer);
        }
      },
    });

    this.#chunkSize = chunkSize;
  }

  #handleChunk(chunk, controller) {
    // Add the new chunk to our internal buffer.
    const newBuffer = new Uint8Array(this.#buffer.length + chunk.length);
    newBuffer.set(this.#buffer);
    newBuffer.set(chunk, this.#buffer.length);
    this.#buffer = newBuffer;

    // While the buffer is large enough, emit chunks of the desired size.
    while (this.#buffer.length >= this.#chunkSize) {
      const chunkToEnqueue = this.#buffer.slice(0, this.#chunkSize);
      controller.enqueue(chunkToEnqueue);
      // Remove the enqueued chunk from the buffer.
      this.#buffer = this.#buffer.slice(this.#chunkSize);
    }
  }
}
