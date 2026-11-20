'use client';

import { useMemo } from 'react';
import { Edge } from '@xyflow/react';
import { X } from 'lucide-react';
import { ChatMention, DataNode } from '@/lib/types';
import {
  MentionFlow,
  buildMentionFlowEdges,
  buildMentionFlowNodes,
} from './MentionFlow';

/*
 * Overlay on the tech-tree canvas: the entities bolded in the latest chat
 * answer that exist on this tree, drawn as a mini graph (see MentionFlow).
 *
 * `nowheel` stays off the flow itself (React Flow treats it as
 * "don't zoom here"); the canvas wheel hook leaves the nested flow alone,
 * so scrolling over the graph zooms the mini graph, not the background.
 */

interface ChatMentionsPanelProps {
  /** Tree nodes mentioned in the latest answer, in mention order. */
  nodes: DataNode[];
  /** Tree edges among `nodes` (see mentionEdges). */
  edges: Edge[];
  /** Resolved KG entities with no node on this tree. */
  unmatched: ChatMention[];
  /** Highlights the node and its neighbours on the main tree. */
  onSelect: (nodeId: string) => void;
  /** Opens the node's details panel (leaves the chat tab intentionally). */
  onShowDetails: (nodeId: string) => void;
  onClose: () => void;
}

export function ChatMentionsPanel({
  nodes,
  edges,
  unmatched,
  onSelect,
  onShowDetails,
  onClose,
}: ChatMentionsPanelProps) {
  const flowNodes = useMemo(
    () => buildMentionFlowNodes(nodes, edges, { onShowDetails }),
    [nodes, edges, onShowDetails],
  );
  const flowEdges = useMemo(() => buildMentionFlowEdges(edges), [edges]);

  return (
    <div className="absolute bottom-4 left-4 md:left-16 z-20 w-[26rem] max-w-[calc(100%-3rem)] overflow-hidden rounded-xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur">
      <div className="nowheel flex items-center justify-between border-b border-gray-100 px-3 py-2">
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

      <div className="h-72">
        <MentionFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodeClick={onSelect}
          className="bg-gray-50/50"
        />
      </div>

      {unmatched.length > 0 && (
        <div className="nowheel border-t border-gray-100 px-3 py-1.5 text-[10px] leading-snug text-gray-500">
          In the knowledge graph, not on this tree:{' '}
          {unmatched.map((mention) => mention.name).join(', ')}
        </div>
      )}

      <div className="nowheel px-3 py-1.5 text-[10px] text-gray-400">
        Click to highlight on the tree · ⓘ opens details.
      </div>
    </div>
  );
}
