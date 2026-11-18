'use client';

import React, { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, X } from 'lucide-react';
import { TopicKey } from '@/lib/topicConfig';
import {
  CustomTree,
  CustomTreeOrigin,
  MAX_TREE_NAME_LENGTH,
  MAX_TREE_NOTES_LENGTH,
} from '@/lib/customTrees';
import { customTreeStore } from '@/hooks/useCustomTrees';
import {
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/** A selection to keep as a custom tree. */
export interface SaveTreeRequest {
  topic: TopicKey;
  nodeIds: string[];
  defaultName: string;
  origin: CustomTreeOrigin;
  /** What is being saved, e.g. "the pathway to X". */
  what: string;
}

interface SaveTreeDialogProps {
  request: SaveTreeRequest | null;
  onClose: () => void;
  onOpenTree: (tree: CustomTree) => void;
}

/** Names a selection (pathway, connected view, filtered view) and saves it. */
export function SaveTreeDialog({ request, onClose, onOpenTree }: SaveTreeDialogProps) {
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState<CustomTree | null>(null);

  useEffect(() => {
    if (!request) return;
    setName(request.defaultName);
    setNotes('');
    setSaved(null);
  }, [request]);

  const count = request?.nodeIds.length ?? 0;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!request || !count) return;
    setSaved(
      customTreeStore.create({
        name,
        topic: request.topic,
        nodeIds: request.nodeIds,
        notes,
        origin: request.origin,
      }),
    );
  };

  return (
    <DialogPrimitive.Root
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[80]" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-[81] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-5 shadow-2xl focus:outline-none">
          <DialogPrimitive.Close
            className="absolute right-3 top-3 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </DialogPrimitive.Close>
          {saved ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
                  <Check className="h-4 w-4" aria-hidden />
                </span>
                <div className="space-y-1">
                  <DialogTitle className="text-base font-semibold text-gray-900">
                    Saved “{saved.name}”
                  </DialogTitle>
                  <DialogDescription className="text-sm text-gray-600">
                    {saved.nodeIds.length} nodes, kept in this browser. Find it
                    under My trees or in the tree picker.
                  </DialogDescription>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Done
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    onOpenTree(saved);
                    onClose();
                  }}
                >
                  Open it
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1 pr-6">
                <DialogTitle className="text-base font-semibold text-gray-900">
                  Save as your own tree
                </DialogTitle>
                <DialogDescription className="text-sm text-gray-600">
                  {count} node{count === 1 ? '' : 's'} from {request?.what}. You
                  can open, edit, compare and chat about it later.
                </DialogDescription>
              </div>
              <label className="block space-y-1 text-xs font-medium text-gray-700">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={MAX_TREE_NAME_LENGTH}
                  autoFocus
                  className="block h-9 w-full rounded-md border border-gray-300 px-2.5 text-sm font-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <label className="block space-y-1 text-xs font-medium text-gray-700">
                Notes{' '}
                <span className="font-normal text-gray-500">
                  (optional · the assistant sees these)
                </span>
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={MAX_TREE_NOTES_LENGTH}
                  rows={3}
                  placeholder="Why this selection? What do you want to find out?"
                  className="block w-full resize-y rounded-md border border-gray-300 px-2.5 py-1.5 text-sm font-normal text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={!count}>
                  Save tree
                </Button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
