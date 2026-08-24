import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

import {generate, parseInterfaces} from './generate-trace-events.ts';
import {runTask} from './gen/trace-event-factories.ts';

const fixture = `
export declare enum Phase { COMPLETE = "X" }
export declare enum Name { RUN_TASK = "RunTask" }
export interface Event { name: string; ph: Phase; pid: number; }
export interface Complete extends Event { ph: Phase.COMPLETE; dur: number; }
export interface RunTask extends Complete { name: Name.RUN_TASK; }
export interface NotAnEvent { value: string; }
`;

test('parses inheritance and literal discriminants', () => {
  const interfaces = parseInterfaces(fixture);
  assert.deepEqual(interfaces.get('Complete')?.parents, ['Event']);
  assert.equal(interfaces.get('Complete')?.literals.get('ph'), 'TraceEvents.Phase.COMPLETE');
});

test('generates factories only for trace events and supplies inherited defaults', () => {
  const generated = generate(fixture);
  assert.match(generated, /export function runTask/);
  assert.match(generated, /ph: TraceEvents\.Phase\.COMPLETE/);
  assert.match(generated, /name: TraceEvents\.Name\.RUN_TASK/);
  assert.doesNotMatch(generated, /notAnEvent/);
});

test('checked-in factories are up to date', async () => {
  const declarations = await readFile(new URL('./node_modules/@paulirish/trace_engine/models/trace/types/TraceEvents.d.ts', import.meta.url), 'utf8');
  const checkedIn = await readFile(new URL('./gen/trace-event-factories.ts', import.meta.url), 'utf8');
  assert.equal(checkedIn, generate(declarations), 'run `npm run generate`');
});

test('a generated factory creates an event with protected discriminants', () => {
  const invalidInput = {cat: 'test', pid: 1, tid: 2, ts: 3, dur: 4, name: 'ignored', ph: 'I'} as unknown as Parameters<typeof runTask>[0];
  const event = runTask(invalidInput);
  assert.deepEqual(event, {cat: 'test', pid: 1, tid: 2, ts: 3, dur: 4, name: 'RunTask', ph: 'X'});
});
