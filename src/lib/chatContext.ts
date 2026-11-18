import { DataNode, TechTree } from '@/lib/types';
import { TopicKey, isTopicKey, titleizeLabel } from '@/lib/topicConfig';
import { chatContextTree, isSmrTree, smrChatNode } from '@/lib/smrFilters';
import { inducedSubtree } from '@/lib/customTrees';

/*
 * What the assistant is talking about. The chat sends the part of a tree
 * the visitor is looking at, most specific first:
 *
 *   1. a tree being built          (its own conversation)
 *   2. a guided pathway            (one conversation per target)
 *   3. a saved custom tree         (one conversation per tree)
 *   4. the whole topic tree        (the topic's conversation)
 *
 * Within 3 and 4 the connected-nodes view and the search/category/role
 * filters narrow what is sent (a "refinement") without starting a new
 * conversation, since they change with nearly every click.
 */

export type ChatScopeKind = 'topic' | 'pathway' | 'custom' | 'draft';

export interface ChatRefinement {
  kind: 'connected' | 'filtered';
  label: string;
}

export interface ChatScopePathway {
  targetLabel: string;
  /** Foundations first; the last stage is the target. */
  stages: { title: string; nodeIds: string[] }[];
  bottleneck: { nodeId: string; trl: number } | null;
  /** Title of the guide step on screen. */
  currentStep: string | null;
  /** Prerequisites left out to keep long pathways readable. */
  hiddenCount: number;
}

export interface ChatScope {
  kind: ChatScopeKind;
  topic: TopicKey;
  /** The conversation this context belongs to. */
  threadKey: string;
  /** Conversation title, e.g. "Path to HTS tokamak". */
  title: string;
  refinement: ChatRefinement | null;
  /** Nodes and links the assistant is given. */
  tree: TechTree;
  /** Size of the whole topic tree, for "N of M nodes". */
  totalNodeCount: number;
  /** The visitor's notes on a custom tree. */
  notes: string;
  pathway: ChatScopePathway | null;
}

// --- Conversations --------------------------------------------------------

export const topicThreadKey = (topic: TopicKey) => topic;
export const pathwayThreadKey = (topic: TopicKey, targetId: string) =>
  `${topic}:pathway:${targetId}`;
export const customThreadKey = (treeId: string) => `custom:${treeId}`;
export const draftThreadKey = (topic: TopicKey) => `${topic}:draft`;

/** Whole-topic threads keep the storage key chats always used. */
export function chatHistoryStorageKey(threadKey: string): string {
  return isTopicKey(threadKey)
    ? `tech-tree-chat-history-${threadKey}`
    : `tech-tree-chat-thread:${threadKey}`;
}

export function chatScrollStorageKey(threadKey: string): string {
  return isTopicKey(threadKey)
    ? `tech-tree-chat-scroll-${threadKey}`
    : `tech-tree-chat-scroll:${threadKey}`;
}

export const CHAT_THREAD_INDEX_KEY = 'tech-tree-chat-threads-v1';
/** Scoped conversations kept; whole-topic ones are never evicted. */
export const MAX_SCOPED_THREADS = 30;

export interface ThreadIndexEntry {
  key: string;
  at: number;
}

export function parseThreadIndex(raw: string | null): ThreadIndexEntry[] {
  try {
    const value: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(value)
      ? value.filter(
          (entry): entry is ThreadIndexEntry =>
            !!entry &&
            typeof entry.key === 'string' &&
            typeof entry.at === 'number',
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Marks `key` as just used. Returns the new index (most recent first) and
 * the scoped threads that fell off the end and should be deleted.
 */
export function touchThreadIndex(
  index: ThreadIndexEntry[],
  key: string,
  now: number,
  max: number = MAX_SCOPED_THREADS,
): { index: ThreadIndexEntry[]; evicted: string[] } {
  if (isTopicKey(key)) return { index, evicted: [] };
  const next = [{ key, at: now }, ...index.filter((entry) => entry.key !== key)];
  return {
    index: next.slice(0, max),
    evicted: next.slice(max).map((entry) => entry.key),
  };
}

export function dropFromThreadIndex(
  index: ThreadIndexEntry[],
  key: string,
): ThreadIndexEntry[] {
  return index.filter((entry) => entry.key !== key);
}

// --- Choosing the scope -----------------------------------------------------

export interface ChatScopeInputs {
  topic: TopicKey;
  /** Display label for the topic (dataset.json label); titleized id otherwise. */
  topicLabel?: string;
  /** The topic's full tree. */
  techTree: TechTree;
  draft: {
    ids: ReadonlySet<string>;
    name: string;
    notes: string;
    editingId: string | null;
  } | null;
  pathway: {
    targetId: string;
    targetLabel: string;
    /** Pathway subgraph; null when the target has no prerequisites. */
    tree: TechTree | null;
    stages: { title: string; nodeIds: string[] }[];
    bottleneck: { nodeId: string; trl: number } | null;
    currentStep: string | null;
    hiddenCount: number;
  } | null;
  custom: {
    id: string;
    name: string;
    notes: string;
    tree: TechTree;
  } | null;
  /** What the canvas shows after connected-view and filters, if narrowed. */
  view: {
    tree: TechTree;
    connectedTo: string | null;
    filterLabel: string | null;
  } | null;
}

export function resolveChatScope(inputs: ChatScopeInputs): ChatScope {
  const { topic, techTree, draft, pathway, custom, view } = inputs;
  const common = {
    topic,
    totalNodeCount: techTree.nodes.length,
    notes: '',
    pathway: null,
    refinement: null,
  };

  if (draft) {
    return {
      ...common,
      kind: 'draft',
      threadKey: draft.editingId ? customThreadKey(draft.editingId) : draftThreadKey(topic),
      title: draft.name.trim() || 'Tree being built',
      tree: inducedSubtree(techTree, draft.ids),
      notes: draft.notes,
    };
  }

  if (pathway) {
    const target = techTree.nodes.find((node) => node.id === pathway.targetId);
    return {
      ...common,
      kind: 'pathway',
      threadKey: pathwayThreadKey(topic, pathway.targetId),
      title: `Path to ${pathway.targetLabel}`,
      tree: pathway.tree ?? { nodes: target ? [target] : [], edges: [] },
      pathway: {
        targetLabel: pathway.targetLabel,
        stages: pathway.stages,
        bottleneck: pathway.bottleneck,
        currentStep: pathway.currentStep,
        hiddenCount: pathway.hiddenCount,
      },
    };
  }

  const refinement: ChatRefinement | null = view?.connectedTo
    ? { kind: 'connected', label: `Connected to ${view.connectedTo}` }
    : view?.filterLabel
      ? { kind: 'filtered', label: view.filterLabel }
      : null;

  if (custom) {
    return {
      ...common,
      kind: 'custom',
      threadKey: customThreadKey(custom.id),
      title: custom.name,
      refinement,
      tree: refinement && view ? view.tree : custom.tree,
      notes: custom.notes,
    };
  }

  return {
    ...common,
    kind: 'topic',
    threadKey: topicThreadKey(topic),
    title: `${inputs.topicLabel ?? titleizeLabel(topic)} tree`,
    refinement,
    tree: refinement && view ? view.tree : techTree,
  };
}

/** "13 of 45 nodes" for chips and captions. */
export function describeScopeSize(scope: ChatScope): string {
  const count = scope.tree.nodes.length;
  const noun = `node${count === 1 ? '' : 's'}`;
  return scope.kind === 'topic' && !scope.refinement
    ? `${count} ${noun}`
    : `${count} of ${scope.totalNodeCount} ${noun}`;
}

// --- Request payload --------------------------------------------------------

/** What the server needs to describe the scope (validated there). */
export interface ChatScopePayload {
  kind: ChatScopeKind;
  title: string;
  refinement: string | null;
  totalNodeCount: number;
  notes: string;
  pathway: ChatScopePathway | null;
}

const CLIENT_DESCRIPTION_LIMIT = 600;

function compactNode(node: DataNode, smr: boolean): DataNode {
  if (smr) return smrChatNode(node);
  const text = node.data.detailedDescription || node.data.description || '';
  return {
    id: node.id,
    data: {
      label: node.data.label,
      nodeLabel: node.data.nodeLabel,
      category: node.data.category,
      trl_current: node.data.trl_current,
      description: '',
      detailedDescription: text.slice(0, CLIENT_DESCRIPTION_LIMIT),
    },
  };
}

/**
 * The chat request's `context` and `scope`. The whole topic tree is sent
 * exactly as before (no scope), so existing behaviour is unchanged; any
 * subset is sent with its links and a description of what it is.
 */
export function buildChatPayload(scope: ChatScope): {
  context: TechTree;
  scope?: ChatScopePayload;
} {
  if (scope.kind === 'topic' && !scope.refinement) {
    return { context: chatContextTree(scope.tree) };
  }
  const smr = isSmrTree(scope.tree);
  return {
    context: {
      nodes: scope.tree.nodes.map((node) => compactNode(node, smr)),
      edges: scope.tree.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
    },
    scope: {
      kind: scope.kind,
      title: scope.title,
      refinement: scope.refinement?.label ?? null,
      totalNodeCount: scope.totalNodeCount,
      notes: scope.notes,
      pathway: scope.pathway,
    },
  };
}

// --- Server side --------------------------------------------------------------

export const CHAT_CONTEXT_LIMITS = {
  nodes: 200,
  edges: 400,
  description: 500,
  overflowLabels: 100,
  /** Whole-tree requests: far above any real tree, a guard only. */
  wholeTreeNodes: 3000,
} as const;

const clip = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

const SCOPE_KINDS: ChatScopeKind[] = ['topic', 'pathway', 'custom', 'draft'];

/** The request's `scope`, trimmed to sane sizes; null if absent or invalid. */
export function parseChatScope(value: unknown): ChatScopePayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!SCOPE_KINDS.includes(record.kind as ChatScopeKind)) return null;
  const total = Number(record.totalNodeCount);
  const pathway = record.pathway as Record<string, unknown> | null | undefined;
  const stages = Array.isArray(pathway?.stages) ? pathway.stages : [];
  const bottleneck = pathway?.bottleneck as Record<string, unknown> | null | undefined;
  return {
    kind: record.kind as ChatScopeKind,
    title: clip(record.title, 120) || 'Selected nodes',
    refinement: clip(record.refinement, 160) || null,
    totalNodeCount: Number.isFinite(total) && total >= 0 ? Math.floor(total) : 0,
    notes: clip(record.notes, 1000),
    pathway: pathway
      ? {
          targetLabel: clip(pathway.targetLabel, 160),
          stages: stages.slice(0, 40).map((stage) => {
            const entry = (stage ?? {}) as Record<string, unknown>;
            return {
              title: clip(entry.title, 120),
              nodeIds: Array.isArray(entry.nodeIds)
                ? entry.nodeIds
                    .filter((id): id is string => typeof id === 'string')
                    .slice(0, 200)
                    .map((id) => id.slice(0, 300))
                : [],
            };
          }),
          bottleneck:
            bottleneck && typeof bottleneck.nodeId === 'string'
              ? { nodeId: bottleneck.nodeId.slice(0, 300), trl: Number(bottleneck.trl) || 0 }
              : null,
          currentStep: clip(pathway.currentStep, 160) || null,
          hiddenCount: Math.max(0, Math.floor(Number(pathway.hiddenCount) || 0)),
        }
      : null,
  };
}

function nodeLine(node: DataNode, descriptionLimit?: number): string {
  const text = node.data.detailedDescription || node.data.description || '';
  return (
    `- ${node.data.label} [${node.id}] (category: ${node.data.category || 'n/a'}, ` +
    `TRL ${node.data.trl_current || 'n/a'}): ` +
    (descriptionLimit === undefined ? text : text.slice(0, descriptionLimit))
  );
}

const SCOPE_SENTENCES: Record<ChatScopeKind, string> = {
  topic: 'It is part of the',
  pathway: 'It is the prerequisite pathway, taken from the',
  custom: 'The user built this tree themselves from the',
  draft: 'The user is still building this tree from the',
};

/**
 * The `contextText` the KG service appends to its prompt. Without a scope
 * it is exactly the original whole-tree text.
 */
export function formatChatContext({
  systemPrompt,
  topicLabel,
  context,
  scope,
}: {
  systemPrompt: string;
  topicLabel: string;
  context: TechTree | undefined;
  scope: ChatScopePayload | null;
}): string {
  const nodes = Array.isArray(context?.nodes) ? context.nodes : [];
  if (!scope) {
    const nodesContext = nodes
      .slice(0, CHAT_CONTEXT_LIMITS.wholeTreeNodes)
      .map((node) => nodeLine(node))
      .join('\n');
    return `${systemPrompt}\n\nTECH TREE NODES:\n${nodesContext}`;
  }

  const edges = Array.isArray(context?.edges) ? context.edges : [];
  const labelOf = new Map(nodes.map((node) => [node.id, node.data?.label ?? node.id]));
  const shown = nodes.slice(0, CHAT_CONTEXT_LIMITS.nodes);
  const overflow = nodes.slice(CHAT_CONTEXT_LIMITS.nodes);
  const links = edges.filter(
    (edge) => labelOf.has(edge.source) && labelOf.has(edge.target),
  );

  const sections: string[] = [systemPrompt];
  const focus = scope.refinement ? `${scope.title} › ${scope.refinement}` : scope.title;
  sections.push(
    [
      `CURRENT FOCUS: ${focus}`,
      `${SCOPE_SENTENCES[scope.kind]} ${topicLabel} tech tree: ${nodes.length} of ` +
        `${scope.totalNodeCount || nodes.length} nodes and ${links.length} prerequisite links.`,
      'Answer about this selection first. If a question needs nodes outside it, say so ' +
        'before drawing on the wider tree or the knowledge graph.',
    ].join('\n'),
  );

  if (scope.notes) {
    sections.push(`USER NOTES ABOUT THIS TREE:\n${scope.notes}`);
  }

  if (scope.pathway) {
    const { pathway } = scope;
    const lines = pathway.stages.map(
      (stage, index) =>
        `${index + 1}. ${stage.title}: ${stage.nodeIds
          .map((id) => labelOf.get(id) ?? id)
          .join(', ')}`,
    );
    if (pathway.bottleneck) {
      lines.push(
        `Lowest-readiness prerequisite (likely bottleneck): ` +
          `${labelOf.get(pathway.bottleneck.nodeId) ?? pathway.bottleneck.nodeId} ` +
          `(TRL ${pathway.bottleneck.trl})`,
      );
    }
    if (pathway.hiddenCount > 0) {
      lines.push(`${pathway.hiddenCount} more distant prerequisites are not listed.`);
    }
    if (pathway.currentStep) {
      lines.push(`The user is currently looking at the step: ${pathway.currentStep}`);
    }
    sections.push(
      `PATHWAY TO ${pathway.targetLabel.toUpperCase()} (foundations first):\n${lines.join('\n')}`,
    );
  }

  const nodeLines = shown.map((node) => nodeLine(node, CHAT_CONTEXT_LIMITS.description));
  if (overflow.length) {
    const names = overflow
      .slice(0, CHAT_CONTEXT_LIMITS.overflowLabels)
      .map((node) => node.data?.label ?? node.id);
    const more = overflow.length - names.length;
    nodeLines.push(
      `- … and ${overflow.length} more nodes: ${names.join(', ')}${more > 0 ? `, +${more} more` : ''}`,
    );
  }
  sections.push(`TECH TREE NODES:\n${nodeLines.join('\n')}`);

  if (links.length) {
    const linkLines = links
      .slice(0, CHAT_CONTEXT_LIMITS.edges)
      .map((edge) => `- ${labelOf.get(edge.source)} → ${labelOf.get(edge.target)}`);
    if (links.length > CHAT_CONTEXT_LIMITS.edges) {
      linkLines.push(`- … and ${links.length - CHAT_CONTEXT_LIMITS.edges} more links`);
    }
    sections.push(`PREREQUISITE LINKS (prerequisite → dependent):\n${linkLines.join('\n')}`);
  }

  return sections.join('\n\n');
}
