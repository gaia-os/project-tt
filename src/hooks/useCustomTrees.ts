'use client';

import { useSyncExternalStore } from 'react';
import {
  CUSTOM_TREES_STORAGE_KEY,
  CustomTree,
  CustomTreePatch,
  ImportResult,
  NewTreeInput,
  createTree,
  duplicateTree,
  importTrees,
  parseStoredTrees,
  removeTree,
  serializeTrees,
  updateTree,
} from '@/lib/customTrees';

/*
 * One shared list of custom trees for every component, backed by
 * localStorage and kept in sync across tabs. If storage is unavailable
 * (private mode, quota), trees live in memory for the session.
 */

const EMPTY: CustomTree[] = [];
const listeners = new Set<() => void>();
let cache: CustomTree[] | null = null;
let memoryCopy: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(CUSTOM_TREES_STORAGE_KEY) ?? memoryCopy;
  } catch {
    return memoryCopy;
  }
}

function snapshot(): CustomTree[] {
  if (!cache) cache = parseStoredTrees(readRaw());
  return cache;
}

function commit(trees: CustomTree[]) {
  cache = trees;
  const raw = serializeTrees(trees);
  try {
    window.localStorage.setItem(CUSTOM_TREES_STORAGE_KEY, raw);
    memoryCopy = null;
  } catch {
    memoryCopy = raw;
  }
  listeners.forEach((listener) => listener());
}

function onStorage(event: StorageEvent) {
  if (event.key !== CUSTOM_TREES_STORAGE_KEY && event.key !== null) return;
  cache = null;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Current trees, outside React (e.g. inside event handlers). */
export function getCustomTrees(): CustomTree[] {
  return typeof window === 'undefined' ? EMPTY : snapshot();
}

export const customTreeStore = {
  create(input: NewTreeInput): CustomTree {
    const { trees, tree } = createTree(snapshot(), input);
    commit(trees);
    return tree;
  },
  update(id: string, patch: CustomTreePatch) {
    commit(updateTree(snapshot(), id, patch));
  },
  remove(id: string) {
    commit(removeTree(snapshot(), id));
  },
  duplicate(id: string): CustomTree | null {
    const result = duplicateTree(snapshot(), id);
    if (!result) return null;
    commit(result.trees);
    return result.tree;
  },
  importJson(json: string): ImportResult {
    const result = importTrees(snapshot(), json);
    if (result.ok) commit(result.trees);
    return result;
  },
};

/** Every saved custom tree, newest first. Empty during server rendering. */
export function useCustomTrees(): CustomTree[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/** False while rendering on the server or hydrating. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

function subscribeNever() {
  return () => {};
}
