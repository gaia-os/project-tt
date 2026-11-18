'use client';

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  ExplorerUrlPatch,
  applyExplorerPatch,
  parseExplorerParams,
} from '@/lib/explorerUrlState';

/**
 * Reads and writes the shareable explorer state (topic, view, focus, pathway,
 * step) in the query string.
 *
 * Writes use the native `history.replaceState`, which Next.js syncs into
 * `useSearchParams`. It updates `window.location` synchronously, so several
 * patches in one event handler compose instead of overwriting each other,
 * and no server round trip is triggered.
 */
export function useExplorerUrlState() {
  const searchParams = useSearchParams();
  const urlState = useMemo(
    () => parseExplorerParams(searchParams),
    [searchParams],
  );

  const updateUrl = useCallback((patch: ExplorerUrlPatch) => {
    const current = new URLSearchParams(window.location.search);
    const next = applyExplorerPatch(current, patch);
    if (next.toString() === current.toString()) return;

    const query = next.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    // Must be null: Next.js skips syncing calls whose state carries its own
    // internal markers, and copies that state over itself.
    window.history.replaceState(null, '', url);
  }, []);

  return { urlState, updateUrl };
}
