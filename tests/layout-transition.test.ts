import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProjectionOptions,
  aggregateNodeId,
  groupFrameId,
  projectTree,
} from '@/lib/treeProjection';
import { LayoutResult, layoutProjection, shiftLayout } from '@/lib/elkjs';
import {
  LayoutSnapshot,
  easeInOutCubic,
  interpolateTransition,
  planLayoutTransition,
  rectsAt,
} from '@/lib/layoutTransition';
import { Bounds } from '@/lib/canvasZoom';
import { NodeLabel, TechTree } from '@/lib/types';

function tree(
  nodes: [id: string, role: NodeLabel, category: string][],
  edges: [source: string, target: string][],
): TechTree {
  return {
    nodes: nodes.map(([id, nodeLabel, category]) => ({
      id,
      data: { label: id, nodeLabel, category, description: '' },
    })),
    edges: edges.map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
    })),
  };
}

// a and b only feed c; s also feeds x.
const branchy = tree(
  [
    ['a', 'EnablingTechnology', 'Core'],
    ['b', 'EnablingTechnology', 'Core'],
    ['s', 'EnablingTechnology', 'Shared'],
    ['c', 'Milestone', 'Core'],
    ['x', 'Milestone', 'Shared'],
    ['t', 'ReactorConcept', 'Core'],
  ],
  [
    ['a', 'c'],
    ['b', 'c'],
    ['s', 'c'],
    ['s', 'x'],
    ['c', 't'],
  ],
);

async function snapshot(
  options: ProjectionOptions,
): Promise<{ snap: LayoutSnapshot; result: LayoutResult }> {
  const projection = projectTree(branchy, options);
  const result = await layoutProjection(projection);
  return {
    result,
    snap: {
      nodes: result.layoutedNodes,
      edges: result.layoutedEdges,
      rects: result.rects,
      projection,
    },
  };
}

/** Same layout moved so `fromId` (before) and `toId` (after) coincide. */
function anchored(
  previous: LayoutResult,
  next: { snap: LayoutSnapshot; result: LayoutResult },
  fromId: string,
  toId: string,
): LayoutSnapshot {
  const before = previous.rects.get(fromId)!;
  const after = next.result.rects.get(toId)!;
  const shifted = shiftLayout(next.result, {
    x: before.x - after.x,
    y: before.y - after.y,
  });
  return {
    ...next.snap,
    nodes: shifted.layoutedNodes,
    rects: shifted.rects,
  };
}

const centre = (rect: Bounds) => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

test('shiftLayout moves top-level nodes and boxes, not frame members', async () => {
  const { result } = await snapshot({
    mode: 'category',
    expandedGroups: new Set(['category:Core']),
  });
  const moved = shiftLayout(result, { x: 10, y: -5 });
  const frame = groupFrameId('category:Core');
  const member = moved.layoutedNodes.find((node) => node.id === 'a')!;
  assert.equal(member.parentId, frame);
  assert.deepEqual(
    member.position,
    result.layoutedNodes.find((node) => node.id === 'a')!.position,
  );
  assert.equal(moved.rects.get('a')!.x, result.rects.get('a')!.x + 10);
  assert.equal(moved.rects.get(frame)!.y, result.rects.get(frame)!.y - 5);
  assert.equal(moved.bounds!.x, result.bounds!.x + 10);
  assert.equal(moved.absolutePositions.get('a')!.y, result.absolutePositions.get('a')!.y - 5);
});

test('folding glides the prerequisites into the node, which stays put', async () => {
  const before = await snapshot({});
  const after = await snapshot({ foldedNodeIds: new Set(['c']) });
  const next = anchored(before.result, after, 'c', 'c');
  const plan = planLayoutTransition(before.snap, next);

  assert.deepEqual(next.rects.get('c'), before.result.rects.get('c'));
  for (const id of ['a', 'b']) {
    const track = plan.tracks.get(id)!;
    assert.equal(track.role, 'exit');
    assert.deepEqual(centre(track.to), centre(next.rects.get('c')!));
  }
  assert.equal(plan.tracks.get('c')!.role, 'persist');
  assert.deepEqual(
    plan.exitingEdges.map((edge) => edge.id).sort(),
    ['a->c', 'b->c'],
  );
  assert.deepEqual(
    plan.exitingNodes.map((node) => node.id).sort(),
    ['a', 'b'],
  );
});

test('unfolding grows prerequisites out of the node they were folded into', async () => {
  const before = await snapshot({ foldedNodeIds: new Set(['c']) });
  const after = await snapshot({});
  const next = anchored(before.result, after, 'c', 'c');
  const plan = planLayoutTransition(before.snap, next);
  const folded = before.result.rects.get('c')!;
  for (const id of ['a', 'b']) {
    const track = plan.tracks.get(id)!;
    assert.equal(track.role, 'enter');
    assert.deepEqual(centre(track.from), centre(folded));
  }
  assert.ok(plan.enteringEdgeIds.has('a->c'));
});

test('an unfolded group grows its frame out of the aggregate', async () => {
  const before = await snapshot({ mode: 'category' });
  const key = 'category:Core';
  const after = await snapshot({ mode: 'category', expandedGroups: new Set([key]) });
  const next = anchored(before.result, after, aggregateNodeId(key), groupFrameId(key));
  const plan = planLayoutTransition(before.snap, next);
  const aggregate = before.result.rects.get(aggregateNodeId(key))!;

  const frame = plan.tracks.get(groupFrameId(key))!;
  assert.equal(frame.role, 'enter');
  assert.equal(frame.resize, true);
  assert.deepEqual(frame.from, aggregate);
  // Members slide out of the aggregate's middle.
  for (const id of ['a', 'b', 'c', 't']) {
    assert.deepEqual(centre(plan.tracks.get(id)!.from), centre(aggregate));
  }
  // The aggregate fades where it was while the frame grows over it.
  const leaving = plan.tracks.get(aggregateNodeId(key))!;
  assert.equal(leaving.role, 'exit');
  assert.deepEqual(leaving.to, leaving.from);
});

test('folding a frame shrinks it into the aggregate and gathers its members', async () => {
  const key = 'category:Core';
  const before = await snapshot({ mode: 'category', expandedGroups: new Set([key]) });
  const after = await snapshot({ mode: 'category' });
  const next = anchored(before.result, after, groupFrameId(key), aggregateNodeId(key));
  const plan = planLayoutTransition(before.snap, next);
  const aggregate = next.rects.get(aggregateNodeId(key))!;

  const frame = plan.tracks.get(groupFrameId(key))!;
  assert.equal(frame.role, 'exit');
  assert.deepEqual(frame.to, aggregate);
  assert.deepEqual(centre(plan.tracks.get('a')!.to), centre(aggregate));
  assert.equal(plan.tracks.get(aggregateNodeId(key))!.role, 'enter');
});

test('frames start as the previous layout and end as the next one', async () => {
  const key = 'category:Core';
  const before = await snapshot({ mode: 'category' });
  const after = await snapshot({ mode: 'category', expandedGroups: new Set([key]) });
  const next = anchored(before.result, after, aggregateNodeId(key), groupFrameId(key));
  const plan = planLayoutTransition(before.snap, next);

  const start = interpolateTransition(plan, 0, next.nodes, next.edges);
  // Flat while animating, frames first so they stay underneath.
  assert.ok(start.nodes.every((node) => !node.parentId));
  assert.equal(start.nodes[0].type, 'groupFrame');
  for (const node of before.snap.nodes) {
    const drawn = start.nodes.find((candidate) => candidate.id === node.id)!;
    const rect = before.result.rects.get(node.id)!;
    assert.deepEqual(drawn.position, { x: rect.x, y: rect.y });
    assert.equal(drawn.style?.opacity, 1);
  }
  const entering = start.nodes.find((node) => node.id === 'a')!;
  assert.equal(entering.style?.opacity, 0);

  const end = interpolateTransition(plan, 1, next.nodes, next.edges);
  for (const node of next.nodes) {
    const drawn = end.nodes.find((candidate) => candidate.id === node.id)!;
    const rect = next.rects.get(node.id)!;
    assert.deepEqual(drawn.position, { x: rect.x, y: rect.y });
  }
  const frameAtEnd = end.nodes.find((node) => node.id === groupFrameId(key))!;
  assert.equal(frameAtEnd.width, next.rects.get(groupFrameId(key))!.width);
  assert.equal(
    end.nodes.find((node) => node.id === aggregateNodeId(key))!.style?.opacity,
    0,
  );

  // Half way, a growing member sits strictly between its two boxes.
  const half = rectsAt(plan, easeInOutCubic(0.5)).get('a')!;
  const track = plan.tracks.get('a')!;
  const between = (value: number, a: number, b: number) =>
    value > Math.min(a, b) && value < Math.max(a, b);
  assert.ok(
    between(half.x, track.from.x, track.to.x) ||
      between(half.y, track.from.y, track.to.y),
  );
});

test('a node that was filtered out fades in where it lands', () => {
  const previous: LayoutSnapshot = {
    nodes: [],
    edges: [],
    rects: new Map(),
    projection: projectTree({ nodes: [], edges: [] }),
  };
  const projection = projectTree(branchy);
  const rect = { x: 5, y: 6, width: 150, height: 80 };
  const plan = planLayoutTransition(previous, {
    nodes: [
      {
        id: 'a',
        position: { x: 5, y: 6 },
        data: branchy.nodes[0].data,
      },
    ],
    edges: [],
    rects: new Map([['a', rect]]),
    projection,
  });
  assert.deepEqual(plan.tracks.get('a'), {
    role: 'enter',
    from: rect,
    to: rect,
    resize: false,
  });
});
