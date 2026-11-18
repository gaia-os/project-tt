import { DataNode, NODE_LABELS, NodeLabel, TechTree } from '@/lib/types';
import { cleanConceptLabel, parseTrl } from '@/lib/pathway';
import { nodeRolePluralLabel } from '@/lib/nodeRoles';

/*
 * Projections that scale a tech tree down without losing its shape.
 *
 * - Aggregation draws every node of a group (category, role, or both) as one
 *   summary node until the group is unfolded; an unfolded group is drawn as
 *   a frame around its members.
 * - Folding tucks a node's exclusive prerequisites (nodes whose every path
 *   leads only to it) into the node, like collapsing a branch.
 *
 * Edges are re-pointed at whatever now represents their endpoints and
 * merged, so an edge between two aggregates carries how many links it
 * stands for.
 */

export const AGGREGATION_MODES = [
  'none',
  'category-role',
  'category',
  'role',
] as const;

export type AggregationMode = (typeof AGGREGATION_MODES)[number];

export const AGGREGATION_MODE_LABELS: Record<AggregationMode, string> = {
  none: 'Off (every node)',
  'category-role': 'Category & role',
  category: 'Category',
  role: 'Role',
};

export function isAggregationMode(value: unknown): value is AggregationMode {
  return (
    typeof value === 'string' &&
    (AGGREGATION_MODES as readonly string[]).includes(value)
  );
}

const UNCATEGORIZED = 'Uncategorized';
const SAMPLE_SIZE = 3;
const EMPTY_SET: ReadonlySet<string> = new Set();

export interface TrlSummary {
  min: number | null;
  max: number | null;
  median: number | null;
  /** Members with a parseable TRL. */
  rated: number;
}

export interface GroupInfo {
  /** Stable per mode, so unfolded groups survive filter changes. */
  key: string;
  title: string;
  subtitle: string | null;
  category: string | null;
  role: NodeLabel | null;
}

export interface AggregateSummary extends GroupInfo {
  memberIds: string[];
  roleCounts: Record<NodeLabel, number>;
  /** Role used to colour the aggregate. */
  dominantRole: NodeLabel;
  trl: TrlSummary;
  /** A few member names to hint at what the group holds. */
  sampleLabels: string[];
}

export interface GroupFrame extends GroupInfo {
  id: string;
  /** Every member of the group, including ones folded into other nodes. */
  memberCount: number;
  /** Members drawn inside the frame, in tree order. */
  visibleIds: string[];
}

export interface ProjectedTreeNode {
  kind: 'node';
  id: string;
  node: DataNode;
  /** Frame the node is drawn in; null outside aggregation. */
  frameId: string | null;
  /** Prerequisites currently folded into this node. */
  foldedCount: number;
  /** Prerequisites that folding this node would hide. */
  foldableCount: number;
}

export interface ProjectedAggregateNode {
  kind: 'aggregate';
  id: string;
  aggregate: AggregateSummary;
}

export type ProjectedNode = ProjectedTreeNode | ProjectedAggregateNode;

export interface ProjectedEdge {
  /** The data edge's id when it is drawn unchanged. */
  id: string;
  source: string;
  target: string;
  /** Data edges this edge stands for. */
  weight: number;
}

export interface TreeProjection {
  mode: AggregationMode;
  nodes: ProjectedNode[];
  frames: GroupFrame[];
  edges: ProjectedEdge[];
  /**
   * Drawn id of every input node: the node itself, its aggregate, or the
   * node its branch is folded into.
   */
  representative: Map<string, string>;
  /** Group key of every input node; empty without aggregation. */
  groupKeyOf: Map<string, string>;
}

export interface ProjectionOptions {
  mode?: AggregationMode;
  /** Group keys drawn as frames instead of aggregates. */
  expandedGroups?: ReadonlySet<string>;
  /** Nodes whose exclusive prerequisites are folded into them. */
  foldedNodeIds?: ReadonlySet<string>;
}

export const aggregateNodeId = (key: string) => `agg:${key}`;
export const groupFrameId = (key: string) => `frame:${key}`;

interface Adjacency {
  incoming: Map<string, string[]>;
  outgoing: Map<string, string[]>;
}

function push(map: Map<string, string[]>, key: string, value: string) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function buildAdjacency(tree: TechTree): Adjacency {
  const ids = new Set(tree.nodes.map((node) => node.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const edge of tree.edges) {
    if (edge.source === edge.target) continue;
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue;
    push(incoming, edge.target, edge.source);
    push(outgoing, edge.source, edge.target);
  }
  return { incoming, outgoing };
}

function categoryOf(node: DataNode): string {
  return node.data.category?.trim() || UNCATEGORIZED;
}

export function groupInfoFor(
  node: DataNode,
  mode: AggregationMode,
): GroupInfo | null {
  const category = categoryOf(node);
  const role = node.data.nodeLabel;
  switch (mode) {
    case 'none':
      return null;
    case 'category-role':
      return {
        key: `category-role:${category}:${role}`,
        title: category,
        subtitle: nodeRolePluralLabel(role),
        category,
        role,
      };
    case 'category':
      return {
        key: `category:${category}`,
        title: category,
        subtitle: null,
        category,
        role: null,
      };
    case 'role':
      return {
        key: `role:${role}`,
        title: nodeRolePluralLabel(role),
        subtitle: null,
        category: null,
        role,
      };
  }
}

/**
 * Prerequisites that lead only to `nodeId`: every outgoing edge of each one
 * ends at the node or at another of them. Shared prerequisites stay out, so
 * folding never hides something another branch still needs.
 */
export function exclusivePrerequisites(
  tree: TechTree,
  nodeId: string,
  adjacency: Adjacency = buildAdjacency(tree),
): Set<string> {
  const ancestors: string[] = [];
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  for (let head = 0; head < queue.length; head++) {
    for (const source of adjacency.incoming.get(queue[head]) ?? []) {
      if (seen.has(source)) continue;
      seen.add(source);
      ancestors.push(source);
      queue.push(source);
    }
  }

  // Nearest first; a prerequisite reached again over a longer path is picked
  // up on a later pass once everything it feeds has been hidden.
  const hidden = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of ancestors) {
      if (hidden.has(id)) continue;
      const targets = adjacency.outgoing.get(id) ?? [];
      if (targets.every((target) => target === nodeId || hidden.has(target))) {
        hidden.add(id);
        changed = true;
      }
    }
  }
  return hidden;
}

function emptyRoleCounts(): Record<NodeLabel, number> {
  return Object.fromEntries(NODE_LABELS.map((role) => [role, 0])) as Record<
    NodeLabel,
    number
  >;
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function smrRelevance(node: DataNode): number {
  const smr = node.data.smr;
  return smr?.kind === 'technology' ? smr.relevance : 0;
}

export function summarizeTrl(nodes: DataNode[]): TrlSummary {
  const values = nodes
    .map((node) => parseTrl(node.data.trl_current))
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  return {
    min: values[0] ?? null,
    max: values[values.length - 1] ?? null,
    median: median(values),
    rated: values.length,
  };
}

function summarizeGroup(
  info: GroupInfo,
  members: DataNode[],
): AggregateSummary {
  const roleCounts = emptyRoleCounts();
  for (const member of members) {
    if (member.data.nodeLabel in roleCounts) {
      roleCounts[member.data.nodeLabel] += 1;
    }
  }
  const dominantRole =
    info.role ??
    NODE_LABELS.reduce((best, role) =>
      roleCounts[role] > roleCounts[best] ? role : best,
    );
  const sampleLabels = [...members]
    .sort(
      (a, b) =>
        smrRelevance(b) - smrRelevance(a) ||
        a.data.label.localeCompare(b.data.label),
    )
    .slice(0, SAMPLE_SIZE)
    .map((member) => cleanConceptLabel(member.data.label));

  return {
    ...info,
    memberIds: members.map((member) => member.id),
    roleCounts,
    dominantRole,
    trl: summarizeTrl(members),
    sampleLabels,
  };
}

/** Projects `tree` through aggregation and folding; see the module notes. */
export function projectTree(
  tree: TechTree,
  {
    mode = 'none',
    expandedGroups = EMPTY_SET,
    foldedNodeIds = EMPTY_SET,
  }: ProjectionOptions = {},
): TreeProjection {
  const nodeIds = new Set(tree.nodes.map((node) => node.id));
  const adjacency = buildAdjacency(tree);

  const groupOf = new Map<string, GroupInfo>();
  const groupKeyOf = new Map<string, string>();
  const groupMembers = new Map<string, DataNode[]>();
  const groupInfo = new Map<string, GroupInfo>();
  if (mode !== 'none') {
    for (const node of tree.nodes) {
      const info = groupInfoFor(node, mode)!;
      groupOf.set(node.id, info);
      groupKeyOf.set(node.id, info.key);
      groupInfo.set(info.key, info);
      const members = groupMembers.get(info.key);
      if (members) members.push(node);
      else groupMembers.set(info.key, [node]);
    }
  }
  const isCollapsed = (id: string) => {
    const info = groupOf.get(id);
    return !!info && !expandedGroups.has(info.key);
  };

  // Members of a collapsed aggregate stay with it, so a fold only gathers
  // nodes that would otherwise be drawn on their own.
  const exclusiveCache = new Map<string, string[]>();
  const foldableOf = (id: string) => {
    let cached = exclusiveCache.get(id);
    if (!cached) {
      cached = [...exclusivePrerequisites(tree, id, adjacency)].filter(
        (prerequisite) => !isCollapsed(prerequisite),
      );
      exclusiveCache.set(id, cached);
    }
    return cached;
  };

  // A fold inside another fold has a strictly smaller set, so taking the
  // largest first assigns every hidden node to the outermost visible fold.
  const folds = [...foldedNodeIds]
    .filter((id) => nodeIds.has(id) && !isCollapsed(id))
    .map((id) => ({ id, hidden: foldableOf(id) }))
    .filter((fold) => fold.hidden.length > 0)
    .sort((a, b) => b.hidden.length - a.hidden.length || (a.id < b.id ? -1 : 1));
  const foldedInto = new Map<string, string>();
  for (const fold of folds) {
    if (foldedInto.has(fold.id)) continue;
    for (const id of fold.hidden) {
      if (!foldedInto.has(id)) foldedInto.set(id, fold.id);
    }
  }
  const foldedCount = new Map<string, number>();
  for (const into of foldedInto.values()) {
    foldedCount.set(into, (foldedCount.get(into) ?? 0) + 1);
  }

  const representative = new Map<string, string>();
  for (const node of tree.nodes) {
    const info = groupOf.get(node.id);
    representative.set(
      node.id,
      info && !expandedGroups.has(info.key)
        ? aggregateNodeId(info.key)
        : (foldedInto.get(node.id) ?? node.id),
    );
  }

  const nodes: ProjectedNode[] = [];
  const frames = new Map<string, GroupFrame>();
  for (const node of tree.nodes) {
    if (representative.get(node.id) !== node.id) continue;
    const info = groupOf.get(node.id);
    let frameId: string | null = null;
    if (info) {
      frameId = groupFrameId(info.key);
      let frame = frames.get(info.key);
      if (!frame) {
        frame = {
          ...info,
          id: frameId,
          memberCount: groupMembers.get(info.key)!.length,
          visibleIds: [],
        };
        frames.set(info.key, frame);
      }
      frame.visibleIds.push(node.id);
    }
    nodes.push({
      kind: 'node',
      id: node.id,
      node,
      frameId,
      foldedCount: foldedCount.get(node.id) ?? 0,
      foldableCount: adjacency.incoming.has(node.id)
        ? foldableOf(node.id).length
        : 0,
    });
  }
  for (const [key, members] of groupMembers) {
    if (expandedGroups.has(key)) continue;
    nodes.push({
      kind: 'aggregate',
      id: aggregateNodeId(key),
      aggregate: summarizeGroup(groupInfo.get(key)!, members),
    });
  }

  const merged = new Map<string, ProjectedEdge>();
  for (const edge of tree.edges) {
    const source = representative.get(edge.source);
    const target = representative.get(edge.target);
    if (!source || !target || source === target) continue;
    const pairKey = `${source}\u0000${target}`;
    const existing = merged.get(pairKey);
    if (existing) {
      existing.weight += 1;
      existing.id = `agg-edge:${source}->${target}`;
      continue;
    }
    const unchanged = source === edge.source && target === edge.target;
    merged.set(pairKey, {
      id: unchanged ? edge.id : `agg-edge:${source}->${target}`,
      source,
      target,
      weight: 1,
    });
  }

  return {
    mode,
    nodes,
    frames: [...frames.values()],
    edges: [...merged.values()],
    representative,
    groupKeyOf,
  };
}

/** All group keys of `tree` under `mode`, e.g. for "unfold all". */
export function groupKeysOf(tree: TechTree, mode: AggregationMode): string[] {
  if (mode === 'none') return [];
  return [
    ...new Set(tree.nodes.map((node) => groupInfoFor(node, mode)!.key)),
  ];
}

export interface TreeSummary {
  nodeCount: number;
  edgeCount: number;
  categoryCount: number;
  roleCounts: Record<NodeLabel, number>;
  /** Index `i` counts nodes at TRL `i + 1`. */
  trlHistogram: number[];
  unratedCount: number;
  medianTrl: number | null;
  /** Share of rated nodes at TRL 7 or above (system demonstrated). */
  matureShare: number | null;
  /** Nodes on the longest prerequisite chain. */
  longestChain: number;
}

/** Size, readiness and depth figures used to compare trees. */
export function summarizeTree(tree: TechTree): TreeSummary {
  const roleCounts = emptyRoleCounts();
  const categories = new Set<string>();
  const trlHistogram = Array.from({ length: 9 }, () => 0);
  let unratedCount = 0;
  for (const node of tree.nodes) {
    if (node.data.nodeLabel in roleCounts) roleCounts[node.data.nodeLabel] += 1;
    categories.add(categoryOf(node));
    const trl = parseTrl(node.data.trl_current);
    if (trl === null) unratedCount += 1;
    else trlHistogram[trl - 1] += 1;
  }
  const trl = summarizeTrl(tree.nodes);
  const mature = trlHistogram.slice(6).reduce((sum, count) => sum + count, 0);

  // Longest path by Kahn's algorithm; nodes on a cycle are left out.
  const adjacency = buildAdjacency(tree);
  const inDegree = new Map(
    tree.nodes.map((node) => [
      node.id,
      adjacency.incoming.get(node.id)?.length ?? 0,
    ]),
  );
  const depth = new Map<string, number>();
  const queue = tree.nodes
    .filter((node) => inDegree.get(node.id) === 0)
    .map((node) => node.id);
  queue.forEach((id) => depth.set(id, 1));
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const next of adjacency.outgoing.get(current) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, depth.get(current)! + 1));
      const remaining = inDegree.get(next)! - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return {
    nodeCount: tree.nodes.length,
    edgeCount: [...adjacency.outgoing.values()].reduce(
      (sum, targets) => sum + targets.length,
      0,
    ),
    categoryCount: categories.size,
    roleCounts,
    trlHistogram,
    unratedCount,
    medianTrl: trl.median,
    matureShare: trl.rated ? mature / trl.rated : null,
    longestChain: Math.max(0, ...depth.values()),
  };
}
