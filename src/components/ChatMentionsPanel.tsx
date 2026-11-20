'use client';

import { useMemo } from 'react';
import {
  Edge,
  Handle,
  Node,
  NodeProps,
  NodeTypes,
  Position,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { X } from 'lucide-react';
import { ChatMention, DataNode } from '@/lib/types';
import { edgeMarker, roleColor } from '@/lib/elkjs';
import { nodeRoleLabel } from '@/lib/nodeRoles';

/*
 * Overlay on the tech-tree canvas: the entities bolded in the latest chat
 * answer that exist on this tree, drawn as a mini graph. Edges are the
 * tree's own prerequisite links between the mentioned nodes, laid out
 * left-to-right by longest-path depth like the main layout.
 */

const NODE_W = 176;
const NODE_H = 56;
const GAP_X = 64;
const GAP_Y = 20;
const EDGE_COLOR = '#374151';

type MentionFlowNode = Node<{ label: string; nodeLabel?: string }>;

function MentionNode({ data }: NodeProps<MentionFlowNode>) {
  return (
    <div
      className="w-full h-full rounded-md border bg-white px-2.5 py-1.5 text-left shadow-sm"
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
    </div>
  );
}

const NODE_TYPES: NodeTypes = { mention: MentionNode };

/** x = longest-path depth over the induced edges, y = mention order per depth. */
function layoutMentions(
  ids: string[],
  edges: Edge[],
): Map<string, { x: number; y: number }> {
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

  const perLevel = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of ids) {
    const level = depth.get(id) ?? 0;
    const row = perLevel.get(level) ?? 0;
    perLevel.set(level, row + 1);
    positions.set(id, {
      x: level * (NODE_W + GAP_X),
      y: row * (NODE_H + GAP_Y),
    });
  }
  return positions;
}

interface ChatMentionsPanelProps {
  /** Tree nodes mentioned in the latest answer, in mention order. */
  nodes: DataNode[];
  /** Tree edges among `nodes` (see mentionEdges). */
  edges: Edge[];
  /** Resolved KG entities with no node on this tree. */
  unmatched: ChatMention[];
  onSelect: (nodeId: string) => void;
  onClose: () => void;
}

export function ChatMentionsPanel({
  nodes,
  edges,
  unmatched,
  onSelect,
  onClose,
}: ChatMentionsPanelProps) {
  const flowNodes = useMemo<MentionFlowNode[]>(() => {
    const positions = layoutMentions(
      nodes.map((node) => node.id),
      edges,
    );
    return nodes.map((node) => ({
      id: node.id,
      type: 'mention',
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      width: NODE_W,
      height: NODE_H,
      draggable: false,
      selectable: false,
      data: {
        label: node.data.label,
        nodeLabel: node.data.nodeLabel,
      },
    }));
  }, [nodes, edges]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge, index) => ({
        id: `mention-${edge.source}-${edge.target}-${index}`,
        source: edge.source,
        target: edge.target,
        style: { stroke: EDGE_COLOR, strokeWidth: 1 },
        markerEnd: edgeMarker(EDGE_COLOR, 1),
      })),
    [edges],
  );

  return (
    <div className="absolute bottom-4 left-4 md:left-16 z-20 w-[19rem] overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div className="text-xs font-semibold text-gray-700">
          In this answer · {nodes.length} node{nodes.length === 1 ? '' : 's'}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close mentions panel"
          className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        >
          <X size={14} />
        </button>
      </div>

      <div className="h-52">
        <ReactFlowProvider>
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
            minZoom={0.15}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            zoomOnScroll={false}
            panOnScroll={false}
            onNodeClick={(_, node) => onSelect(node.id)}
            className="bg-gray-50/50"
          />
        </ReactFlowProvider>
      </div>

      {unmatched.length > 0 && (
        <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] leading-snug text-gray-500">
          In the knowledge graph, not on this tree:{' '}
          {unmatched.map((mention) => mention.name).join(', ')}
        </div>
      )}

      <div className="px-3 py-1.5 text-[10px] text-gray-400">
        Click a node to highlight it on the tree.
      </div>
    </div>
  );
}
