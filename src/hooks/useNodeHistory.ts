import { useCallback, useEffect, useReducer } from 'react';
import {
  NodeHistoryEntry,
  initialNodeHistory,
  nodeHistoryReducer,
  nodeHistoryTarget,
} from '@/lib/nodeHistory';

export interface NodeHistoryControls {
  back?: NodeHistoryEntry;
  forward?: NodeHistoryEntry;
  goBack: () => void;
  goForward: () => void;
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

  const back = nodeHistoryTarget(state, -1);
  const forward = nodeHistoryTarget(state, 1);

  const go = useCallback(
    (delta: number, target?: NodeHistoryEntry) => {
      if (!target || !onNavigate) return;
      dispatch({ type: 'go', delta });
      onNavigate(target.id);
    },
    [onNavigate],
  );

  return {
    back: onNavigate ? back : undefined,
    forward: onNavigate ? forward : undefined,
    goBack: () => go(-1, back),
    goForward: () => go(1, forward),
  };
}
