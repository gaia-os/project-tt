import { useCallback, useEffect, useReducer } from 'react';
import {
  NodeHistoryEntry,
  initialNodeHistory,
  nodeHistoryReducer,
  nodeHistoryTarget,
} from '@/lib/nodeHistory';

export interface NodeHistoryItem extends NodeHistoryEntry {
  /** Steps from the current node, negative for back, positive for forward. */
  delta: number;
}

export interface NodeHistoryControls {
  back?: NodeHistoryEntry;
  forward?: NodeHistoryEntry;
  /** Jump targets, nearest first. */
  backItems: NodeHistoryItem[];
  forwardItems: NodeHistoryItem[];
  goBack: () => void;
  goForward: () => void;
  jumpTo: (delta: number) => void;
}

/**
 * Records every node shown in the details panel and steps back/forward
 * through them via `onNavigate`. Cleared whenever `resetKey` changes.
 */
export function useNodeHistory(
  current: NodeHistoryEntry | undefined,
  resetKey: string,
  onNavigate?: (nodeId: string) => void,
): NodeHistoryControls {
  const [state, dispatch] = useReducer(nodeHistoryReducer, initialNodeHistory);

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [resetKey]);

  const currentId = current?.id;
  const currentLabel = current?.label;
  useEffect(() => {
    if (currentId) {
      dispatch({ type: 'visit', entry: { id: currentId, label: currentLabel ?? currentId } });
    }
    // Labels never change for a given id; only a new id is a new visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const backItems = state.entries
    .slice(0, state.index)
    .reverse()
    .map((e, i): NodeHistoryItem => ({ ...e, delta: -(i + 1) }));
  const forwardItems = state.entries
    .slice(state.index + 1)
    .map((e, i): NodeHistoryItem => ({ ...e, delta: i + 1 }));
  const back = backItems[0];
  const forward = forwardItems[0];

  const jumpTo = useCallback(
    (delta: number) => {
      const target = nodeHistoryTarget(state, delta);
      if (!target || !onNavigate) return;
      dispatch({ type: 'go', delta });
      onNavigate(target.id);
    },
    [state, onNavigate],
  );

  return {
    back: onNavigate ? back : undefined,
    forward: onNavigate ? forward : undefined,
    backItems: onNavigate ? backItems : [],
    forwardItems: onNavigate ? forwardItems : [],
    goBack: () => jumpTo(-1),
    goForward: () => jumpTo(1),
    jumpTo,
  };
}
