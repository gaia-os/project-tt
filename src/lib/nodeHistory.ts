/** Browser-like back/forward history for the node details panel. */

export interface NodeHistoryEntry {
  id: string;
  label: string;
}

export interface NodeHistoryState {
  entries: NodeHistoryEntry[];
  index: number;
  /** Index requested by back/forward, confirmed once that node is shown. */
  pending: number | null;
}

export type NodeHistoryAction =
  | { type: 'visit'; entry: NodeHistoryEntry }
  | { type: 'go'; delta: number }
  | { type: 'reset' };

export const NODE_HISTORY_LIMIT = 50;

export const initialNodeHistory: NodeHistoryState = { entries: [], index: -1, pending: null };

export function nodeHistoryReducer(
  state: NodeHistoryState,
  action: NodeHistoryAction,
): NodeHistoryState {
  switch (action.type) {
    case 'reset':
      return initialNodeHistory;
    case 'go': {
      const target = state.index + action.delta;
      if (target < 0 || target >= state.entries.length) return state;
      // Same node already shown: no visit will follow, so move right away.
      if (state.entries[target].id === state.entries[state.index]?.id) {
        return { ...state, index: target, pending: null };
      }
      return { ...state, pending: target };
    }
    case 'visit': {
      const { entry } = action;
      if (state.entries[state.index]?.id === entry.id) {
        return state.pending === null ? state : { ...state, pending: null };
      }
      if (state.pending !== null && state.entries[state.pending]?.id === entry.id) {
        return { ...state, index: state.pending, pending: null };
      }
      const entries = [...state.entries.slice(0, state.index + 1), entry].slice(
        -NODE_HISTORY_LIMIT,
      );
      return { entries, index: entries.length - 1, pending: null };
    }
  }
}

/** Entry a back (-1) or forward (+1) step would open, if any. */
export function nodeHistoryTarget(
  state: NodeHistoryState,
  delta: number,
): NodeHistoryEntry | undefined {
  return state.entries[state.index + delta];
}
