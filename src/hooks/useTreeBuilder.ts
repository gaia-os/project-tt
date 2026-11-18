'use client';

import { useCallback, useMemo, useState } from 'react';
import { TopicKey } from '@/lib/topicConfig';
import { CustomTreeOrigin } from '@/lib/customTrees';

/** A custom tree being built (or edited) on the canvas. */
export interface TreeDraft {
  topic: TopicKey;
  ids: ReadonlySet<string>;
  name: string;
  notes: string;
  /** The saved tree being edited; null for a new one. */
  editingId: string | null;
  origin: CustomTreeOrigin;
  /** Ids at the start, to tell whether anything changed. */
  initialIds: ReadonlySet<string>;
}

export interface StartDraftOptions {
  topic: TopicKey;
  ids?: Iterable<string>;
  name?: string;
  notes?: string;
  editingId?: string | null;
  origin?: CustomTreeOrigin;
}

export function useTreeBuilder() {
  const [draft, setDraft] = useState<TreeDraft | null>(null);

  const start = useCallback((options: StartDraftOptions) => {
    const ids = new Set(options.ids ?? []);
    setDraft({
      topic: options.topic,
      ids,
      name: options.name ?? '',
      notes: options.notes ?? '',
      editingId: options.editingId ?? null,
      origin: options.origin ?? { kind: 'builder', label: '' },
      initialIds: ids,
    });
  }, []);

  const setIds = useCallback(
    (update: (ids: Set<string>) => void) =>
      setDraft((current) => {
        if (!current) return current;
        const ids = new Set(current.ids);
        update(ids);
        return ids.size === current.ids.size &&
          [...ids].every((id) => current.ids.has(id))
          ? current
          : { ...current, ids };
      }),
    [],
  );

  const toggle = useCallback(
    (id: string) =>
      setIds((ids) => {
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
      }),
    [setIds],
  );

  const toggleGroup = useCallback(
    (group: string[]) =>
      setIds((ids) => {
        const allIn = group.every((id) => ids.has(id));
        for (const id of group) {
          if (allIn) ids.delete(id);
          else ids.add(id);
        }
      }),
    [setIds],
  );

  const add = useCallback(
    (more: Iterable<string>) =>
      setIds((ids) => {
        for (const id of more) ids.add(id);
      }),
    [setIds],
  );

  const clear = useCallback(() => setIds((ids) => ids.clear()), [setIds]);

  const setName = useCallback(
    (name: string) => setDraft((current) => (current ? { ...current, name } : current)),
    [],
  );
  const setNotes = useCallback(
    (notes: string) => setDraft((current) => (current ? { ...current, notes } : current)),
    [],
  );
  const stop = useCallback(() => setDraft(null), []);

  const isDirty = useMemo(
    () =>
      !!draft &&
      (draft.ids.size !== draft.initialIds.size ||
        [...draft.ids].some((id) => !draft.initialIds.has(id))),
    [draft],
  );

  return {
    draft,
    isDirty,
    start,
    toggle,
    toggleGroup,
    add,
    clear,
    setName,
    setNotes,
    stop,
  };
}

export type TreeBuilder = ReturnType<typeof useTreeBuilder>;
