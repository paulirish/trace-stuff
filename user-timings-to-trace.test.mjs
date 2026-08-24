import assert from 'node:assert/strict';
import test from 'node:test';

import {generateTraceEvents} from './user-timings-to-trace.mjs';

test('generated user timings use the expected trace event discriminants', () => {
  const events = generateTraceEvents([
    {entryType: 'mark', name: 'start', startTime: 1, duration: 0},
    {entryType: 'measure', name: 'work', startTime: 2, duration: 3},
  ]);

  assert.deepEqual(
    events.map(({name, ph}) => [name, ph]),
    [
      ['process_labels', 'M'],
      ['thread_name', 'M'],
      ['process_name', 'M'],
      ['TracingStartedInBrowser', 'I'],
      ['FrameCommittedInBrowser', 'I'],
      ['start', 'I'],
      ['work', 'b'],
      ['work', 'e'],
      ['RunTask', 'X'],
      ['RunTask', 'X'],
    ],
  );
});
