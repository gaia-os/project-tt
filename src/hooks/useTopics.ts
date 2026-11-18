'use client';

import { useEffect, useState } from 'react';
import { TopicSummary } from '@/lib/topicConfig';

// Shared across every hook instance so the selector, onboarding and dialogs
// issue a single request. Dataset changes reload the page, which resets it.
let inFlightTopics: Promise<TopicSummary[]> | null = null;
let resolvedTopics: TopicSummary[] | null = null;

/** Loads (once) and caches the dataset list from `GET /api/topics`. */
export function loadTopics(): Promise<TopicSummary[]> {
  if (resolvedTopics) return Promise.resolve(resolvedTopics);
  if (inFlightTopics) return inFlightTopics;

  const request = fetch('/investment-tech-tree/api/topics')
    .then(async (response) => {
      if (!response.ok) throw new Error('Failed to fetch tech tree datasets');
      const topics = (await response.json()) as TopicSummary[];
      resolvedTopics = topics;
      return topics;
    })
    .catch((error: unknown) => {
      inFlightTopics = null;
      console.error('Error fetching topics:', error);
      throw error;
    });

  inFlightTopics = request;
  return request;
}

interface TopicsState {
  topics: TopicSummary[];
  isLoading: boolean;
  error: string | null;
}

export function useTopics(): TopicsState {
  const [state, setState] = useState<TopicsState>({
    topics: resolvedTopics ?? [],
    isLoading: resolvedTopics === null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    loadTopics()
      .then((topics) => {
        if (!cancelled) setState({ topics, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            topics: [],
            isLoading: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
