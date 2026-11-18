import { EXPLORER_VIEW_MODES, ExplorerViewMode } from '@/lib/types';
import { TopicKey, isTopicKey } from '@/lib/topicConfig';

export const EXPLORER_PANELS = ['details', 'chat', 'simulations'] as const;
export type ExplorerPanel = (typeof EXPLORER_PANELS)[number];

/** Explorer state that lives in the query string so views can be shared. */
export interface ExplorerUrlState {
  /** Null when the URL does not name a valid topic. */
  topic: TopicKey | null;
  view: ExplorerViewMode;
  /** Technology node focused in the graph. */
  focus: string | null;
  /** Target node of the guided pathway. */
  pathway: string | null;
  /** Zero-based guided pathway step; always 0 without a pathway. */
  step: number;
  /** Side-panel tab; null means the default (details). */
  panel: ExplorerPanel | null;
  /** Company/world filter: only companies mapped to this technology id. */
  tech: string | null;
  /** Custom tree (saved in this browser) shown in the technology view. */
  tree: string | null;
}

/** `undefined` leaves a param untouched; `null` removes it. */
export interface ExplorerUrlPatch {
  topic?: TopicKey | null;
  view?: ExplorerViewMode | null;
  focus?: string | null;
  pathway?: string | null;
  step?: number | null;
  panel?: ExplorerPanel | null;
  tech?: string | null;
  tree?: string | null;
}

const DEFAULT_VIEW: ExplorerViewMode = 'technology';
const DEFAULT_PANEL: ExplorerPanel = 'details';

function isViewMode(value: string | null): value is ExplorerViewMode {
  return (
    value !== null &&
    (EXPLORER_VIEW_MODES as readonly string[]).includes(value)
  );
}

function isPanel(value: string | null): value is ExplorerPanel {
  return (
    value !== null &&
    (EXPLORER_PANELS as readonly string[]).includes(value)
  );
}

export function parseExplorerParams(
  params: Pick<URLSearchParams, 'get'>,
): ExplorerUrlState {
  const topic = params.get('topic');
  const view = params.get('view');
  const pathway = params.get('pathway') || null;
  const step = Number.parseInt(params.get('step') ?? '', 10);
  const panel = params.get('panel');

  return {
    topic: isTopicKey(topic) ? topic : null,
    view: isViewMode(view) ? view : DEFAULT_VIEW,
    focus: params.get('focus') || null,
    pathway,
    step: pathway && Number.isFinite(step) && step > 0 ? step : 0,
    panel: isPanel(panel) && panel !== DEFAULT_PANEL ? panel : null,
    tech: params.get('tech') || null,
    tree: params.get('tree') || null,
  };
}

/** Returns a new param set with the patch applied; defaults are omitted. */
export function applyExplorerPatch(
  params: URLSearchParams,
  patch: ExplorerUrlPatch,
): URLSearchParams {
  const next = new URLSearchParams(params);
  const set = (key: string, value: string | null | undefined) => {
    if (value === undefined) return;
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  };

  set('topic', patch.topic);
  if (patch.view !== undefined) {
    set('view', patch.view === DEFAULT_VIEW ? null : patch.view);
  }
  set('focus', patch.focus);
  set('pathway', patch.pathway);
  if (patch.step !== undefined) {
    set('step', patch.step === null || patch.step <= 0 ? null : String(patch.step));
  }
  if (!next.get('pathway')) next.delete('step');
  if (patch.panel !== undefined) {
    set('panel', patch.panel === null || patch.panel === DEFAULT_PANEL ? null : patch.panel);
  }
  set('tech', patch.tech);
  set('tree', patch.tree);

  return next;
}
