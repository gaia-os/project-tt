'use client';

import React, { type Ref, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Eraser,
  MessageSquare,
  ScanSearch,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MAX_TREE_NAME_LENGTH, MAX_TREE_NOTES_LENGTH } from '@/lib/customTrees';
import { TreeDraft } from '@/hooks/useTreeBuilder';

interface TreeBuilderPanelProps {
  containerRef?: Ref<HTMLElement>;
  draft: TreeDraft;
  linkCount: number;
  /** Prerequisites / dependents of the selection not yet in it. */
  prerequisiteCount: number;
  dependentCount: number;
  /** Nodes on the canvas (after filters) not yet in the selection. */
  visibleCount: number;
  onNameChange: (name: string) => void;
  onNotesChange: (notes: string) => void;
  onAddPrerequisites: () => void;
  onAddDependents: () => void;
  onAddVisible: () => void;
  onClear: () => void;
  onSave: () => void;
  /** Editing a saved tree: keep it and save the result separately. */
  onSaveAsNew?: () => void;
  onAskAssistant: () => void;
  onCancel: () => void;
}

/**
 * Floating card for building a custom tree on the canvas: what is picked,
 * shortcuts to grow the selection, a name and notes, and save.
 */
export function TreeBuilderPanel({
  containerRef,
  draft,
  linkCount,
  prerequisiteCount,
  dependentCount,
  visibleCount,
  onNameChange,
  onNotesChange,
  onAddPrerequisites,
  onAddDependents,
  onAddVisible,
  onClear,
  onSave,
  onSaveAsNew,
  onAskAssistant,
  onCancel,
}: TreeBuilderPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const count = draft.ids.size;
  const editing = draft.editingId !== null;
  const summary = `${count} node${count === 1 ? '' : 's'} · ${linkCount} link${
    linkCount === 1 ? '' : 's'
  }`;
  const canSave = count > 0;

  if (collapsed) {
    return (
      <section
        ref={containerRef}
        aria-label="Tree builder"
        className="absolute bottom-16 left-14 right-4 z-20 mx-auto flex max-w-[40rem] items-center justify-between gap-3 rounded-xl border border-blue-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex min-w-0 items-center gap-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-expanded={false}
        >
          <ChevronUp className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
          <span className="truncate">
            <span className="font-medium text-gray-900">
              {draft.name.trim() || (editing ? 'Editing tree' : 'New tree')}
            </span>
            <span className="text-gray-500"> · {summary}</span>
          </span>
        </button>
        <Button size="sm" onClick={onSave} disabled={!canSave}>
          {editing ? 'Save changes' : 'Save tree'}
        </Button>
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      aria-label="Tree builder"
      className="absolute bottom-16 left-14 right-4 z-20 mx-auto flex max-h-[55%] max-w-[40rem] flex-col rounded-xl border border-blue-200 bg-white/95 shadow-xl backdrop-blur"
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
            {editing ? 'Editing your tree' : 'Building your own tree'}
          </p>
          <p className="text-xs text-gray-600">
            Click nodes or groups to add or remove them · Shift+drag to pick an area
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Collapse the tree builder"
            aria-expanded
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Stop building without saving"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      <div className="space-y-3 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="mr-1 text-sm font-semibold tabular-nums text-gray-900"
            aria-live="polite"
          >
            {summary}
          </span>
          <GrowButton
            icon={<ArrowUpToLine aria-hidden />}
            label="Prerequisites"
            count={prerequisiteCount}
            title="Add everything the picked nodes depend on"
            onClick={onAddPrerequisites}
          />
          <GrowButton
            icon={<ArrowDownToLine aria-hidden />}
            label="Dependents"
            count={dependentCount}
            title="Add everything the picked nodes unlock"
            onClick={onAddDependents}
          />
          <GrowButton
            icon={<ScanSearch aria-hidden />}
            label="Visible"
            count={visibleCount}
            title="Add every node the current search and filters show"
            onClick={onAddVisible}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            onClick={onClear}
            disabled={count === 0}
            aria-label="Clear the selection"
            title="Clear the selection"
          >
            <Eraser aria-hidden />
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <label className="space-y-1 text-xs font-medium text-gray-700">
            Name
            <input
              value={draft.name}
              onChange={(event) => onNameChange(event.target.value)}
              maxLength={MAX_TREE_NAME_LENGTH}
              placeholder="e.g. Ammonia co-firing path"
              className="block h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm font-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-gray-700">
            Notes <span className="font-normal text-gray-500">(the assistant sees these)</span>
            <textarea
              value={draft.notes}
              onChange={(event) => onNotesChange(event.target.value)}
              maxLength={MAX_TREE_NOTES_LENGTH}
              rows={1}
              placeholder="What do you want to find out?"
              className="block min-h-9 w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onAskAssistant} disabled={count === 0}>
          <MessageSquare aria-hidden />
          Ask about this selection
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          {editing && onSaveAsNew && (
            <Button variant="outline" size="sm" onClick={onSaveAsNew} disabled={!canSave}>
              Save as new
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={!canSave}>
            {editing ? 'Save changes' : 'Save tree'}
          </Button>
        </div>
      </footer>
    </section>
  );
}

function GrowButton({
  icon,
  label,
  count,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  title: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1 px-2 text-xs"
      onClick={onClick}
      disabled={count === 0}
      title={title}
      aria-label={`${title}${count ? ` (${count})` : ''}`}
    >
      {icon}
      {label}
      <span className="min-w-[2.25rem] text-left tabular-nums text-gray-500">
        {count ? `+${count}` : ''}
      </span>
    </Button>
  );
}
