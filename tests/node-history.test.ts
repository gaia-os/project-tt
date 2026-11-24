import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NODE_HISTORY_LIMIT,
  NodeHistoryAction,
  NodeHistoryState,
  initialNodeHistory,
  nodeHistoryReducer,
  nodeHistoryTarget,
} from '@/lib/nodeHistory';

const visit = (id: string): NodeHistoryAction => ({ type: 'visit', entry: { id, label: id } });
const run = (actions: NodeHistoryAction[], state: NodeHistoryState = initialNodeHistory) =>
  actions.reduce(nodeHistoryReducer, state);
const ids = (state: NodeHistoryState) => state.entries.map((e) => e.id);

test('visits build a stack and repeated visits are ignored', () => {
  const state = run([visit('reactor'), visit('magnet'), visit('magnet')]);
  assert.deepEqual(ids(state), ['reactor', 'magnet']);
  assert.equal(state.index, 1);
  assert.equal(nodeHistoryTarget(state, -1)?.id, 'reactor');
  assert.equal(nodeHistoryTarget(state, 1), undefined);
});

test('back then forward moves the cursor without changing the stack', () => {
  let state = run([visit('reactor'), visit('magnet'), { type: 'go', delta: -1 }, visit('reactor')]);
  assert.deepEqual(ids(state), ['reactor', 'magnet']);
  assert.equal(state.index, 0);
  assert.equal(nodeHistoryTarget(state, 1)?.id, 'magnet');

  state = run([{ type: 'go', delta: 1 }, visit('magnet')], state);
  assert.equal(state.index, 1);
});

test('visiting a new node after going back drops the forward entries', () => {
  const state = run([
    visit('a'),
    visit('b'),
    visit('c'),
    { type: 'go', delta: -1 },
    visit('b'),
    visit('d'),
  ]);
  assert.deepEqual(ids(state), ['a', 'b', 'd']);
  assert.equal(state.index, 2);
});

test('back-visit to the same id as a different entry is treated as navigation', () => {
  const state = run([visit('a'), visit('b'), visit('a'), { type: 'go', delta: -2 }, visit('a')]);
  assert.deepEqual(ids(state), ['a', 'b', 'a']);
  assert.equal(state.index, 0);
});

test('out-of-range steps are ignored and reset clears everything', () => {
  let state = run([visit('a'), { type: 'go', delta: -1 }, { type: 'go', delta: 1 }]);
  assert.equal(state.pending, null);
  state = run([{ type: 'reset' }], state);
  assert.deepEqual(state, initialNodeHistory);
});

test('history is capped', () => {
  const state = run(Array.from({ length: NODE_HISTORY_LIMIT + 5 }, (_, i) => visit(`n${i}`)));
  assert.equal(state.entries.length, NODE_HISTORY_LIMIT);
  assert.equal(state.entries[0].id, 'n5');
  assert.equal(state.index, NODE_HISTORY_LIMIT - 1);
});
