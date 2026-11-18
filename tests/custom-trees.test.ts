import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CustomTree,
  ancestorsOf,
  createTree,
  descendantsOf,
  duplicateTree,
  exportTrees,
  importTrees,
  parseStoredTrees,
  removeTree,
  resolveCustomTree,
  sanitizeTree,
  serializeTrees,
  treeOverlap,
  uniqueTreeName,
  updateTree,
} from '@/lib/customTrees';
import { TechTree } from '@/lib/types';

// a → c, b → c, c → t, s → x
const base: TechTree = {
  nodes: ['a', 'b', 'c', 's', 't', 'x'].map((id) => ({
    id,
    data: { label: id.toUpperCase(), nodeLabel: 'Milestone', description: '' },
  })),
  edges: [
    ['a', 'c'],
    ['b', 'c'],
    ['c', 't'],
    ['s', 'x'],
  ].map(([source, target]) => ({ id: `${source}->${target}`, source, target })),
};

const origin = { kind: 'builder' as const, label: '' };

function make(name: string, nodeIds: string[], id: string, trees: CustomTree[] = []) {
  return createTree(trees, { name, topic: 'nuclear', nodeIds, origin }, 1000, id);
}

test('creating trees cleans names, notes and ids and keeps names unique per topic', () => {
  const first = make('  Fusion   path ', ['a', 'a', 'c', ''], 'ct_one');
  assert.equal(first.tree.name, 'Fusion path');
  assert.deepEqual(first.tree.nodeIds, ['a', 'c']);
  assert.equal(first.tree.createdAt, 1000);

  const second = make('fusion path', ['b'], 'ct_two', first.trees);
  assert.equal(second.tree.name, 'fusion path (2)');
  assert.deepEqual(second.trees.map((tree) => tree.id), ['ct_two', 'ct_one']);

  const otherTopic = createTree(
    second.trees,
    { name: 'Fusion path', topic: 'fossil_fuels', nodeIds: [], origin },
    1000,
    'ct_three',
  );
  assert.equal(otherTopic.tree.name, 'Fusion path');
  assert.equal(make('   ', [], 'ct_x').tree.name, 'Untitled tree');
  assert.equal(uniqueTreeName(second.trees, 'nuclear', 'Fusion path', 'ct_one'), 'Fusion path');
});

test('update, duplicate and remove leave other trees alone', () => {
  const { trees } = make('Mine', ['a'], 'ct_a', make('Other', ['s'], 'ct_b').trees);
  const updated = updateTree(trees, 'ct_a', { nodeIds: ['a', 'b'], notes: ' why ' }, 2000);
  const mine = updated.find((tree) => tree.id === 'ct_a')!;
  assert.deepEqual(mine.nodeIds, ['a', 'b']);
  assert.equal(mine.notes, 'why');
  assert.equal(mine.updatedAt, 2000);
  assert.equal(updated.find((tree) => tree.id === 'ct_b'), trees.find((tree) => tree.id === 'ct_b'));

  const copy = duplicateTree(updated, 'ct_a', 3000, 'ct_c')!;
  assert.equal(copy.tree.name, 'Mine copy');
  assert.deepEqual(copy.tree.nodeIds, ['a', 'b']);
  assert.deepEqual(copy.tree.origin, { kind: 'copy', label: 'Mine' });
  assert.equal(duplicateTree(updated, 'ct_missing'), null);

  assert.deepEqual(
    removeTree(copy.trees, 'ct_a').map((tree) => tree.id),
    ['ct_c', 'ct_b'],
  );
});

test('stored trees round-trip and malformed entries are dropped', () => {
  const { trees } = make('Mine', ['a', 'c'], 'ct_a');
  assert.deepEqual(parseStoredTrees(serializeTrees(trees)), trees);
  assert.deepEqual(parseStoredTrees('not json'), []);
  assert.deepEqual(parseStoredTrees(null), []);
  const raw = JSON.stringify({
    version: 1,
    trees: [
      trees[0],
      trees[0], // duplicate id
      { ...trees[0], id: 'evil id' },
      { ...trees[0], id: 'ct_b', topic: 'bad topic' },
      { ...trees[0], id: 'ct_c', nodeIds: 'a' },
      { ...trees[0], id: 'ct_d', origin: { kind: '??' }, name: 7 },
    ],
  });
  const parsed = parseStoredTrees(raw);
  assert.deepEqual(parsed.map((tree) => tree.id), ['ct_a', 'ct_d']);
  assert.equal(parsed[1].name, 'Untitled tree');
  assert.equal(parsed[1].origin.kind, 'builder');
  assert.equal(sanitizeTree(null), null);
});

test('import re-ids collisions, keeps names unique and reports skipped entries', () => {
  const { trees } = make('Mine', ['a'], 'ct_a');
  const file = exportTrees(trees);
  let next = 0;
  const result = importTrees(trees, file, 5000, () => `ct_new${next++}`);
  assert.ok(result.ok);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].id, 'ct_new0');
  assert.equal(result.imported[0].name, 'Mine (2)');
  assert.equal(result.trees.length, 2);
  assert.equal(result.skipped, 0);

  const partial = importTrees([], JSON.stringify([trees[0], { id: 'bad' }]), 5000);
  assert.ok(partial.ok);
  assert.equal(partial.imported.length, 1);
  assert.equal(partial.skipped, 1);

  assert.deepEqual(importTrees([], '{', 0), { ok: false, error: 'That file is not valid JSON.' });
  assert.equal(importTrees([], '{"x":1}', 0).ok, false);
});

test('a custom tree is the induced subgraph; deleted nodes are reported', () => {
  const { tree, missingIds } = resolveCustomTree(base, { nodeIds: ['t', 'a', 'c', 'gone'] });
  assert.deepEqual(tree.nodes.map((node) => node.id), ['a', 'c', 't']);
  assert.deepEqual(tree.edges.map((edge) => edge.id), ['a->c', 'c->t']);
  assert.deepEqual(missingIds, ['gone']);
});

test('prerequisite and dependent closures exclude the starting nodes', () => {
  assert.deepEqual([...ancestorsOf(base, ['t'])].sort(), ['a', 'b', 'c']);
  assert.deepEqual([...ancestorsOf(base, ['c', 'a'])].sort(), ['b']);
  assert.deepEqual([...descendantsOf(base, ['a'])].sort(), ['c', 't']);
  assert.deepEqual([...descendantsOf(base, ['x'])], []);
});

test('overlap splits ids into shared and one-sided', () => {
  assert.deepEqual(treeOverlap(['a', 'b', 'c'], ['c', 'd']), {
    shared: ['c'],
    onlyA: ['a', 'b'],
    onlyB: ['d'],
  });
});
