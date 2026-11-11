'use client';

import React from 'react';
import { NODE_LABELS, GroupingMode, UiNode } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Menu, Eye } from 'lucide-react';

interface GroupSelectorProps {
  currentMode: GroupingMode;
  onModeChange: (mode: GroupingMode) => void;
  selectedNode?: UiNode;
  showingConnectedNodes: boolean;
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
}) => {
  const groupingOptions: GroupingMode[] = ['None', ...NODE_LABELS];

  const formatOptionLabel = (option: GroupingMode): string => {
    if (option === 'None') return 'No Grouping';
    return `${option}`;
  };

  const shouldShowReset = showingConnectedNodes;

  return (
    <div className="absolute top-4 left-4 md:left-auto md:right-4 z-10">
      {shouldShowReset ? (
        <div className="p-3 bg-white border border-gray-200 rounded-lg shadow-sm bg-opacity-80">
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset to Show All Nodes
          </Button>
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
            {!isEditing && (
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