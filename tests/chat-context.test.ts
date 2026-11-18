import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAT_CONTEXT_LIMITS,
  ChatScopeInputs,
  buildChatPayload,
  chatHistoryStorageKey,
  customThreadKey,
  describeScopeSize,
  draftThreadKey,
  formatChatContext,
  parseChatScope,
  pathwayThreadKey,
  resolveChatScope,
  touchThreadIndex,
} from '@/lib/chatContext';
import { chatContextTree } from '@/lib/smrFilters';
import { defaultSystemPrompt } from '@/lib/topicConfig';
import { TechTree } from '@/lib/types';
import { loadDatasetTree } from './helpers/datasetTree';

const nuclear = loadDatasetTree('nuclear_tt_v2.json');

// a → c, b → c, c → t
const small: TechTree = {
  nodes: ['a', 'b', 'c', 't'].map((id) => ({
    id,
    data: {
      label: `Node ${id}`,
      nodeLabel: 'Milestone',
      category: 'Core',
      trl_current: '4',
      description: `about ${id}`,
    },
  })),
  edges: [
    ['a', 'c'],
    ['b', 'c'],
    ['c', 't'],
  ].map(([source, target]) => ({ id: `${source}->${target}`, source, target })),
};

const none: Omit<ChatScopeInputs, 'topic' | 'techTree'> = {
  draft: null,
  pathway: null,
  custom: null,
  view: null,
};

const pathwayInput: ChatScopeInputs['pathway'] = {
  targetId: 't',
  targetLabel: 'Node t',
  tree: small,
  stages: [
    { title: 'Foundations', nodeIds: ['a', 'b'] },
    { title: 'Node c', nodeIds: ['c'] },
    { title: 'The deployment concept', nodeIds: ['t'] },
  ],
  bottleneck: { nodeId: 'a', trl: 2 },
  currentStep: 'Foundations',
  hiddenCount: 0,
};

test('whole-topic chats keep their old storage key; others get their own', () => {
  assert.equal(chatHistoryStorageKey('nuclear'), 'tech-tree-chat-history-nuclear');
  assert.equal(
    chatHistoryStorageKey(pathwayThreadKey('nuclear', 't')),
    'tech-tree-chat-thread:nuclear:pathway:t',
  );
  assert.equal(customThreadKey('ct_1'), 'custom:ct_1');
  assert.equal(draftThreadKey('smr'), 'smr:draft');
});

test('the thread index keeps the most recent scoped threads only', () => {
  let index: { key: string; at: number }[] = [];
  const evicted: string[] = [];
  for (let i = 0; i < 4; i++) {
    const result = touchThreadIndex(index, `custom:${i}`, i, 3);
    index = result.index;
    evicted.push(...result.evicted);
  }
  assert.deepEqual(index.map((entry) => entry.key), ['custom:3', 'custom:2', 'custom:1']);
  assert.deepEqual(evicted, ['custom:0']);
  // Re-using a thread moves it to the front instead of duplicating it.
  index = touchThreadIndex(index, 'custom:1', 9, 3).index;
  assert.deepEqual(index.map((entry) => entry.key), ['custom:1', 'custom:3', 'custom:2']);
  // Whole-topic threads are never indexed (or evicted).
  assert.equal(touchThreadIndex(index, 'nuclear', 10, 3).index, index);
});

test('the most specific selection wins: draft, pathway, custom tree, topic', () => {
  const base = {
  topic: 'nuclear' as const,
  topicLabel: 'Nuclear Energy',
  techTree: small,
};
  const custom = { id: 'ct_1', name: 'Mine', notes: 'why', tree: small };
  const draft = { ids: new Set(['a', 'c']), name: '', notes: '', editingId: null };

  const drafted = resolveChatScope({ ...base, ...none, draft, pathway: pathwayInput, custom });
  assert.equal(drafted.kind, 'draft');
  assert.equal(drafted.threadKey, 'nuclear:draft');
  assert.equal(drafted.title, 'Tree being built');
  assert.deepEqual(drafted.tree.edges.map((edge) => edge.id), ['a->c']);
  assert.equal(
    resolveChatScope({ ...base, ...none, draft: { ...draft, editingId: 'ct_1' } }).threadKey,
    'custom:ct_1',
  );

  const path = resolveChatScope({ ...base, ...none, pathway: pathwayInput, custom });
  assert.equal(path.kind, 'pathway');
  assert.equal(path.title, 'Path to Node t');
  assert.equal(path.threadKey, 'nuclear:pathway:t');

  const mine = resolveChatScope({ ...base, ...none, custom });
  assert.equal(mine.kind, 'custom');
  assert.equal(mine.notes, 'why');
  assert.equal(mine.threadKey, 'custom:ct_1');

  const whole = resolveChatScope({ ...base, ...none });
  assert.equal(whole.kind, 'topic');
  assert.equal(whole.threadKey, 'nuclear');
  assert.equal(whole.title, 'Nuclear Energy tree');
  assert.equal(describeScopeSize(whole), '4 nodes');
});

test('connected and filtered views narrow the context inside the same thread', () => {
  const view = {
    tree: { nodes: small.nodes.slice(2), edges: [small.edges[2]] },
    connectedTo: 'Node c',
    filterLabel: null,
  };
  const scope = resolveChatScope({ topic: 'nuclear', techTree: small, ...none, view });
  assert.equal(scope.threadKey, 'nuclear');
  assert.deepEqual(scope.refinement, { kind: 'connected', label: 'Connected to Node c' });
  assert.equal(scope.tree, view.tree);
  assert.equal(describeScopeSize(scope), '2 of 4 nodes');

  const filtered = resolveChatScope({
    topic: 'nuclear',
    techTree: small,
    ...none,
    custom: { id: 'ct_1', name: 'Mine', notes: '', tree: small },
    view: { ...view, connectedTo: null, filterLabel: 'Search “c”' },
  });
  assert.equal(filtered.threadKey, 'custom:ct_1');
  assert.equal(filtered.refinement?.label, 'Search “c”');
});

test('the whole tree is sent exactly as before; subsets carry links and a scope', () => {
  const whole = buildChatPayload(
    resolveChatScope({ topic: 'nuclear', techTree: nuclear, ...none }),
  );
  assert.deepEqual(whole.context, chatContextTree(nuclear));
  assert.equal(whole.scope, undefined);

  const path = buildChatPayload(
    resolveChatScope({ topic: 'nuclear', techTree: small, ...none, pathway: pathwayInput }),
  );
  assert.equal(path.scope?.kind, 'pathway');
  assert.equal(path.scope?.pathway?.stages.length, 3);
  assert.deepEqual(path.context.edges, small.edges);
  assert.equal(path.context.nodes[0].data.detailedDescription, 'about a');
});

test('without a scope the context text is the original whole-tree text', () => {
  const systemPrompt = defaultSystemPrompt('Nuclear Energy');
  const legacy = `${systemPrompt}\n\nTECH TREE NODES:\n${nuclear.nodes
    .map(
      (n) =>
        `- ${n.data.label} [${n.id}] (category: ${n.data.category || 'n/a'}, ` +
        `TRL ${n.data.trl_current || 'n/a'}): ${n.data.detailedDescription || n.data.description || ''}`,
    )
    .join('\n')}`;
  assert.equal(
    formatChatContext({ systemPrompt, topicLabel: 'Nuclear Energy', context: nuclear, scope: null }),
    legacy,
  );
});

test('a scoped context names the focus, notes, pathway stages and links', () => {
  const payload = buildChatPayload(
    resolveChatScope({ topic: 'nuclear', techTree: small, ...none, pathway: pathwayInput }),
  );
  const text = formatChatContext({
    systemPrompt: 'SYSTEM',
    topicLabel: 'Nuclear Energy',
    context: payload.context,
    scope: { ...payload.scope!, notes: 'Looking for the weakest link.' },
  });
  assert.ok(text.startsWith('SYSTEM\n\nCURRENT FOCUS: Path to Node t\n'));
  assert.match(text, /4 of 4 nodes and 3 prerequisite links/);
  assert.match(text, /USER NOTES ABOUT THIS TREE:\nLooking for the weakest link\./);
  assert.match(text, /1\. Foundations: Node a, Node b/);
  assert.match(text, /bottleneck\): Node a \(TRL 2\)/);
  assert.match(text, /currently looking at the step: Foundations/);
  assert.match(text, /- Node a → Node c/);
});

test('large selections are capped and summarised', () => {
  const count = CHAT_CONTEXT_LIMITS.nodes + 5;
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    data: {
      label: `N${i}`,
      nodeLabel: 'Milestone' as const,
      description: 'x'.repeat(2000),
    },
  }));
  const text = formatChatContext({
    systemPrompt: 'S',
    topicLabel: 'T',
    context: { nodes, edges: [] },
    scope: parseChatScope({ kind: 'custom', title: 'Big', totalNodeCount: 999 }),
  });
  assert.match(text, /… and 5 more nodes: N200, N201, N202, N203, N204/);
  assert.ok(!text.includes('x'.repeat(CHAT_CONTEXT_LIMITS.description + 1)));
});

test('scopes from the request are validated and trimmed', () => {
  assert.equal(parseChatScope(null), null);
  assert.equal(parseChatScope({ kind: 'evil' }), null);
  const scope = parseChatScope({
    kind: 'pathway',
    title: 'T'.repeat(500),
    totalNodeCount: -3,
    notes: 7,
    pathway: { targetLabel: 'X', stages: [{ title: 'S', nodeIds: ['a', 5] }], bottleneck: { nodeId: 3 } },
  })!;
  assert.equal(scope.title.length, 120);
  assert.equal(scope.totalNodeCount, 0);
  assert.equal(scope.notes, '');
  assert.deepEqual(scope.pathway?.stages, [{ title: 'S', nodeIds: ['a'] }]);
  assert.equal(scope.pathway?.bottleneck, null);
});
