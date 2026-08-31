import assert from 'node:assert/strict';
import test from 'node:test';

import * as TraceEvents from '@paulirish/trace_engine/models/trace/types/TraceEvents.js';
import * as Timing from '@paulirish/trace_engine/models/trace/types/Timing.js';

import {filteredTraceSort} from './winnow-trace.ts';

function event(name: string, ph: TraceEvents.Phase, ts: number, dur?: number): TraceEvents.Event {
  return {
    cat: 'test',
    name,
    ph,
    pid: TraceEvents.ProcessID(1),
    tid: TraceEvents.ThreadID(1),
    ts: Timing.Micro(ts),
    ...(dur === undefined ? {} : {dur: Timing.Micro(dur)}),
  };
}

test('filteredTraceSort filters events and preserves timestamp nesting order', () => {
  const events = [
    event('child', TraceEvents.Phase.COMPLETE, 10, 5),
    event('parent', TraceEvents.Phase.BEGIN, 10),
    event('finished', TraceEvents.Phase.END, 10),
    event('excluded', TraceEvents.Phase.INSTANT, 5),
    event('parent', TraceEvents.Phase.END, 30),
  ];

  const sorted = filteredTraceSort(events, event => event.name !== 'excluded');

  assert.deepEqual(sorted.map(event => `${event.name}:${event.ph}`), [
    'finished:E',
    'parent:B',
    'child:X',
    'parent:E',
  ]);
});
