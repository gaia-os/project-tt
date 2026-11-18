'use client';

import React from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Check, Plus } from 'lucide-react';
import { NodeActions } from './NodeActions';
import { UiNode } from '@/lib/types';
import { NodeFoldState } from '@/lib/elkjs';

interface CustomNodeProps extends NodeProps {
  data: UiNode['data'];
  onShowDetails: (nodeId: string) => void;
  onShowConnected: (nodeId: string) => void;
  onShowCompanies?: (nodeId: string) => void;
  isCompaniesExpanded?: (nodeId: string) => boolean;
  onShowLiterature?: (nodeId: string) => void;
  isLiteratureExpanded?: (nodeId: string) => boolean;
  literatureCount?: number;
  /** Folds or unfolds the node's exclusive prerequisites. */
  onToggleFold?: (nodeId: string) => void;
  /** Building a custom tree: whether this node is in it (undefined otherwise). */
  inTree?: boolean;
  onToggleInTree?: (nodeId: string) => void;
}

export const CustomNode: React.FC<CustomNodeProps> = ({
  data,
  id,
  onShowDetails,
  onShowConnected,
  onShowCompanies,
  isCompaniesExpanded,
  onShowLiterature,
  isLiteratureExpanded,
  literatureCount,
  onToggleFold,
  inTree,
  onToggleInTree,
}) => {
  const fold = data.fold as NodeFoldState | undefined;
  // Determine color based on probability
  let statusColor = 'bg-transparent';
  let probabilityText = '';

  if (data.infact_analysis && data.infact_analysis.probability) {
    probabilityText = String(data.infact_analysis.probability);
    let probValue = parseFloat(probabilityText.replace(/[^0-9.]/g, ''));

    if (probValue > 0 && probValue <= 1 && !probabilityText.includes('%')) {
      probValue *= 100;
    }

    if (!isNaN(probValue)) {
      if (probValue < 20) statusColor = 'bg-red-600';
      else if (probValue < 40) statusColor = 'bg-red-400';
      else if (probValue < 60) statusColor = 'bg-yellow-400';
      else if (probValue < 80) statusColor = 'bg-green-400';
      else statusColor = 'bg-green-600';
    }
  }

  return (
    <div className="w-full h-full relative">
      {statusColor !== 'bg-transparent' && (
        <div
          className="tt-node-actions absolute bottom-14 left-0 transform -translate-x-1.5 -translate-y-1.5 z-10 pointer-events-auto cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onShowDetails(id);
          }}
          title={`InFact Confidence: ${probabilityText} — click to view details`}
        >
          <div
            className={`w-4 h-4 rounded-full border-2 border-white shadow-sm ${statusColor}`}
          />
        </div>
      )}

      <Handle
        type="target"
        position={Position.Left}
        className="opacity-0"
      />

      {/* Dedicated attachment point for literature overlay edges so they dock
          on the side facing the literature nodes without affecting tree edges. */}
      <Handle
        type="target"
        id="lit-target"
        position={Position.Right}
        className="opacity-0"
      />

      <div className="w-full h-full flex items-center justify-center text-center px-1 text-sm font-medium overflow-hidden">
        <span className="tt-node-label line-clamp-3 break-words" title={data.label}>
          {data.label}
        </span>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="opacity-0"
      />

      {fold && onToggleFold && (
        <FoldToggle nodeId={id} fold={fold} onToggle={onToggleFold} />
      )}

      {inTree !== undefined && onToggleInTree && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleInTree(id);
          }}
          aria-pressed={inTree}
          aria-label={`${inTree ? 'Remove' : 'Add'} ${data.label} ${inTree ? 'from' : 'to'} your tree`}
          title={inTree ? 'In your tree · click to remove' : 'Click to add to your tree'}
          className={`tt-tree-pick nodrag absolute -bottom-2.5 -right-2.5 z-10 inline-flex h-6 w-6 items-center justify-center rounded-full border-2 shadow-sm transition-[background-color,border-color,color,transform] duration-200 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1 ${
            inTree
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-300 bg-white text-gray-500 hover:border-blue-500 hover:text-blue-600'
          }`}
        >
          {inTree ? (
            <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
          ) : (
            <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
          )}
        </button>
      )}

      {/* Existing Buttons */}
      <div className="tt-node-actions absolute bottom-14 right-0 transform translate-x-2 -translate-y-2 z-10 pointer-events-auto">
        <NodeActions
          nodeId={id}
          onShowDetails={onShowDetails}
          onShowConnected={onShowConnected}
          onShowCompanies={onShowCompanies}
          companiesExpanded={isCompaniesExpanded?.(id)}
          onShowLiterature={onShowLiterature}
          literatureExpanded={isLiteratureExpanded?.(id)}
          literatureCount={literatureCount}
        />
      </div>
    </div>
  );
};

/**
 * Bottom-left toggle that tucks the node's prerequisite branch into it
 * ("−") or brings it back ("+N"). Prerequisites enter from the left, so the
 * control sits on the side the branch collapses towards.
 */
function FoldToggle({
  nodeId,
  fold,
  onToggle,
}: {
  nodeId: string;
  fold: NodeFoldState;
  onToggle: (nodeId: string) => void;
}) {
  const folded = fold.folded > 0;
  const count = folded ? fold.folded : fold.foldable;
  const noun = `prerequisite${count === 1 ? '' : 's'}`;
  const label = folded
    ? `Unfold ${count} ${noun}`
    : `Fold ${count} ${noun} only this node needs`;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onToggle(nodeId);
      }}
      title={label}
      aria-label={label}
      aria-pressed={folded}
      className={`tt-node-actions nodrag absolute -bottom-2.5 -left-2.5 z-10 inline-flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-semibold leading-none tabular-nums shadow-sm transition-[background-color,border-color,color,transform] duration-200 ease-out hover:scale-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        folded
          ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-700'
          : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50'
      }`}
    >
      {folded ? `+${count}` : '−'}
    </button>
  );
}
