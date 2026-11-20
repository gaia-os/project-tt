'use client';

import { useEffect } from 'react';
import {
  Edge,
  Handle,
  Node,
  NodeProps,
  NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { Info } from 'lucide-react';
import { DataNode } from '@/lib/types';
import { edgeMarker, roleColor } from '@/lib/elkjs';
import { nodeRoleLabel } from '@/lib/nodeRoles';

/*
 * Shared pieces of the "entities in this answer" graph: the mention node
 * renderer, the left-to-right longest-path layout (reactors pinned to the
 * rightmost column like the main tree), and a small ReactFlow wrapper.
 * Used by the full-canvas ChatView.
 */

export const MENTION_NODE_W = 176;
export const MENTION_NODE_H = 56;
const GAP_X = 64;
const GAP_Y = 20;
const EDGE_COLOR = '#374151';

interface MentionNodeData extends Record<string, unknown> {
  label: string;
  nodeLabel?: string;
  /** Direct neighbour of the selected node. */
  neighbour?: boolean;
  onShowDetails?: (nodeId: string) => void;
}

export type MentionFlowNode = Node<MentionNodeData>;

function MentionNode({ id, data, selected }: NodeProps<MentionFlowNode>) {
  const ring = selected
    ? 'ring-2 ring-amber-500'
    : data.neighbour
      ? 'ring-1 ring-amber-300'
      : '';
  return (
    <div
      className={`w-full h-full rounded-md border bg-white px-2.5 py-1.5 text-left shadow-sm ${ring}`}
      style={{ borderColor: roleColor(data.nodeLabel) }}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="line-clamp-2 text-xs font-medium leading-snug text-gray-900">
        {data.label}
      </div>
      <div className="mt-0.5 text-[10px] text-gray-500">
        {nodeRoleLabel(data.nodeLabel)}
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
      {data.onShowDetails && (
        <button
          type="button"
          className="nodrag absolute -top-2 -right-2 z-10 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-500 shadow-sm hover:border-blue-500 hover:text-blue-600"
          onClick={(event) => {
            event.stopPropagation();
            data.onShowDetails?.(id);
          }}
          title="Show details"
          aria-label={`Show details for ${data.label}`}
        >
          <Info size={11} />
        </button>
      )}
    </div>
  );
}

const NODE_TYPES: NodeTypes = { mention: MentionNode };

/**
 * x = longest-path depth over the induced edges, y = mention order per
 * depth. Reactors (deployment concepts) are pinned right of everything
 * else, like the LAST-layer constraint in the main layout.
 */
function layoutMentions(
  nodes: { id: string; nodeLabel?: string }[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
  const ids = nodes.map((node) => node.id);
  const depth = new Map<string, number>();
  const remaining = new Map<string, number>();
  const successors = new Map<string, string[]>();
  for (const id of ids) {
    remaining.set(id, 0);
    successors.set(id, []);
  }
  for (const edge of edges) {
    successors.get(edge.source)?.push(edge.target);
    remaining.set(edge.target, (remaining.get(edge.target) ?? 0) + 1);
  }
  let frontier = ids.filter((id) => (remaining.get(id) ?? 0) === 0);
  const visited = new Set<string>();
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      for (const target of successors.get(id) ?? []) {
        depth.set(
          target,
          Math.max(depth.get(target) ?? 0, (depth.get(id) ?? 0) + 1),
        );
        const left = (remaining.get(target) ?? 0) - 1;
        remaining.set(target, left);
        if (left === 0) next.push(target);
      }
    }
    frontier = next;
  }

  const isReactor = (node: { nodeLabel?: string }) =>
    node.nodeLabel === 'ReactorConcept';
  const hasNonReactor = nodes.some((node) => !isReactor(node));
  const maxNonReactorDepth = Math.max(
    0,
    ...nodes
      .filter((node) => !isReactor(node))
      .map((node) => depth.get(node.id) ?? 0),
  );

  const perLevel = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const level =
      isReactor(node) && hasNonReactor
        ? Math.max(depth.get(node.id) ?? 0, maxNonReactorDepth + 1)
        : (depth.get(node.id) ?? 0);
    const row = perLevel.get(level) ?? 0;
    perLevel.set(level, row + 1);
    positions.set(node.id, {
      x: level * (MENTION_NODE_W + GAP_X),
      y: row * (MENTION_NODE_H + GAP_Y),
    });
  }
  return positions;
}

interface BuildNodesOptions {
  onShowDetails?: (nodeId: string) => void;
  /** Node shown selected; its edge neighbours get a lighter ring. */
  selectedId?: string | null;
  draggable?: boolean;
}

export function buildMentionFlowNodes(
  nodes: DataNode[],
  edges: Edge[],
  {
    onShowDetails,
    selectedId = null,
    draggable = false,
  }: BuildNodesOptions = {},
): MentionFlowNode[] {
  const positions = layoutMentions(
    nodes.map((node) => ({ id: node.id, nodeLabel: node.data.nodeLabel })),
    edges,
  );
  const neighbours = new Set<string>();
  if (selectedId) {
    for (const edge of edges) {
      if (edge.source === selectedId) neighbours.add(edge.target);
      if (edge.target === selectedId) neighbours.add(edge.source);
    }
  }
  return nodes.map((node) => ({
    id: node.id,
    type: 'mention',
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    width: MENTION_NODE_W,
    height: MENTION_NODE_H,
    draggable,
    selectable: true,
    selected: node.id === selectedId,
    data: {
      label: node.data.label,
      nodeLabel: node.data.nodeLabel,
      neighbour: neighbours.has(node.id),
      onShowDetails,
    },
  }));
}

export function buildMentionFlowEdges(
  edges: Edge[],
  selectedId?: string | null,
): Edge[] {
  return edges.map((edge, index) => {
    const active =
      selectedId && (edge.source === selectedId || edge.target === selectedId);
    const color = active ? '#d97706' : EDGE_COLOR;
    return {
      id: `mention-${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      style: { stroke: color, strokeWidth: active ? 2 : 1 },
      markerEnd: edgeMarker(color, 1),
    };
  });
}

interface MentionFlowProps {
  nodes: MentionFlowNode[];
  edges: Edge[];
  onNodeClick?: (nodeId: string) => void;
  /** Click on empty canvas — clears the selection in ChatView. */
  onPaneClick?: () => void;
  nodesDraggable?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function MentionFlowInner({
  nodes,
  edges,
  onNodeClick,
  onPaneClick,
  nodesDraggable = false,
  className,
  children,
}: MentionFlowProps) {
  const { fitView } = useReactFlow();
  const idsKey = nodes.map((node) => node.id).join('|');
  useEffect(() => {
    fitView({ padding: 0.15, maxZoom: 1, duration: 200 });
  }, [idsKey, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
      minZoom={0.15}
      nodesDraggable={nodesDraggable}
      nodesConnectable={false}
      zoomOnScroll={true}
      zoomOnDoubleClick={false}
      panOnScroll={false}
      onNodeClick={(_, node) => onNodeClick?.(node.id)}
      onPaneClick={onPaneClick}
      className={className}
    >
      {children}
    </ReactFlow>
  );
}

/** Nested React Flow for mention graphs; refits when the node set changes. */
export function MentionFlow(props: MentionFlowProps) {
  return (
    <ReactFlowProvider>
      <MentionFlowInner {...props} />
    </ReactFlowProvider>
  );
}
