'use client';

import { createContext, useContext } from 'react';
import { KgEntity } from '@/lib/types';
import { VoteCounts } from '@/lib/votes';

/**
 * Callbacks and lookups the tech tree's node components need. Passed through
 * context so `nodeTypes` can be a stable module-level object: an inline
 * object makes React Flow remount every node on each render.
 */
export interface TechTreeNodeActions {
  onShowDetails: (nodeId: string) => void;
  onShowConnected: (nodeId: string) => void;
  onShowCompanies: (nodeId: string) => void;
  isCompaniesExpanded: (nodeId: string) => boolean;
  /** Paper count for nodes with KG literature; undefined hides the button. */
  literatureFor: (nodeId: string) => { papers: number } | undefined;
  onShowLiterature: (nodeId: string) => void;
  isLiteratureExpanded: (nodeId: string) => boolean;
  onShowPaper: (entity: KgEntity) => void;
  votesFor: (entityId: string) => VoteCounts | undefined;
  onLitVote: (entityId: string, vote: 'up' | 'down' | null) => void;
  onShowCompanyDetails: (companyId: string) => void;
  onShowMoreCompanies: (parentNodeId: string) => void;
  /** Folds or unfolds a node's exclusive prerequisites. */
  onToggleFold: (nodeId: string) => void;
  /** Unfolds an aggregate into a frame of its members. */
  onExpandGroup: (groupKey: string, aggregateId: string) => void;
  /** Folds a frame back into its aggregate. */
  onCollapseGroup: (groupKey: string, frameId: string) => void;
  /** Present while a custom tree is being built; null otherwise. */
  builder: TreeBuilderActions | null;
}

/** Picking nodes for a custom tree straight on the canvas. */
export interface TreeBuilderActions {
  has: (nodeId: string) => boolean;
  /** How many of `nodeIds` are in the tree. */
  countOf: (nodeIds: string[]) => number;
  toggle: (nodeId: string) => void;
  /** Adds all of `nodeIds`, or removes them if all are already in. */
  toggleGroup: (nodeIds: string[]) => void;
}

/** Null outside the main tree (e.g. comparison previews): nodes go static. */
export const TechTreeNodeActionsContext =
  createContext<TechTreeNodeActions | null>(null);

export function useTechTreeNodeActions(): TechTreeNodeActions | null {
  return useContext(TechTreeNodeActionsContext);
}
