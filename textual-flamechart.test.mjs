import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { traceToText } from './textual-flamechart.mjs';

const TEST_TRACE = 'test-trace-tmp.json';
const TEST_OUTPUT = 'test-output-tmp.txt';

const sampleTrace = {
  traceEvents: [
    { pid: 1, tid: 1, ph: 'M', name: 'thread_name', args: { name: 'Main' } },
    { pid: 1, tid: 1, ph: 'X', name: 'Root', ts: 1000, dur: 1000 },
    { pid: 1, tid: 1, ph: 'X', name: 'ChildA', ts: 1100, dur: 400 },
    { pid: 1, tid: 1, ph: 'X', name: 'ChildB', ts: 1600, dur: 300, args: { key: 'val' } },
  ]
};

function setup() {
  fs.writeFileSync(TEST_TRACE, JSON.stringify(sampleTrace));
}

function cleanup() {
  if (fs.existsSync(TEST_TRACE)) fs.unlinkSync(TEST_TRACE);
  if (fs.existsSync(TEST_OUTPUT)) fs.unlinkSync(TEST_OUTPUT);
}

test('traceToText produces basic output', async () => {
  setup();
  await traceToText(TEST_TRACE, TEST_OUTPUT, { limit: 10 });
  const output = fs.readFileSync(TEST_OUTPUT, 'utf8');
  
  assert.match(output, /\[Thread: Main\]/);
  assert.match(output, /Root/);
  assert.match(output, /ChildA/);
  assert.match(output, /ChildB/);
  cleanup();
});

test('traceToText respects time range', async () => {
  setup();
  // Root starts at 0ms (offset), ChildA at 0.1ms (ends 0.5ms), ChildB at 0.6ms (ends 0.9ms)
  // Filter for 0.7ms to 1.0ms should only see Root and ChildB
  await traceToText(TEST_TRACE, TEST_OUTPUT, { limit: 10, start: 0.7, end: 1.0 });
  const output = fs.readFileSync(TEST_OUTPUT, 'utf8');
  
  assert.match(output, /Root/);
  assert.doesNotMatch(output, /ChildA/);
  assert.match(output, /ChildB/);
  cleanup();
});

test('traceToText summary statistics', async () => {
  setup();
  await traceToText(TEST_TRACE, TEST_OUTPUT, { summary: true });
  const output = fs.readFileSync(TEST_OUTPUT, 'utf8');
  
  assert.match(output, /=== SUMMARY/);
  // Root total: 1000, Root self: 1000 - 400 - 300 = 300
  assert.match(output, /1.00\s+0.30\s+1\s+Root/);
  cleanup();
});

test('traceToText find pattern', async () => {
  setup();
  await traceToText(TEST_TRACE, TEST_OUTPUT, { find: 'ChildB' });
  const output = fs.readFileSync(TEST_OUTPUT, 'utf8');
  
  assert.match(output, /Root/); // Ancestor should be kept
  assert.doesNotMatch(output, /ChildA/);
  assert.match(output, /ChildB/);
  cleanup();
});

test('traceToText include arguments', async () => {
  setup();
  await traceToText(TEST_TRACE, TEST_OUTPUT, { includeArgs: true });
  const output = fs.readFileSync(TEST_OUTPUT, 'utf8');
  
  assert.match(output, /args: {"key":"val"}/);
  cleanup();
});
