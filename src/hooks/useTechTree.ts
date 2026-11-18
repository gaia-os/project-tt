'use client';

import { useCallback, useEffect, useState } from 'react';
import { TechTree } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';

// Shared across every hook instance so the workspace, graph and chat issue a
// single request per topic. Admin edits reload the page, which resets it.
const inFlightTrees = new Map<TopicKey, Promise<TechTree>>();
const resolvedTrees = new Map<TopicKey, TechTree>();

/** Loads (once) and caches a topic's tree; shared with `useTechTree`. */
export function loadTechTree(topic: TopicKey): Promise<TechTree> {
  const existing = inFlightTrees.get(topic);
  if (existing) return existing;

  const request = fetch(`/investment-tech-tree/api/tech-tree?topic=${topic}`)
    .then(async (response) => {
      if (!response.ok) throw new Error('Failed to fetch tech tree data');
      const data = (await response.json()) as TechTree;
      resolvedTrees.set(topic, data);
      return data;
    })
    .catch((error: unknown) => {
      inFlightTrees.delete(topic);
      console.error('Error fetching tech tree:', error);
      throw error;
    });

  inFlightTrees.set(topic, request);
  return request;
}

/** The already-loaded tree for a topic, without starting a request. */
export function peekTechTree(topic: TopicKey): TechTree | null {
  return resolvedTrees.get(topic) ?? null;
}

/** Starts loading a topic's tree in the background, e.g. on hover. */
export function prefetchTechTree(topic: TopicKey): void {
  loadTechTree(topic).catch(() => {
    // Surfaced by useTechTree once the topic is actually opened.
  });
}

interface TechTreeState {
  topic: TopicKey;
  techTree: TechTree | null;
  error: string | null;
}

interface UseTechTreeOptions {
  /** Defer the request, e.g. for an optional secondary topic. */
  enabled?: boolean;
}

export function useTechTree(
  topic: TopicKey,
  { enabled = true }: UseTechTreeOptions = {},
) {
  const [state, setState] = useState<TechTreeState>(() => ({
    topic,
    techTree: resolvedTrees.get(topic) ?? null,
    error: null,
  }));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const cached = resolvedTrees.get(topic);
    if (cached) {
      setState((current) =>
        current.topic === topic && current.techTree === cached
          ? current
          : { topic, techTree: cached, error: null },
      );
      return;
    }

    let cancelled = false;
    setState({ topic, techTree: null, error: null });
    loadTechTree(topic).then(
      (techTree) => {
        if (!cancelled) setState({ topic, techTree, error: null });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({
          topic,
          techTree: null,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [topic, attempt, enabled]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  // Never hand out the previous topic's tree while the new one loads.
  const isCurrent = state.topic === topic;
  const techTree = isCurrent
    ? state.techTree
    : (resolvedTrees.get(topic) ?? null);
  const error = isCurrent ? state.error : null;

  if (!enabled) {
    return { techTree: resolvedTrees.get(topic) ?? null, isLoading: false, error: null, retry };
  }
  return { techTree, isLoading: !techTree && !error, error, retry };
}
