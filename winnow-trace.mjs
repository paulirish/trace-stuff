// Use a filter predicate to remove excess stuff. eg: stripping down to a timerange, only keeping metadata, just removing `disabled-by-default.v8.compile`

import path from 'node:path';
import {strict as assert} from 'assert';
import {saveTrace, loadTraceEventsFromFile} from './trace-file-utils.mjs';
import {extractCPUProfileData} from './extract-cpu-profile-from-trace.mjs';

// For Time crop, ADJUST THESE NUMBERS!  If not doing time crop. comment these lines out.
const MIN_TS = 0;
const MAX_TS = 2401384251864;
const isTsWithinRange = (ts) => MIN_TS < ts && ts < MAX_TS;

// return true to keep. false to drop
function filterEventFn(e, cpuProfileData) {
  // Almost certainly need these.
  if (e.name === 'TracingStartedInBrowser' || e.cat === '__metadata' || e.ts === 0) return true;
  if (e.name === 'FrameCommittedInBrowser') return e.ts < MAX_TS;

  // We need to adjust samples and timeDeltas arrays.
  if (e.name === 'Profile') return true;
  if (e.name.startsWith('ProfileChunk')) {
    const index = cpuProfileData.findIndex(d => d.id === e.id && d.pid === e.pid); // tid doesnt match on profilechunks becaose weird reasons.
    if (index !== -1) {
      const [cpuProfileDatum] = cpuProfileData.splice(index, 1);  // Remove from cpuProfileData so we can exclude later matching ProfileChunks

      let currentTime = cpuProfileDatum.profile.endTime; // We'll keep track of current time as we go through them
      for (let i = cpuProfileDatum.profile.samples.length - 1; i >= 0; i--) { // reverse loop to avoid index issues while shifting
        const withinTimeRange = isTsWithinRange(currentTime);
        currentTime -= cpuProfileDatum.profile.timeDeltas[i];
        if (!withinTimeRange) {
          // Delete those samples and timerange
          cpuProfileDatum.profile.samples.splice(i, 1);
          cpuProfileDatum.profile.timeDeltas.splice(i, 1);
        }
      }
      // TODO do i need this?
      // data.profile.endTime = data.profile.timeDeltas.reduce((x, y) => x + y, data.profile.startTime);
      // This can trigger Maximum callstack exceeded in SamplesHandler due to a `.push(...samples)`
      e.args.data.cpuProfile = cpuProfileDatum.profile;
      e.args.data.timeDeltas = cpuProfileDatum.profile.timeDeltas;
      e.args.data.lines = cpuProfileDatum.profile.lines;
    } else {
      // Remove because we already put all the data in an earlier one.
      return false;
    }
  }

  // Generic time crop
  return isTsWithinRange(e.ts);
  

  // if (['V8.ParseFunction', 'V8.CompileIgnition', 'V8.CompileIgnitionFinalization', 'v8.compile', 'V8.CompileCode'].includes(e.name)) return false;

  return true; // Keep anything not false'd at this point.
}  

export async function resaveTrace(filename, filterEventFn) {
  const traceEvents = loadTraceEventsFromFile(filename);
  console.log('Refomatting', traceEvents.length, 'events');

  const cpuProfileData = isTsWithinRange ? await Promise.all(extractCPUProfileData(traceEvents)) : [];
  const afterTraceEvents = filteredTraceSort(traceEvents, e => filterEventFn(e, cpuProfileData));

  const afterFilename = `${filename}.winnowed.json`;
  await saveTrace({traceEvents: afterTraceEvents}, afterFilename);
  console.log(`Written: ${afterFilename}`);

  console.log('eventCount: ', traceEvents.length, '==>', afterTraceEvents.length);
}

// CLI direct invocation?
if (import.meta.url.endsWith(process?.argv[1])) {
  cli();
}

async function cli() {
  const filename = path.resolve(process.cwd(), process.argv[2]);
  await resaveTrace(filename, filterEventFn);
}






// Below functions are lifted from Lighthouse's trace-processor. Probably can use something more straightforward…

/**
 * Sorts and filters trace events by timestamp and respecting the nesting structure inherent to
 * parent/child event relationships.
 * @param {LH.TraceEvent[]} traceEvents
 * @param {(e: LH.TraceEvent) => boolean} filter
 */
function filteredTraceSort(traceEvents, filter) {
  // create an array of the indices that we want to keep
  const indices = [];
  for (let srcIndex = 0; srcIndex < traceEvents.length; srcIndex++) {
    if (filter(traceEvents[srcIndex])) {
      indices.push(srcIndex);
    }
  }

  // Sort by ascending timestamp first.
  indices.sort((indexA, indexB) => traceEvents[indexA].ts - traceEvents[indexB].ts);

  // Now we find groups with equal timestamps and order them by their nesting structure.
  for (let i = 0; i < indices.length - 1; i++) {
    const ts = traceEvents[indices[i]].ts;
    const tsGroupIndices = [i];
    for (let j = i + 1; j < indices.length; j++) {
      if (traceEvents[indices[j]].ts !== ts) break;
      tsGroupIndices.push(j);
    }

    // We didn't find any other events with the same timestamp, just keep going.
    if (tsGroupIndices.length === 1) continue;

    // Sort the group by other criteria and replace our index array with it.
    const finalIndexOrder = _sortTimestampEventGroup(
      tsGroupIndices,
      indices,
      i,
      traceEvents
    );
    indices.splice(i, finalIndexOrder.length, ...finalIndexOrder);
    // We just sorted this set of identical timestamps, so skip over the rest of the group.
    // -1 because we already have i++.
    i += tsGroupIndices.length - 1;
  }

  // create a new array using the target indices from previous sort step
  const sorted = [];
  for (let i = 0; i < indices.length; i++) {
    sorted.push(traceEvents[indices[i]]);
  }

  return sorted;
}


  /**
   * This method sorts a group of trace events that have the same timestamp. We want to...
   *
   * 1. Put E events first, we finish off our existing events before we start new ones.
   * 2. Order B/X events by their duration, we want parents to start before child events.
   * 3. If we don't have any of this to go on, just use the position in the original array (stable sort).
   *
   * Note that the typical group size with the same timestamp will be quite small (<10 or so events),
   * and the number of groups typically ~1% of total trace, so the same ultra-performance-sensitive consideration
   * given to functions that run on entire traces does not necessarily apply here.
   *
   * @param {number[]} tsGroupIndices
   * @param {number[]} timestampSortedIndices
   * @param {number} indexOfTsGroupIndicesStart
   * @param {LH.TraceEvent[]} traceEvents
   * @return {number[]}
   */
  function _sortTimestampEventGroup(
      tsGroupIndices,
      timestampSortedIndices,
      indexOfTsGroupIndicesStart,
      traceEvents
  ) {
    /*
     * We have two different sets of indices going on here.

     *    1. There's the index for an element of `traceEvents`, referred to here as an `ArrayIndex`.
     *       `timestampSortedIndices` is an array of `ArrayIndex` elements.
     *    2. There's the index for an element of `timestampSortedIndices`, referred to here as a `TsIndex`.
     *       A `TsIndex` is therefore an index to an element which is itself an index.
     *
     * These two helper functions help resolve this layer of indirection.
     * Our final return value is an array of `ArrayIndex` in their final sort order.
     */
    /** @param {number} i */
    const lookupArrayIndexByTsIndex = i => timestampSortedIndices[i];
    /** @param {number} i */
    const lookupEventByTsIndex = i => traceEvents[lookupArrayIndexByTsIndex(i)];

    /** @type {Array<number>} */
    const eEventIndices = [];
    /** @type {Array<number>} */
    const bxEventIndices = [];
    /** @type {Array<number>} */
    const otherEventIndices = [];

    for (const tsIndex of tsGroupIndices) {
      // See comment above for the distinction between `tsIndex` and `arrayIndex`.
      const arrayIndex = lookupArrayIndexByTsIndex(tsIndex);
      const event = lookupEventByTsIndex(tsIndex);
      if (event.ph === 'E') eEventIndices.push(arrayIndex);
      else if (event.ph === 'X' || event.ph === 'B') bxEventIndices.push(arrayIndex);
      else otherEventIndices.push(arrayIndex);
    }

    /** @type {Map<number, number>} */
    const effectiveDuration = new Map();
    for (const index of bxEventIndices) {
      const event = traceEvents[index];
      if (event.ph === 'X') {
        effectiveDuration.set(index, event.dur);
      } else {
        // Find the next available 'E' event *after* the current group of events that matches our name, pid, and tid.
        let duration = Number.MAX_SAFE_INTEGER;
        // To find the next "available" 'E' event, we need to account for nested events of the same name.
        let additionalNestedEventsWithSameName = 0;
        const startIndex = indexOfTsGroupIndicesStart + tsGroupIndices.length;
        for (let j = startIndex; j < timestampSortedIndices.length; j++) {
          const potentialMatchingEvent = lookupEventByTsIndex(j);
          const eventMatches = potentialMatchingEvent.name === event.name &&
            potentialMatchingEvent.pid === event.pid &&
            potentialMatchingEvent.tid === event.tid;

          // The event doesn't match, just skip it.
          if (!eventMatches) continue;

          if (potentialMatchingEvent.ph === 'E' && additionalNestedEventsWithSameName === 0) {
            // It's the next available 'E' event for us, so set the duration and break the loop.
            duration = potentialMatchingEvent.ts - event.ts;
            break;
          } else if (potentialMatchingEvent.ph === 'E') {
            // It's an 'E' event but for a nested event. Decrement our counter and move on.
            additionalNestedEventsWithSameName--;
          } else if (potentialMatchingEvent.ph === 'B') {
            // It's a nested 'B' event. Increment our counter and move on.
            additionalNestedEventsWithSameName++;
          }
        }

        effectiveDuration.set(index, duration);
      }
    }

    bxEventIndices.sort((indexA, indexB) => ((effectiveDuration.get(indexB) || 0) -
      (effectiveDuration.get(indexA) || 0) || (indexA - indexB)));

    otherEventIndices.sort((indexA, indexB) => indexA - indexB);

    return [...eEventIndices, ...bxEventIndices, ...otherEventIndices];
  }
