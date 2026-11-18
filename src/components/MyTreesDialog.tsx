'use client';

import React, { useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Columns3,
  Copy,
  Download,
  FolderOpen,
  MessageSquare,
  Pencil,
  Plus,
  ScanSearch,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { labelForTopic, TopicKey } from '@/lib/topicConfig';
import { useTopics } from '@/hooks/useTopics';
import { CustomTree, MAX_TREE_NAME_LENGTH, exportTrees } from '@/lib/customTrees';
import { customThreadKey } from '@/lib/chatContext';
import { deleteThread } from '@/lib/chatThreadStorage';
import { customTreeStore, useCustomTrees } from '@/hooks/useCustomTrees';
import { peekTechTree } from '@/hooks/useTechTree';
import {
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface MyTreesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTopic: TopicKey;
  activeTreeId: string | null;
  /** Nodes the canvas shows now, for "New from current view". */
  viewNodeCount: number;
  onOpenTree: (tree: CustomTree) => void;
  onEditTree: (tree: CustomTree) => void;
  onChatTree: (tree: CustomTree) => void;
  onCompareTree: (tree: CustomTree) => void;
  onNewTree: () => void;
  onNewFromView: () => void;
  onTreeDeleted: (tree: CustomTree) => void;
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Every custom tree in this browser, grouped by topic, with its actions. */
export function MyTreesDialog({
  open,
  onOpenChange,
  currentTopic,
  activeTreeId,
  viewNodeCount,
  onOpenTree,
  onEditTree,
  onChatTree,
  onCompareTree,
  onNewTree,
  onNewFromView,
  onTreeDeleted,
}: MyTreesDialogProps) {
  const trees = useCustomTrees();
  const { topics: allTopics } = useTopics();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Current topic first, then the others in their usual order.
  const groups = useMemo(() => {
    const topics = [
      currentTopic,
      ...allTopics
        .map((entry) => entry.id)
        .filter((topic) => topic !== currentTopic),
    ];
    return topics
      .map((topic) => ({ topic, trees: trees.filter((tree) => tree.topic === topic) }))
      .filter((group) => group.trees.length > 0);
  }, [trees, currentTopic, allTopics]);

  const missingCount = (tree: CustomTree): number | null => {
    const base = peekTechTree(tree.topic);
    if (!base) return null;
    const present = new Set(base.nodes.map((node) => node.id));
    return tree.nodeIds.filter((id) => !present.has(id)).length;
  };

  const handleExport = () => {
    const blob = new Blob([exportTrees(trees)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `my-tech-trees-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage('That file is too large to be a tree export.');
      return;
    }
    const result = customTreeStore.importJson(await file.text());
    setMessage(
      result.ok
        ? `Imported ${result.imported.length} tree${result.imported.length === 1 ? '' : 's'}` +
            (result.skipped ? `; ${result.skipped} unreadable entr${result.skipped === 1 ? 'y' : 'ies'} skipped.` : '.')
        : result.error,
    );
  };

  const handleDelete = (tree: CustomTree) => {
    customTreeStore.remove(tree.id);
    deleteThread(customThreadKey(tree.id));
    setConfirmDeleteId(null);
    onTreeDeleted(tree);
  };

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setRenamingId(null);
          setConfirmDeleteId(null);
          setMessage(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[80]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[81] flex max-h-[min(44rem,calc(100%-2rem))] w-[min(46rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none">
          <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
            <div className="space-y-1">
              <DialogTitle className="text-lg font-semibold text-gray-900">My trees</DialogTitle>
              <DialogDescription className="text-sm text-gray-600">
                Your own subsets of the tech trees, kept in this browser. Open
                one to explore it, compare it, or talk about it with the
                assistant.
              </DialogDescription>
            </div>
            <DialogPrimitive.Close
              className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="Close my trees"
            >
              <X className="h-5 w-5" aria-hidden />
            </DialogPrimitive.Close>
          </header>

          <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-5 py-3">
            <Button size="sm" onClick={onNewTree}>
              <Plus aria-hidden />
              New tree
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={onNewFromView}
              disabled={viewNodeCount === 0}
              title="Start from the nodes the canvas shows now"
            >
              <ScanSearch aria-hidden />
              From current view ({viewNodeCount})
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleExport} disabled={!trees.length}>
                <Download aria-hidden />
                Export
              </Button>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload aria-hidden />
                Import
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={handleImport}
              />
            </div>
          </div>

          {message && (
            <p role="status" className="border-b border-gray-100 bg-gray-50 px-5 py-2 text-sm text-gray-700">
              {message}
            </p>
          )}

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {groups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 px-6 py-10 text-center">
                <p className="text-sm font-medium text-gray-900">No trees yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-600">
                  Start a new tree and click nodes on the canvas, or save a
                  pathway, a connected view or a search as a tree.
                </p>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.topic} className="mb-5 last:mb-0">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    {labelForTopic(allTopics, group.topic)}
                  </h3>
                  <ul className="space-y-2">
                    {group.trees.map((tree) => (
                      <TreeRow
                        key={tree.id}
                        tree={tree}
                        isActive={tree.id === activeTreeId}
                        missing={missingCount(tree)}
                        isRenaming={renamingId === tree.id}
                        isConfirmingDelete={confirmDeleteId === tree.id}
                        onStartRename={() => setRenamingId(tree.id)}
                        onRename={(name) => {
                          customTreeStore.update(tree.id, { name });
                          setRenamingId(null);
                        }}
                        onCancelRename={() => setRenamingId(null)}
                        onOpen={() => onOpenTree(tree)}
                        onEdit={() => onEditTree(tree)}
                        onChat={() => onChatTree(tree)}
                        onCompare={() => onCompareTree(tree)}
                        onDuplicate={() => {
                          const copy = customTreeStore.duplicate(tree.id);
                          if (copy) setMessage(`Made “${copy.name}”.`);
                        }}
                        onAskDelete={() => setConfirmDeleteId(tree.id)}
                        onCancelDelete={() => setConfirmDeleteId(null)}
                        onDelete={() => handleDelete(tree)}
                      />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

interface TreeRowProps {
  tree: CustomTree;
  isActive: boolean;
  missing: number | null;
  isRenaming: boolean;
  isConfirmingDelete: boolean;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onChat: () => void;
  onCompare: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}

function TreeRow({
  tree,
  isActive,
  missing,
  isRenaming,
  isConfirmingDelete,
  onStartRename,
  onRename,
  onCancelRename,
  onOpen,
  onEdit,
  onChat,
  onCompare,
  onDuplicate,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: TreeRowProps) {
  const [draftName, setDraftName] = useState(tree.name);
  const count = tree.nodeIds.length - (missing ?? 0);

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        isActive ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {isRenaming ? (
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                onRename(draftName);
              }}
            >
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                maxLength={MAX_TREE_NAME_LENGTH}
                autoFocus
                aria-label="Tree name"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    onCancelRename();
                  }
                }}
                className="h-8 min-w-0 flex-1 rounded-md border border-gray-300 px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <Button type="submit" size="sm">
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onCancelRename}>
                Cancel
              </Button>
            </form>
          ) : (
            <p className="flex items-center gap-2 truncate text-sm font-semibold text-gray-900">
              <span className="truncate">{tree.name}</span>
              {isActive && (
                <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                  Open
                </span>
              )}
            </p>
          )}
          <p className="mt-0.5 text-xs tabular-nums text-gray-500">
            {count} node{count === 1 ? '' : 's'}
            {missing ? ` · ${missing} no longer in the data` : ''}
            {tree.origin.label ? ` · from ${tree.origin.label}` : ''} · updated{' '}
            {dateFormat.format(tree.updatedAt)}
          </p>
          {tree.notes && (
            <p className="mt-1 line-clamp-2 text-xs text-gray-600">{tree.notes}</p>
          )}
        </div>
        <Button size="sm" variant={isActive ? 'outline' : 'default'} onClick={onOpen}>
          <FolderOpen aria-hidden />
          Open
        </Button>
      </div>

      {isConfirmingDelete ? (
        <div className="mt-2 flex items-center justify-end gap-2 text-sm" role="alert">
          <span className="text-gray-700">Delete “{tree.name}” and its chat?</span>
          <Button variant="outline" size="sm" onClick={onCancelDelete}>
            Keep
          </Button>
          <Button variant="destructive" size="sm" onClick={onDelete}>
            Delete
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <RowAction icon={<Pencil />} label="Edit nodes" onClick={onEdit} />
          <RowAction icon={<MessageSquare />} label="Chat" onClick={onChat} />
          <RowAction icon={<Columns3 />} label="Compare" onClick={onCompare} />
          <RowAction
            icon={<Type />}
            label="Rename"
            onClick={() => {
              setDraftName(tree.name);
              onStartRename();
            }}
          />
          <RowAction icon={<Copy />} label="Duplicate" onClick={onDuplicate} />
          <RowAction icon={<Trash2 />} label="Delete" onClick={onAskDelete} danger />
        </div>
      )}
    </li>
  );
}

function RowAction({
  icon,
  label,
  onClick,
  danger = false,
}: {
  icon: React.ReactElement;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 [&_svg]:h-3.5 [&_svg]:w-3.5 ${
        danger
          ? 'text-red-700 hover:bg-red-50'
          : 'text-gray-700 hover:bg-gray-100'
      }`}
    >
      {React.cloneElement(icon, { 'aria-hidden': true } as React.SVGProps<SVGSVGElement>)}
      {label}
    </button>
  );
}
