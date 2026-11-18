import {
  LABEL_COLORS_VARIABLES,
  NodeLabel,
  UiNode,
  GroupingMode,
  TechTree,
} from '@/lib/types';
import {
  AggregateSummary,
  GroupFrame,
  ProjectedNode,
  TreeProjection,
} from '@/lib/treeProjection';
import { Bounds, boundsOf } from '@/lib/canvasZoom';
import {
  Edge,
  EdgeMarker,
  MarkerType,
  Position,
  XYPosition,
} from '@xyflow/react';
import ELK, { ElkNode } from 'elkjs/lib/elk.bundled.js';
import type { CSSProperties } from 'react';

const elk = new ELK();

const nodeWidth = 150;
const nodeHeight = 80;
export const AGGREGATE_NODE_WIDTH = 240;
export const AGGREGATE_NODE_HEIGHT = 124;
/** Room for the frame header above the members. */
const FRAME_PADDING = '[top=56,left=20,bottom=20,right=20]';
const EDGE_COLOR = '#374151';

/** Per-node fold state shown by the fold toggle. */
export interface NodeFoldState {
  /** Prerequisites currently folded into the node. */
  folded: number;
  /** Prerequisites folding would hide. */
  foldable: number;
}

export interface AggregateNodeData extends Record<string, unknown> {
  label: string;
  nodeLabel: NodeLabel;
  description: string;
  aggregate: AggregateSummary;
}

export interface GroupFrameNodeData extends Record<string, unknown> {
  label: string;
  nodeLabel: NodeLabel;
  description: string;
  frame: GroupFrame;
}

export interface EdgeWeightData extends Record<string, unknown> {
  /** Data edges an aggregated edge stands for. */
  weight: number;
}

export interface LayoutResult {
  layoutedNodes: UiNode[];
  layoutedEdges: Edge[];
  /** Extent of everything drawn, in flow coordinates. */
  bounds: Bounds | null;
  /** Top-left of every node in flow coordinates (children are nested). */
  absolutePositions: Map<string, XYPosition>;
  /** Box of every node (frames included) in flow coordinates. */
  rects: Map<string, Bounds>;
}

/**
 * Moves a whole layout by `delta`. Only top-level nodes move; frame members
 * are positioned relative to their frame and follow it.
 */
export function shiftLayout(result: LayoutResult, delta: XYPosition): LayoutResult {
  if (!delta.x && !delta.y) return result;
  const move = <T extends XYPosition>(point: T): T => ({
    ...point,
    x: point.x + delta.x,
    y: point.y + delta.y,
  });
  return {
    ...result,
    layoutedNodes: result.layoutedNodes.map((node) =>
      node.parentId ? node : { ...node, position: move(node.position) },
    ),
    bounds: result.bounds ? move(result.bounds) : null,
    absolutePositions: new Map(
      [...result.absolutePositions].map(([id, point]) => [id, move(point)]),
    ),
    rects: new Map([...result.rects].map(([id, rect]) => [id, move(rect)])),
  };
}

/**
 * The subgraph the current filters show: search, "group by" role and the
 * connected-nodes view. Pathways bypass this and lay out their own tree.
 */
export function selectVisibleTree(
  groupingMode: GroupingMode,
  selectedNodeId: string | null,
  showOnlyConnected: boolean,
  searchTerm: string,
  techTree: TechTree,
): TechTree {
  if (groupingMode === 'None') {
    return getUnGroupedTree(selectedNodeId, searchTerm, techTree);
  }
  if (selectedNodeId) {
    return getRelatedNodesTreeWithGrouping(
      selectedNodeId,
      groupingMode,
      showOnlyConnected,
      searchTerm,
      techTree,
    );
  }
  return getGroupedTree(groupingMode, searchTerm, techTree);
}

const getUnGroupedTree = (
  showingRelatedNodes: string | null,
  searchTerm: string,
  { nodes, edges }: TechTree,
): TechTree => {
  let visibleNodes = filterNodesBySearch(nodes, searchTerm);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  let visibleEdges = filterEdgesByVisibleNodes(edges, visibleNodeIds);

  if (showingRelatedNodes) {
    const { connectedNodeIds, connectedEdgeIds } = findConnectedNodesAndEdges(
      showingRelatedNodes,
      visibleEdges,
    );
    visibleNodes = nodes.filter((node) => connectedNodeIds.has(node.id));
    visibleEdges = visibleEdges.filter((edge) => connectedEdgeIds.has(edge.id));
  }

  return { nodes: visibleNodes, edges: visibleEdges };
};

const getRelatedNodesTreeWithGrouping = (
  selectedNodeId: string,
  groupingMode: GroupingMode,
  showOnlyConnected: boolean,
  searchTerm: string,
  { nodes, edges }: TechTree,
): TechTree => {
  const { connectedNodeIds, connectedEdgeIds } = findConnectedNodesAndEdges(
    selectedNodeId,
    edges,
  );

  if (!showOnlyConnected) {
    nodes
      .filter((node) => node.data.nodeLabel === groupingMode)
      .forEach((node) => connectedNodeIds.add(node.id));
  }

  const visibleNodes = filterNodesBySearch(
    nodes.filter((node) => connectedNodeIds.has(node.id)),
    searchTerm,
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter((edge) => {
    const isConnectedToSelected = connectedEdgeIds.has(edge.id);
    if (showOnlyConnected) return isConnectedToSelected;
    const isBetweenVisible =
      visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target);
    return isConnectedToSelected || isBetweenVisible;
  });

  return { nodes: visibleNodes, edges: visibleEdges };
};

const getGroupedTree = (
  groupingMode: GroupingMode,
  searchTerm: string,
  { nodes, edges }: TechTree,
): TechTree => {
  const visibleNodes = filterNodesBySearch(
    nodes.filter((node) => node.data.nodeLabel === groupingMode),
    searchTerm,
  );
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  return {
    nodes: visibleNodes,
    edges: filterEdgesByVisibleNodes(edges, visibleNodeIds),
  };
};

const filterNodesBySearch = <T extends { data: { label?: string } }>(
  nodes: T[],
  searchTerm: string,
): T[] => {
  if (!searchTerm.trim()) {
    return nodes;
  }

  try {
    const regex = new RegExp(searchTerm, 'i');
    return nodes.filter((node) => regex.test(node.data?.label || ''));
  } catch {
    const searchLower = searchTerm.toLowerCase();
    return nodes.filter((node) =>
      (node.data?.label || '').toLowerCase().includes(searchLower),
    );
  }
};

const filterEdgesByVisibleNodes = (
  edges: Edge[],
  visibleNodeIds: Set<string>,
): Edge[] => {
  return edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );
};

const findConnectedNodesAndEdges = (nodeId: string, edges: Edge[]) => {
  const connectedNodeIds = new Set<string>([nodeId]);
  const connectedEdgeIds = new Set<string>();

  edges.forEach((edge) => {
    if (edge.source === nodeId || edge.target === nodeId) {
      connectedEdgeIds.add(edge.id);
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }
  });

  return { connectedNodeIds, connectedEdgeIds };
};

function sizeOf(node: ProjectedNode) {
  return node.kind === 'aggregate'
    ? { width: AGGREGATE_NODE_WIDTH, height: AGGREGATE_NODE_HEIGHT }
    : { width: nodeWidth, height: nodeHeight };
}

/**
 * Lays out a projected tree with ELK. Unfolded groups become compound
 * nodes, so their members are placed together inside a frame.
 */
export async function layoutProjection(
  projection: TreeProjection,
  {
    anchorNodeId,
    showFoldControls = false,
  }: { anchorNodeId?: string | null; showFoldControls?: boolean } = {},
): Promise<LayoutResult> {
  // Reactors are the end of every chain, so in a mixed view they all belong in
  // the last (rightmost) layer. Two things otherwise scatter them: each reactor
  // sits one layer after its own longest chain of technologies, and ELK lays
  // out disconnected parts of the tree side by side, each with its own layers.
  // Views with only reactors (or none) keep ELK's default packing.
  const isReactor = (node: ProjectedNode) =>
    node.kind === 'aggregate'
      ? node.aggregate.dominantRole === 'ReactorConcept'
      : node.node.data?.nodeLabel === 'ReactorConcept';
  const pinReactors =
    projection.nodes.some(isReactor) && !projection.nodes.every(isReactor);

  const frameById = new Map(projection.frames.map((frame) => [frame.id, frame]));
  const childrenOf = new Map<string, ElkNode[]>();
  const topLevel: ElkNode[] = [];
  for (const node of projection.nodes) {
    const elkNode: ElkNode = { id: node.id, ...sizeOf(node) };
    const frameId = node.kind === 'node' ? node.frameId : null;
    if (frameId && frameById.has(frameId)) {
      const children = childrenOf.get(frameId);
      if (children) children.push(elkNode);
      else childrenOf.set(frameId, [elkNode]);
    } else {
      if (pinReactors && isReactor(node)) {
        elkNode.layoutOptions = {
          'elk.layered.layering.layerConstraint': 'LAST',
        };
      }
      topLevel.push(elkNode);
    }
  }
  const frameNodes: ElkNode[] = projection.frames
    .filter((frame) => childrenOf.has(frame.id))
    .map((frame) => ({
      id: frame.id,
      layoutOptions: { 'elk.padding': FRAME_PADDING },
      children: childrenOf.get(frame.id),
    }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      ...(pinReactors ? { 'elk.separateConnectedComponents': 'false' } : {}),
      ...(frameNodes.length
        ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' }
        : {}),
    },
    children: [...frameNodes, ...topLevel],
    edges: projection.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layouted = await elk.layout(graph);

  const placed = new Map<string, { node: ElkNode; parentId: string | null }>();
  const absolutePositions = new Map<string, XYPosition>();
  const rects = new Map<string, Bounds>();
  for (const child of layouted.children ?? []) {
    const x = child.x ?? 0;
    const y = child.y ?? 0;
    placed.set(child.id, { node: child, parentId: null });
    absolutePositions.set(child.id, { x, y });
    rects.set(child.id, {
      x,
      y,
      width: child.width ?? 0,
      height: child.height ?? 0,
    });
    for (const grandchild of child.children ?? []) {
      const gx = x + (grandchild.x ?? 0);
      const gy = y + (grandchild.y ?? 0);
      placed.set(grandchild.id, { node: grandchild, parentId: child.id });
      absolutePositions.set(grandchild.id, { x: gx, y: gy });
      rects.set(grandchild.id, {
        x: gx,
        y: gy,
        width: grandchild.width ?? 0,
        height: grandchild.height ?? 0,
      });
    }
  }

  const position = (id: string): XYPosition => {
    const entry = placed.get(id)?.node;
    return { x: entry?.x ?? 0, y: entry?.y ?? 0 };
  };

  // Parents must precede their children in React Flow's node list.
  const frames: UiNode[] = projection.frames
    .filter((frame) => placed.has(frame.id))
    .map((frame) => frameNode(frame, placed.get(frame.id)!.node));
  const nodes: UiNode[] = projection.nodes.map((node) => {
    const parentId = placed.get(node.id)?.parentId ?? undefined;
    if (node.kind === 'aggregate') {
      return aggregateNode(node.aggregate, node.id, position(node.id));
    }
    const fold: NodeFoldState | undefined =
      showFoldControls && (node.foldedCount > 0 || node.foldableCount > 0)
        ? { folded: node.foldedCount, foldable: node.foldableCount }
        : undefined;
    return applyNodeStyling(
      {
        ...node.node,
        data: { ...node.node.data, ...(fold ? { fold } : {}) },
        position: position(node.id),
        ...(parentId ? { parentId } : {}),
        width: nodeWidth,
        height: nodeHeight,
        targetPosition: Position.Left,
        sourcePosition: Position.Right,
      } as UiNode,
      anchorNodeId ?? undefined,
    );
  });

  return {
    layoutedNodes: [...frames, ...nodes],
    layoutedEdges: projection.edges.map((edge) =>
      applyEdgeStyling({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        data: { weight: edge.weight } satisfies EdgeWeightData,
      }),
    ),
    // Frames contain their members, so top-level boxes span everything.
    bounds: boundsOf(
      (layouted.children ?? []).map((child) => rects.get(child.id)!),
    ),
    absolutePositions,
    rects,
  };
}

export function roleColor(role: NodeLabel | string | undefined): string {
  return LABEL_COLORS_VARIABLES[role as NodeLabel] ?? '#64748b';
}

/** Offset sheets behind a node that stands for several (aggregate, fold). */
export function stackedShadow(color: string): string {
  return [
    '4px 4px 0 -1px #ffffff',
    `4px 4px 0 0 ${color}`,
    '8px 8px 0 -1px #ffffff',
    `8px 8px 0 0 ${color}`,
  ].join(', ');
}

/** Ring drawn around highlighted nodes. */
export const HIGHLIGHT_RING = '0 0 0 2px #f97316';

/** Ring around nodes in the custom tree being built. */
export const DRAFT_RING = '0 0 0 3px #2563eb';
/** Ring around nodes under a Shift+drag selection box. */
export const BOX_PREVIEW_RING = '0 0 0 3px #93c5fd';

/**
 * Box shadow for a node: its stack (if it hides others) plus any ring.
 * `ring` replaces the highlight ring (builder states win).
 */
export function nodeShadow(
  node: UiNode,
  highlighted: boolean,
  ring: string | null = null,
): string {
  const stacked =
    node.type === 'aggregate' ||
    ((node.data.fold as NodeFoldState | undefined)?.folded ?? 0) > 0;
  const layers = [
    ring ?? (highlighted ? HIGHLIGHT_RING : null),
    stacked ? stackedShadow(roleColor(node.data.nodeLabel)) : null,
  ].filter(Boolean);
  return layers.length ? layers.join(', ') : 'none';
}

function aggregateNode(
  aggregate: AggregateSummary,
  id: string,
  position: XYPosition,
): UiNode {
  const color = roleColor(aggregate.role ?? aggregate.dominantRole);
  const data: AggregateNodeData = {
    label: aggregate.subtitle
      ? `${aggregate.title} · ${aggregate.subtitle}`
      : aggregate.title,
    nodeLabel: aggregate.dominantRole,
    description: '',
    aggregate,
  };
  return {
    id,
    type: 'aggregate',
    position,
    width: AGGREGATE_NODE_WIDTH,
    height: AGGREGATE_NODE_HEIGHT,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
    data,
    style: {
      background: '#ffffff',
      borderColor: color,
      borderStyle: 'solid',
      borderWidth: '1px',
      borderRadius: '10px',
      boxShadow: stackedShadow(color),
      '--tt-role': color,
    } as CSSProperties,
  } as UiNode;
}

function frameNode(frame: GroupFrame, layouted: ElkNode): UiNode {
  const color = roleColor(frame.role ?? undefined);
  const width = layouted.width ?? 0;
  const height = layouted.height ?? 0;
  const data: GroupFrameNodeData = {
    label: frame.subtitle ? `${frame.title} · ${frame.subtitle}` : frame.title,
    nodeLabel: frame.role ?? 'EnablingTechnology',
    description: '',
    frame,
  };
  return {
    id: frame.id,
    type: 'groupFrame',
    position: { x: layouted.x ?? 0, y: layouted.y ?? 0 },
    width,
    height,
    selectable: false,
    focusable: false,
    data,
    style: {
      width,
      height,
      '--tt-role': color,
    } as CSSProperties,
  } as UiNode;
}

const applyNodeStyling = (node: UiNode, selectedNodeId?: string): UiNode => {
  const color = roleColor(node.data.nodeLabel);
  const isAnchor = node.id === selectedNodeId;
  return {
    ...node,
    style: {
      borderColor: color,
      borderStyle: 'solid',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      borderWidth: isAnchor ? '3px' : '1px',
      boxShadow: nodeShadow(node, isAnchor),
      fontWeight: isAnchor ? 'bold' : 'normal',
      '--tt-role': color,
    } as CSSProperties,
  } as UiNode;
};

/** Stroke width for an edge standing for `weight` data edges. */
export function edgeStrokeWidth(weight: number): number {
  return weight > 1 ? Math.min(1 + Math.log2(weight) * 1.25, 7) : 1;
}

/**
 * Arrowhead for an edge. Markers scale with the stroke by default, which
 * would blow up on thick aggregated edges, so those are sized in pixels.
 */
export function edgeMarker(color: string, weight: number): EdgeMarker {
  if (weight <= 1) {
    return { type: MarkerType.ArrowClosed, width: 20, height: 20, color };
  }
  const size = 16 + edgeStrokeWidth(weight) * 2;
  return {
    type: MarkerType.ArrowClosed,
    width: size,
    height: size,
    color,
    markerUnits: 'userSpaceOnUse',
  };
}

const applyEdgeStyling = (edge: Edge): Edge => {
  const weight = (edge.data as EdgeWeightData | undefined)?.weight ?? 1;
  return {
    ...edge,
    ...(weight > 1
      ? {
          label: String(weight),
          labelStyle: { fontSize: 11, fill: EDGE_COLOR, fontWeight: 600 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 4,
        }
      : {}),
    style: {
      strokeWidth: edgeStrokeWidth(weight),
      stroke: EDGE_COLOR,
    },
    markerEnd: edgeMarker(EDGE_COLOR, weight),
  };
};
