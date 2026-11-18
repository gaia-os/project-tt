'use client';

import React from 'react';
import { NODE_LABELS, GroupingMode, NodeLabel, UiNode } from '@/lib/types';
import { nodeRoleLabel } from '@/lib/nodeRoles';
import {
  AGGREGATION_MODES,
  AGGREGATION_MODE_LABELS,
  AggregationMode,
} from '@/lib/treeProjection';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Menu,
  Eye,
  Compass,
  X,
  Columns3,
  FolderTree,
  Pencil,
  MessageSquare,
  BookmarkPlus,
} from 'lucide-react';

interface GroupSelectorProps {
  currentMode: GroupingMode;
  onModeChange: (mode: GroupingMode) => void;
  selectedNode?: UiNode;
  showingConnectedNodes: boolean;
  /** A guided pathway replaces the filters with an exit control. */
  pathwayActive?: boolean;
  onExitPathway?: () => void;
  /** Opens the technology picker. */
  onChooseTechnology?: () => void;
  onReset: () => void;
  searchInput: string;
  onSearchChange: (value: string) => void;
  onEnterEditMode: () => void;
  onOpenReview?: () => void;
  isEditing: boolean;
  hasLiterature?: boolean;
  litViewMode?: 'overview' | 'focused';
  onLitViewModeChange?: (mode: 'overview' | 'focused') => void;
  showLitEdgeLabels?: boolean;
  onToggleLitEdgeLabels?: (show: boolean) => void;
  showLegend: boolean;
  showOptions: boolean;
  onToggleLegend: () => void;
  onToggleOptions: () => void;
  selectedCategory: string;
  categories: string[];
  onCategoryChange: (category: string) => void;
  /** SMR-style trees: minimum technology decision relevance (0 = show all). */
  minRelevance?: number;
  onMinRelevanceChange?: (value: number) => void;
  visibleNodeCount?: number;
  sourceBackedOnly?: boolean;
  onSourceBackedOnlyChange?: (value: boolean) => void;
  /** Draw groups of nodes as single aggregate nodes. */
  aggregationMode?: AggregationMode;
  onAggregationModeChange?: (mode: AggregationMode) => void;
  /** Groups in the current aggregation, and how many are unfolded. */
  groupCount?: number;
  expandedGroupCount?: number;
  onUnfoldAllGroups?: () => void;
  onFoldAllGroups?: () => void;
  /** Nodes whose prerequisite branch is folded into them. */
  foldedBranchCount?: number;
  onUnfoldAllBranches?: () => void;
  onCompareTrees?: () => void;
  /** Custom trees kept in this browser. */
  onOpenMyTrees?: () => void;
  myTreeCount?: number;
  /** The custom tree on the canvas, if any. */
  activeTree?: { name: string; nodeCount: number; missingCount: number } | null;
  onEditActiveTree?: () => void;
  onChatActiveTree?: () => void;
  onCloseActiveTree?: () => void;
  /** Keep what the current search/filters show as a custom tree. */
  onSaveView?: () => void;
  /** Keep the connected-nodes view as a custom tree. */
  onSaveConnected?: () => void;
  /** A custom tree is being built: only the finding tools are shown. */
  isBuilding?: boolean;
}

const RELEVANCE_LABELS: Record<number, string> = {
  0: 'all',
  1: 'rel ≥ 1',
  2: 'rel ≥ 2',
  3: 'rel ≥ 3',
  4: 'rel ≥ 4',
  5: 'rel 5',
};

export const GroupSelector: React.FC<GroupSelectorProps> = ({
  currentMode,
  onModeChange,
  selectedNode,
  showingConnectedNodes,
  pathwayActive = false,
  onExitPathway,
  onChooseTechnology,
  onReset,
  searchInput,
  onSearchChange,
  onEnterEditMode,
  onOpenReview,
  isEditing,
  hasLiterature,
  litViewMode,
  onLitViewModeChange,
  showLitEdgeLabels,
  onToggleLitEdgeLabels,
  showLegend,
  showOptions,
  onToggleLegend,
  onToggleOptions,
  selectedCategory,
  categories,
  onCategoryChange,
  minRelevance,
  onMinRelevanceChange,
  visibleNodeCount,
  sourceBackedOnly,
  onSourceBackedOnlyChange,
  aggregationMode,
  onAggregationModeChange,
  groupCount,
  expandedGroupCount = 0,
  onUnfoldAllGroups,
  onFoldAllGroups,
  foldedBranchCount = 0,
  onUnfoldAllBranches,
  onCompareTrees,
  onOpenMyTrees,
  myTreeCount = 0,
  activeTree = null,
  onEditActiveTree,
  onChatActiveTree,
  onCloseActiveTree,
  onSaveView,
  onSaveConnected,
  isBuilding = false,
}) => {
  const groupingOptions: GroupingMode[] = ['None', ...NODE_LABELS];

  const formatOptionLabel = (option: GroupingMode): string => {
    if (option === 'None') return 'No grouping';
    return nodeRoleLabel(option as NodeLabel);
  };

  const shouldShowReset = showingConnectedNodes;

  return (
    <div className="absolute top-4 left-4 md:left-auto md:right-4 z-10">
      {pathwayActive ? (
        <div className="flex flex-col gap-2 p-3 bg-white border border-gray-200 rounded-lg shadow-sm bg-opacity-90">
          <Button variant="outline" size="sm" onClick={onExitPathway}>
            <X aria-hidden />
            Exit pathway
          </Button>
          {onChooseTechnology && (
            <Button variant="ghost" size="sm" onClick={onChooseTechnology}>
              <Compass aria-hidden />
              Choose another
            </Button>
          )}
        </div>
      ) : shouldShowReset ? (
        <div className="flex flex-col gap-2 p-3 bg-white border border-gray-200 rounded-lg shadow-sm bg-opacity-80">
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset to Show All Nodes
          </Button>
          {onSaveConnected && !isBuilding && (
            <Button variant="ghost" size="sm" onClick={onSaveConnected}>
              <BookmarkPlus aria-hidden />
              Save as my tree
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Mobile: Show toggle buttons */}
          <div className="md:hidden flex gap-2 mb-2">
            <Button
              variant={showLegend ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleLegend}
              className="flex items-center gap-2"
            >
              <Eye size={16} />
              Show Legend
            </Button>
            <Button
              variant={showOptions ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleOptions}
              className="flex items-center gap-2"
            >
              <Menu size={16} />
              More Options
            </Button>
          </div>

          {/* Desktop: Always show, Mobile: Show based on toggle */}
          <div className={`p-3 bg-white border border-gray-200 rounded-lg shadow-sm bg-opacity-80 space-y-3 ${
            showOptions ? 'block' : 'hidden md:block'
          }`}>
            {activeTree && !isBuilding && (
              <div className="rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                      My tree
                    </p>
                    <p className="truncate text-sm font-semibold text-gray-900" title={activeTree.name}>
                      {activeTree.name}
                    </p>
                    <p className="text-[11px] tabular-nums text-gray-600">
                      {activeTree.nodeCount} node{activeTree.nodeCount === 1 ? '' : 's'}
                      {activeTree.missingCount
                        ? ` · ${activeTree.missingCount} no longer in the data`
                        : ''}
                    </p>
                  </div>
                  {onCloseActiveTree && (
                    <button
                      type="button"
                      onClick={onCloseActiveTree}
                      className="rounded p-0.5 text-gray-500 hover:bg-blue-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Close my tree and show the whole tree"
                      title="Show the whole tree"
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  )}
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  {onEditActiveTree && (
                    <Button variant="outline" size="sm" className="h-7 bg-white px-2 text-xs" onClick={onEditActiveTree}>
                      <Pencil aria-hidden />
                      Edit nodes
                    </Button>
                  )}
                  {onChatActiveTree && (
                    <Button variant="outline" size="sm" className="h-7 bg-white px-2 text-xs" onClick={onChatActiveTree}>
                      <MessageSquare aria-hidden />
                      Chat about it
                    </Button>
                  )}
                </div>
              </div>
            )}
            {isBuilding && (
              <p className="max-w-[18rem] rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Use search and filters to find nodes, then click them to add
                them to your tree.
              </p>
            )}
            {onChooseTechnology && !isBuilding && (
              <Button size="sm" onClick={onChooseTechnology} className="w-full">
                <Compass aria-hidden />
                Choose a technology to follow
              </Button>
            )}
            {!isBuilding && (onOpenMyTrees || onCompareTrees) && (
              <div className="grid grid-cols-2 gap-2">
                {onOpenMyTrees && (
                  <Button variant="outline" size="sm" onClick={onOpenMyTrees}>
                    <FolderTree aria-hidden />
                    My trees{myTreeCount ? ` (${myTreeCount})` : ''}
                  </Button>
                )}
                {onCompareTrees && (
                  <Button variant="outline" size="sm" onClick={onCompareTrees}>
                    <Columns3 aria-hidden />
                    Compare
                  </Button>
                )}
              </div>
            )}

            {/* Search Input */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="search-input"
                className="text-sm font-medium text-gray-700 whitespace-nowrap"
              >
                Search:
              </label>
              <div className="flex items-center">
                <input
                  id="search-input"
                  type="text"
                  placeholder="Search nodes..."
                  value={searchInput}
                  onChange={(e) => onSearchChange(e.target.value)}
                  className="w-48 px-3 py-1.5 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
                {searchInput && (
                  <button
                    onClick={() => onSearchChange('')}
                    className="ml-2 px-2 py-1 text-xs bg-gray-200 hover:bg-gray-300 rounded text-gray-600"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            {onSaveView && !isBuilding && (
              <div className="-mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={onSaveView}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <BookmarkPlus className="h-3.5 w-3.5" aria-hidden />
                  Save this view as my tree
                </button>
              </div>
            )}

            {/* Category Filter */}
            {categories.length > 1 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="category-filter"
                  className="text-sm font-medium text-gray-700 whitespace-nowrap"
                >
                  Category:
                </label>
                <Select value={selectedCategory} onValueChange={onCategoryChange}>
                  <SelectTrigger className="w-48" id="category-filter">
                    <SelectValue placeholder="All Categories" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Detail level (technology decision relevance) */}
            {minRelevance !== undefined && onMinRelevanceChange && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="relevance-filter"
                    className="text-sm font-medium text-gray-700 whitespace-nowrap"
                    title="Minimum decision relevance (1-5) of technologies shown. Drag right for more detail. Reactors are always shown."
                  >
                    Detail:
                  </label>
                  <input
                    id="relevance-filter"
                    type="range"
                    min={0}
                    max={5}
                    step={1}
                    value={5 - minRelevance}
                    onChange={(e) => onMinRelevanceChange(5 - Number(e.target.value))}
                    className="w-28 accent-blue-600"
                    aria-valuetext={RELEVANCE_LABELS[minRelevance]}
                  />
                  <span className="w-14 text-xs text-gray-600 tabular-nums">
                    {RELEVANCE_LABELS[minRelevance]}
                  </span>
                </div>
                {visibleNodeCount !== undefined && (
                  <p className="text-[11px] text-gray-500 text-right">
                    {visibleNodeCount} nodes{minRelevance <= 2 ? ' — layout may be slow' : ''}
                  </p>
                )}
                {onSourceBackedOnlyChange && (
                  <label
                    className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap"
                    title="Hide relations that are only LLM-inferred"
                  >
                    <input
                      type="checkbox"
                      checked={!!sourceBackedOnly}
                      onChange={(e) => onSourceBackedOnlyChange(e.target.checked)}
                    />
                    source/literature-backed relations only
                  </label>
                )}
              </div>
            )}

            {/* Group By Selector */}
            <div className="flex items-center gap-2">
              <label
                htmlFor="group-selector"
                className="text-sm font-medium text-gray-700 whitespace-nowrap"
              >
                Group By:
              </label>
              <Select value={currentMode} onValueChange={onModeChange}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select grouping mode" />
                </SelectTrigger>
                <SelectContent>
                  {groupingOptions.map((option) => (
                    <SelectItem key={option} value={option}>
                      {formatOptionLabel(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Aggregation: scale the tree down to one node per group */}
            {aggregationMode && onAggregationModeChange && (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="aggregate-mode"
                    className="text-sm font-medium text-gray-700 whitespace-nowrap"
                    title="Draw each group of nodes as one aggregate node. Click an aggregate to unfold it."
                  >
                    Aggregate:
                  </label>
                  <Select
                    value={aggregationMode}
                    onValueChange={(value) =>
                      onAggregationModeChange(value as AggregationMode)
                    }
                  >
                    <SelectTrigger className="w-48" id="aggregate-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGGREGATION_MODES.map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {AGGREGATION_MODE_LABELS[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {aggregationMode !== 'none' && groupCount !== undefined && (
                  <div className="flex items-center justify-end gap-2 text-[11px] text-gray-500">
                    <span className="tabular-nums">
                      {expandedGroupCount} of {groupCount} unfolded
                    </span>
                    <button
                      type="button"
                      onClick={onUnfoldAllGroups}
                      disabled={expandedGroupCount >= groupCount}
                      className="font-medium text-gray-700 underline-offset-2 hover:underline disabled:text-gray-300 disabled:no-underline"
                    >
                      Unfold all
                    </button>
                    <button
                      type="button"
                      onClick={onFoldAllGroups}
                      disabled={expandedGroupCount === 0}
                      className="font-medium text-gray-700 underline-offset-2 hover:underline disabled:text-gray-300 disabled:no-underline"
                    >
                      Fold all
                    </button>
                  </div>
                )}
                {foldedBranchCount > 0 && onUnfoldAllBranches && (
                  <div className="flex items-center justify-end gap-2 text-[11px] text-gray-500">
                    <span className="tabular-nums">
                      {foldedBranchCount} folded branch
                      {foldedBranchCount === 1 ? '' : 'es'}
                    </span>
                    <button
                      type="button"
                      onClick={onUnfoldAllBranches}
                      className="font-medium text-gray-700 underline-offset-2 hover:underline"
                    >
                      Unfold
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Literature view mode — only when KG enrichment exists */}
            {hasLiterature && litViewMode && onLitViewModeChange && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="lit-view-mode"
                  className="text-sm font-medium text-gray-700 whitespace-nowrap"
                >
                  Literature:
                </label>
                <Select value={litViewMode} onValueChange={onLitViewModeChange}>
                  <SelectTrigger className="w-48" id="lit-view-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="overview">Overview</SelectItem>
                    <SelectItem value="focused">Focused</SelectItem>
                  </SelectContent>
                </Select>
                {onToggleLitEdgeLabels && (
                  <label className="flex items-center gap-1.5 text-xs text-gray-600 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={!!showLitEdgeLabels}
                      onChange={(e) => onToggleLitEdgeLabels(e.target.checked)}
                    />
                    edge labels
                  </label>
                )}
              </div>
            )}

            {/* Edit Graph Button - Hidden on mobile */}
            {!isEditing && !isBuilding && (
              <div className="pt-2 border-t border-gray-200 hidden md:block space-y-2">
                <Button
                  variant="outline"
                  size="default"
                  onClick={onEnterEditMode}
                  className="w-full"
                >
                  Edit Tree
                </Button>
                {onOpenReview && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={onOpenReview}
                    className="w-full"
                  >
                    Review Literature
                  </Button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};