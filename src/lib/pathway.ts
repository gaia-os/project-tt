import { DataNode, NodeLabel, TechTree } from '@/lib/types';

export interface PathwayEdge {
  id: string;
  source: string;
  target: string;
}

export interface PathwayStage {
  /** Longest-path distance from a root prerequisite (0 = foundations). */
  level: number;
  title: string;
  description: string;
  nodeIds: string[];
}

export interface PathwayBottleneck {
  nodeId: string;
  trl: number;
}

/** A technology and the full chain of prerequisites that leads to it. */
export interface Pathway {
  targetId: string;
  /** Prerequisites plus the target. */
  nodeIds: string[];
  edgeIds: string[];
  edges: PathwayEdge[];
  /** Ordered foundations-first; the last stage holds only the target. */
  stages: PathwayStage[];
  /** Lowest-readiness prerequisite, the likeliest schedule risk. */
  bottleneck: PathwayBottleneck | null;
  prerequisiteCount: number;
  /** Prerequisites dropped by `maxNodes`, farthest from the target first. */
  hiddenCount: number;
}

/** Keeps SMR pathways (technology-dense) readable as a guided walk. */
export const PATHWAY_MAX_NODES = 40;

export interface BuildPathwayOptions {
  /** Upper bound on prerequisites kept (the target is always kept). */
  maxNodes?: number;
}

interface GraphIndex {
  nodeById: Map<string, DataNode>;
  incoming: Map<string, PathwayEdge[]>;
}

const TYPE_ORDER: Record<NodeLabel, number> = {
  EnablingTechnology: 0,
  Milestone: 1,
  ReactorConcept: 2,
};

/** Drops the "Concept: " prefix used by the nuclear dataset. */
export function cleanConceptLabel(label: string): string {
  return label.replace(/^\s*concept:\s*/i, '').trim();
}

/** First integer in a TRL string ("4-5" -> 4), clamped to 1-9. */
export function parseTrl(value: string | null | undefined): number | null {
  const match = value?.match(/\d+/);
  if (!match) return null;
  const trl = Number(match[0]);
  return trl >= 1 && trl <= 9 ? trl : null;
}

export function createGraphIndex(tree: TechTree): GraphIndex {
  const nodeById = new Map(tree.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, PathwayEdge[]>();
  for (const edge of tree.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const list = incoming.get(edge.target) ?? [];
    list.push({ id: edge.id, source: edge.source, target: edge.target });
    incoming.set(edge.target, list);
  }
  return { nodeById, incoming };
}

/** Prerequisites of `targetId` with their hop distance, nearest first. */
function collectAncestors(index: GraphIndex, targetId: string) {
  const distance = new Map<string, number>([[targetId, 0]]);
  const queue = [targetId];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const edge of index.incoming.get(current) ?? []) {
      if (distance.has(edge.source)) continue;
      distance.set(edge.source, distance.get(current)! + 1);
      queue.push(edge.source);
    }
  }
  distance.delete(targetId);
  return distance;
}

export function countPrerequisites(index: GraphIndex, targetId: string): number {
  return index.nodeById.has(targetId)
    ? collectAncestors(index, targetId).size
    : 0;
}

function smrRelevance(node: DataNode | undefined): number {
  const smr = node?.data.smr;
  return smr?.kind === 'technology' ? smr.relevance : 0;
}

/**
 * Longest-path level of every node (Kahn's algorithm). Nodes caught in a
 * cycle are levelled from whatever predecessors were already placed, so bad
 * data degrades the ordering instead of hanging.
 */
function assignLevels(
  nodeIds: string[],
  edges: PathwayEdge[],
  targetId: string,
  distance: Map<string, number>,
): Map<string, number> {
  const inDegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const edge of edges) {
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    push(outgoing, edge.source, edge.target);
    push(predecessors, edge.target, edge.source);
  }

  const level = new Map<string, number>();
  const queue = nodeIds.filter((id) => inDegree.get(id) === 0);
  queue.forEach((id) => level.set(id, 0));
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    for (const next of outgoing.get(current) ?? []) {
      level.set(next, Math.max(level.get(next) ?? 0, level.get(current)! + 1));
      const remaining = inDegree.get(next)! - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  const unplaced = nodeIds
    .filter((id) => !level.has(id))
    .sort((a, b) => (distance.get(b) ?? 0) - (distance.get(a) ?? 0));
  for (const id of unplaced) {
    const placed = (predecessors.get(id) ?? [])
      .map((pred) => level.get(pred))
      .filter((value): value is number => value !== undefined);
    level.set(id, placed.length ? Math.max(...placed) + 1 : 0);
  }

  // Cycles through the target could leave a prerequisite level with it.
  let maxPrerequisiteLevel = -1;
  for (const [id, value] of level) {
    if (id !== targetId) maxPrerequisiteLevel = Math.max(maxPrerequisiteLevel, value);
  }
  level.set(targetId, maxPrerequisiteLevel + 1);
  return level;
}

function describeStage(
  level: number,
  nodes: DataNode[],
  isTarget: boolean,
): Pick<PathwayStage, 'title' | 'description'> {
  if (isTarget) {
    return {
      title: 'The deployment concept',
      description: 'Every step before this one feeds into this concept.',
    };
  }
  if (level === 0) {
    return {
      title: 'Foundations',
      description:
        'The starting capabilities and demonstrations everything else builds on.',
    };
  }
  const labels = new Set(nodes.map((node) => node.data.nodeLabel));
  if (labels.size === 1 && labels.has('EnablingTechnology')) {
    return {
      title: 'Enabling technologies',
      description:
        'Capabilities and subsystems that must mature before the next step.',
    };
  }
  if (labels.size === 1 && labels.has('Milestone')) {
    return {
      title: 'Milestones',
      description:
        'Demonstrations and qualifications that prove the pathway works.',
    };
  }
  if (labels.size === 1 && labels.has('ReactorConcept')) {
    return {
      title: 'Predecessor concepts',
      description: 'Earlier deployment concepts this one builds on.',
    };
  }
  return {
    title: 'Mixed prerequisites',
    description:
      'Technologies and demonstrations that together unlock the next step.',
  };
}

function compareWithinStage(a: DataNode, b: DataNode): number {
  const typeDelta =
    (TYPE_ORDER[a.data.nodeLabel] ?? 9) - (TYPE_ORDER[b.data.nodeLabel] ?? 9);
  if (typeDelta !== 0) return typeDelta;
  const trlDelta =
    (parseTrl(a.data.trl_current) ?? 99) - (parseTrl(b.data.trl_current) ?? 99);
  if (trlDelta !== 0) return trlDelta;
  return a.data.label.localeCompare(b.data.label);
}

/**
 * Builds the upstream pathway of `targetId`: every node with a directed path
 * to it (`source -> target` means prerequisite -> dependent), staged by
 * longest-path level so each stage only depends on earlier ones.
 */
export function buildPathway(
  tree: TechTree,
  targetId: string,
  { maxNodes = Number.POSITIVE_INFINITY }: BuildPathwayOptions = {},
  index: GraphIndex = createGraphIndex(tree),
): Pathway | null {
  const target = index.nodeById.get(targetId);
  if (!target) return null;

  const distance = collectAncestors(index, targetId);
  const ranked = [...distance.keys()].sort(
    (a, b) =>
      distance.get(a)! - distance.get(b)! ||
      smrRelevance(index.nodeById.get(b)) - smrRelevance(index.nodeById.get(a)) ||
      a.localeCompare(b),
  );
  // Keeping whole hop-distance rings nearest-first leaves every kept node
  // connected to the target.
  const kept = ranked.slice(0, Math.max(0, maxNodes));
  const nodeIdSet = new Set([...kept, targetId]);

  const edges: PathwayEdge[] = [];
  for (const id of nodeIdSet) {
    for (const edge of index.incoming.get(id) ?? []) {
      if (nodeIdSet.has(edge.source)) edges.push(edge);
    }
  }

  const nodeIds = [...nodeIdSet];
  const level = assignLevels(nodeIds, edges, targetId, distance);
  const byLevel = new Map<number, DataNode[]>();
  for (const id of nodeIds) {
    const value = level.get(id)!;
    const node = index.nodeById.get(id)!;
    const list = byLevel.get(value);
    if (list) list.push(node);
    else byLevel.set(value, [node]);
  }

  const stages = [...byLevel.keys()]
    .sort((a, b) => a - b)
    .map((value) => {
      const nodes = byLevel.get(value)!.sort(compareWithinStage);
      const isTarget = nodes.length === 1 && nodes[0].id === targetId;
      const described = describeStage(value, nodes, isTarget);
      // A lone node names its own stage, so chains of single steps read
      // as distinct steps rather than a repeated category.
      const title =
        !isTarget && value > 0 && nodes.length === 1
          ? cleanConceptLabel(nodes[0].data.label)
          : described.title;
      return {
        level: value,
        title,
        description: described.description,
        nodeIds: nodes.map((node) => node.id),
      };
    });

  let bottleneck: PathwayBottleneck | null = null;
  for (const id of kept) {
    const trl = parseTrl(index.nodeById.get(id)!.data.trl_current);
    if (trl !== null && (!bottleneck || trl < bottleneck.trl)) {
      bottleneck = { nodeId: id, trl };
    }
  }

  return {
    targetId,
    nodeIds,
    edgeIds: edges.map((edge) => edge.id),
    edges,
    stages,
    bottleneck,
    prerequisiteCount: kept.length,
    hiddenCount: ranked.length - kept.length,
  };
}

/** Restricts a tree to the pathway's nodes and edges for layout. */
export function pathwaySubtree(tree: TechTree, pathway: Pathway): TechTree {
  const nodeIds = new Set(pathway.nodeIds);
  const edgeIds = new Set(pathway.edgeIds);
  return {
    nodes: tree.nodes.filter((node) => nodeIds.has(node.id)),
    edges: tree.edges.filter((edge) => edgeIds.has(edge.id)),
  };
}

export type PathwayStepKind = 'overview' | 'stage' | 'finale' | 'empty';

export interface PathwayStep {
  kind: PathwayStepKind;
  title: string;
  description: string;
  stage: PathwayStage | null;
  highlightNodeIds: string[];
  highlightEdgeIds: string[];
  /** Nodes the camera frames; empty keeps the default whole-graph fit. */
  fitNodeIds: string[];
  /** Fade everything that is not highlighted. */
  dimOthers: boolean;
  /** Node shown in the details panel. */
  focusNodeId: string;
}

/**
 * Turns a pathway into guide steps: an overview of the whole chain, one step
 * per prerequisite stage, and a finale on the concept itself. A concept with
 * no tracked prerequisites gets a single `empty` step.
 */
export function buildPathwaySteps(pathway: Pathway): PathwayStep[] {
  const { targetId, edges } = pathway;
  const incomingToTarget = edges
    .filter((edge) => edge.target === targetId)
    .map((edge) => edge.id);

  if (pathway.prerequisiteCount === 0) {
    return [
      {
        kind: 'empty',
        title: 'No tracked prerequisites',
        description:
          'This dataset records nothing upstream of this concept, so its direct connections are shown instead.',
        stage: null,
        highlightNodeIds: [targetId],
        highlightEdgeIds: [],
        fitNodeIds: [],
        dimOthers: false,
        focusNodeId: targetId,
      },
    ];
  }

  const prerequisiteStages = pathway.stages.slice(0, -1);
  const overview: PathwayStep = {
    kind: 'overview',
    title: 'The path at a glance',
    description: `${pathway.prerequisiteCount} prerequisite${
      pathway.prerequisiteCount === 1 ? '' : 's'
    } in ${prerequisiteStages.length} step${
      prerequisiteStages.length === 1 ? '' : 's'
    } lead to this concept.`,
    stage: null,
    highlightNodeIds: [targetId],
    highlightEdgeIds: [],
    fitNodeIds: pathway.nodeIds,
    dimOthers: false,
    focusNodeId: targetId,
  };

  const stageSteps = prerequisiteStages.map((stage): PathwayStep => {
    const stageNodes = new Set(stage.nodeIds);
    return {
      kind: 'stage',
      title: stage.title,
      description: stage.description,
      stage,
      highlightNodeIds: stage.nodeIds,
      highlightEdgeIds: edges
        .filter((edge) => stageNodes.has(edge.source))
        .map((edge) => edge.id),
      fitNodeIds: stage.nodeIds,
      dimOthers: true,
      focusNodeId: stage.nodeIds[0],
    };
  });

  const finaleStage = pathway.stages[pathway.stages.length - 1];
  const finale: PathwayStep = {
    kind: 'finale',
    title: finaleStage.title,
    description: finaleStage.description,
    stage: finaleStage,
    highlightNodeIds: [targetId],
    highlightEdgeIds: incomingToTarget,
    fitNodeIds: pathway.nodeIds,
    dimOthers: false,
    focusNodeId: targetId,
  };

  return [overview, ...stageSteps, finale];
}
