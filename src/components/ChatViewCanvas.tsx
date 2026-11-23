'use client';

import { useMemo, useState } from 'react';
import { Background, Controls, Edge } from '@xyflow/react';
import { ChatMention, DataNode } from '@/lib/types';
import {
  MentionFlow,
  buildMentionFlowEdges,
  buildMentionFlowNodes,
} from './MentionFlow';

/*
 * ChatView's canvas: the entities mentioned in a chat answer, drawn as a
 * graph over the whole left pane. Clicking a node selects it, lights its
 * direct neighbours and opens the details tab on the right.
 */

interface ChatViewCanvasProps {
  /** Tree nodes mentioned in the answer, in mention order. */
  nodes: DataNode[];
  /** Tree edges among `nodes` (see mentionEdges). */
  edges: Edge[];
  /** Resolved KG entities with no node on this tree. */
  unmatched: ChatMention[];
  /** Also highlights the node on the underlying tree. */
  onSelect?: (nodeId: string) => void;
  onShowDetails: (nodeId: string) => void;
}

export function ChatViewCanvas({
  nodes,
  edges,
  unmatched,
  onSelect,
  onShowDetails,
}: ChatViewCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const flowNodes = useMemo(
    () =>
      buildMentionFlowNodes(nodes, edges, {
        onShowDetails,
        selectedId,
        draggable: true,
      }),
    [nodes, edges, onShowDetails, selectedId],
  );
  const flowEdges = useMemo(
    () => buildMentionFlowEdges(edges, selectedId),
    [edges, selectedId],
  );

  if (nodes.length === 0) {
    return (
      <div className="nowheel flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-50 px-8 text-center">
        <div className="text-sm font-medium text-gray-600">
          Nothing to graph yet
        </div>
        <div className="max-w-md text-xs leading-relaxed text-gray-500">
          Ask the assistant about technologies, designs or organisations —
          entities it names that exist on this tree are drawn here. The &ldquo;N
          on tree&rdquo; chip under an older answer replays its graph.
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MentionFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodesDraggable
        onNodeClick={(nodeId) => {
          setSelectedId(nodeId);
          onSelect?.(nodeId);
          onShowDetails(nodeId);
        }}
        onPaneClick={() => setSelectedId(null)}
        className="bg-gray-50"
      >
        <Background gap={20} size={1} color="#e5e7eb" />
        <Controls showInteractive={false} position="bottom-right" />
      </MentionFlow>

      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm">
        In this answer · {nodes.length} node{nodes.length === 1 ? '' : 's'}
      </div>

      {unmatched.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-md rounded-lg border border-gray-200 bg-white/95 px-3 py-1.5 text-[10px] leading-snug text-gray-500 shadow-sm">
          In the knowledge graph, not on this tree:{' '}
          {unmatched.map((mention) => mention.name).join(', ')}
        </div>
      )}
    </div>
  );
}
