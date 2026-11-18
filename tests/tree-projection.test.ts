import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateNodeId,
  exclusivePrerequisites,
  groupFrameId,
  groupKeysOf,
  projectTree,
  summarizeTree,
} from '@/lib/treeProjection';
import {
  DEFAULT_MIN_ZOOM,
  MIN_ZOOM_FLOOR,
  boundsOf,
  minZoomForBounds,
  zoomDetailLevel,
} from '@/lib/canvasZoom';
import { NodeLabel, TechTree } from '@/lib/types';
import { loadDatasetTree } from './helpers/datasetTree';

const nuclear = loadDatasetTree('nuclear_tt_v2.json');
const fossil = loadDatasetTree('fossil_fuel_tt_v3.json');

function tree(
  nodes: [id: string, role: NodeLabel, category: string, trl?: string][],
  edges: [source: string, target: string][],
): TechTree {
  return {
    nodes: nodes.map(([id, nodeLabel, category, trl_current]) => ({
      id,
      data: { label: id, nodeLabel, category, description: '', trl_current },
    })),
    edges: edges.map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
    })),
  };
}

// a, b feed c; c feeds t; s feeds both c and x, so s is shared.
const branchy = tree(
  [
    ['a', 'EnablingTechnology', 'Core', '3'],
    ['b', 'EnablingTechnology', 'Core', '5'],
    ['s', 'EnablingTechnology', 'Shared', '8'],
    ['c', 'Milestone', 'Core', '4'],
    ['x', 'Milestone', 'Shared'],
    ['t', 'ReactorConcept', 'Core', '2'],
  ],
  [
    ['a', 'c'],
    ['b', 'c'],
    ['s', 'c'],
    ['s', 'x'],
    ['c', 't'],
  ],
);

test('without aggregation or folds the projection is the tree itself', () => {
  const projection = projectTree(nuclear);
  assert.equal(projection.nodes.length, nuclear.nodes.length);
  assert.ok(projection.nodes.every((node) => node.kind === 'node'));
  assert.deepEqual(
    projection.edges.map((edge) => edge.id).sort(),
    nuclear.edges.map((edge) => edge.id).sort(),
  );
  assert.equal(projection.frames.length, 0);
  for (const node of nuclear.nodes) {
    assert.equal(projection.representative.get(node.id), node.id);
  }
});

test('exclusive prerequisites leave shared ones visible', () => {
  assert.deepEqual(
    [...exclusivePrerequisites(branchy, 't')].sort(),
    ['a', 'b', 'c'],
  );
  assert.deepEqual([...exclusivePrerequisites(branchy, 'c')].sort(), ['a', 'b']);
  assert.equal(exclusivePrerequisites(branchy, 'a').size, 0);
});

test('a prerequisite reached over paths of different length is still exclusive', () => {
  // p -> q -> t and p -> t: p is nearest to t but only exclusive once q is.
  const skip = tree(
    [
      ['p', 'EnablingTechnology', 'X'],
      ['q', 'Milestone', 'X'],
      ['t', 'ReactorConcept', 'X'],
    ],
    [
      ['p', 't'],
      ['p', 'q'],
      ['q', 't'],
    ],
  );
  assert.deepEqual([...exclusivePrerequisites(skip, 't')].sort(), ['p', 'q']);
});

test('folding tucks the exclusive branch into the node and re-points edges', () => {
  const projection = projectTree(branchy, { foldedNodeIds: new Set(['t']) });
  const drawn = projection.nodes.map((node) => node.id).sort();
  assert.deepEqual(drawn, ['s', 't', 'x']);
  for (const id of ['a', 'b', 'c']) {
    assert.equal(projection.representative.get(id), 't');
  }
  const t = projection.nodes.find((node) => node.id === 't');
  assert.equal(t?.kind === 'node' && t.foldedCount, 3);
  assert.deepEqual(
    projection.edges.map((edge) => `${edge.source}->${edge.target}`).sort(),
    ['s->t', 's->x'],
  );
});

test('a fold inside a folded branch belongs to the outer fold', () => {
  const projection = projectTree(branchy, {
    foldedNodeIds: new Set(['c', 't']),
  });
  assert.deepEqual(
    projection.nodes.map((node) => node.id).sort(),
    ['s', 't', 'x'],
  );
  assert.equal(projection.representative.get('a'), 't');
  assert.equal(projection.representative.get('c'), 't');
});

test('nodes report how much folding would hide', () => {
  const projection = projectTree(branchy);
  const foldable = new Map(
    projection.nodes.map((node) => [
      node.id,
      node.kind === 'node' ? node.foldableCount : -1,
    ]),
  );
  assert.equal(foldable.get('t'), 3);
  assert.equal(foldable.get('c'), 2);
  assert.equal(foldable.get('x'), 0);
  assert.equal(foldable.get('a'), 0);
});

test('aggregation draws one node per category and role with weighted edges', () => {
  const projection = projectTree(fossil, { mode: 'category-role' });
  const groups = new Set(
    fossil.nodes.map((node) => `${node.data.category}:${node.data.nodeLabel}`),
  );
  assert.equal(projection.nodes.length, groups.size);
  assert.ok(projection.nodes.every((node) => node.kind === 'aggregate'));

  const memberTotal = projection.nodes.reduce(
    (sum, node) =>
      sum + (node.kind === 'aggregate' ? node.aggregate.memberIds.length : 0),
    0,
  );
  assert.equal(memberTotal, fossil.nodes.length);

  const ids = new Set(fossil.nodes.map((node) => node.id));
  const crossGroupEdges = fossil.edges.filter(
    (edge) =>
      ids.has(edge.source) &&
      ids.has(edge.target) &&
      projection.representative.get(edge.source) !==
        projection.representative.get(edge.target),
  ).length;
  assert.equal(
    projection.edges.reduce((sum, edge) => sum + edge.weight, 0),
    crossGroupEdges,
  );
  assert.ok(projection.edges.every((edge) => edge.source !== edge.target));
  assert.ok(projection.edges.some((edge) => edge.weight > 1));
});

test('aggregates summarise their members', () => {
  const projection = projectTree(branchy, { mode: 'category' });
  const core = projection.nodes.find(
    (node) => node.id === aggregateNodeId('category:Core'),
  );
  assert.ok(core?.kind === 'aggregate');
  const { aggregate } = core;
  assert.deepEqual(aggregate.memberIds.sort(), ['a', 'b', 'c', 't']);
  assert.deepEqual(aggregate.roleCounts, {
    ReactorConcept: 1,
    Milestone: 1,
    EnablingTechnology: 2,
  });
  assert.equal(aggregate.dominantRole, 'EnablingTechnology');
  assert.deepEqual(aggregate.trl, { min: 2, max: 5, median: 3.5, rated: 4 });
  assert.equal(aggregate.sampleLabels.length, 3);
});

test('an unfolded group is drawn as a frame around its members', () => {
  const key = 'category:Core';
  const projection = projectTree(branchy, {
    mode: 'category',
    expandedGroups: new Set([key]),
  });
  assert.deepEqual(projection.frames.map((frame) => frame.id), [
    groupFrameId(key),
  ]);
  assert.deepEqual(projection.frames[0].visibleIds, ['a', 'b', 'c', 't']);
  assert.equal(projection.frames[0].memberCount, 4);
  const shared = aggregateNodeId('category:Shared');
  assert.deepEqual(
    projection.edges.map((edge) => `${edge.source}->${edge.target}`).sort(),
    ['a->c', 'b->c', 'c->t', `${shared}->c`].sort(),
  );
});

test('folds ignore collapsed groups and keep aggregated prerequisites out', () => {
  const projection = projectTree(branchy, {
    mode: 'role',
    expandedGroups: new Set(['role:ReactorConcept']),
    foldedNodeIds: new Set(['t', 'c']),
  });
  // c sits in the collapsed milestone aggregate, so only t can fold, and
  // its prerequisites are all aggregated: nothing is left to fold.
  const t = projection.nodes.find((node) => node.id === 't');
  assert.ok(t?.kind === 'node');
  assert.equal(t.foldedCount, 0);
  assert.equal(t.foldableCount, 0);
  assert.equal(
    projection.representative.get('c'),
    aggregateNodeId('role:Milestone'),
  );
});

test('group keys list every group once per mode', () => {
  assert.deepEqual(groupKeysOf(nuclear, 'none'), []);
  assert.deepEqual(groupKeysOf(nuclear, 'category').sort(), [
    'category:Cross-Cutting',
    'category:Fission',
    'category:Fusion',
  ]);
  assert.equal(groupKeysOf(nuclear, 'role').length, 3);
});

test('tree summaries count roles, readiness and chain depth', () => {
  const summary = summarizeTree(nuclear);
  assert.equal(summary.nodeCount, 45);
  assert.deepEqual(summary.roleCounts, {
    ReactorConcept: 12,
    Milestone: 21,
    EnablingTechnology: 12,
  });
  assert.equal(summary.categoryCount, 3);
  assert.equal(
    summary.trlHistogram.reduce((sum, count) => sum + count, 0) +
      summary.unratedCount,
    45,
  );
  assert.ok(summary.longestChain >= 3);
  assert.ok(summary.matureShare !== null && summary.matureShare <= 1);

  assert.equal(summarizeTree(branchy).longestChain, 3);
  assert.equal(summarizeTree({ nodes: [], edges: [] }).longestChain, 0);
});

test('the canvas can zoom out until any tree fits', () => {
  assert.equal(minZoomForBounds(null, 800, 600), DEFAULT_MIN_ZOOM);
  assert.equal(
    minZoomForBounds({ x: 0, y: 0, width: 400, height: 300 }, 800, 600),
    DEFAULT_MIN_ZOOM,
  );
  const large = minZoomForBounds(
    { x: 0, y: 0, width: 8000, height: 3000 },
    800,
    600,
  );
  assert.equal(large, 0.05);
  assert.equal(
    minZoomForBounds({ x: 0, y: 0, width: 1e6, height: 10 }, 800, 600),
    MIN_ZOOM_FLOOR,
  );
  assert.deepEqual(
    boundsOf([
      { x: 0, y: 10, width: 10, height: 10 },
      { x: -5, y: 0, width: 5, height: 5 },
    ]),
    { x: -5, y: 0, width: 15, height: 20 },
  );
  assert.equal(zoomDetailLevel(1), 'near');
  assert.equal(zoomDetailLevel(0.25), 'mid');
  assert.equal(zoomDetailLevel(0.1), 'far');
});
