import { TechTree } from '@/lib/types';
import { TopicKey, isTopicKey } from '@/lib/topicConfig';

/*
 * Custom trees: named subsets of a topic's tech tree that a visitor builds
 * and keeps in this browser. Only node ids are stored; the nodes and the
 * links between them come from the live tree, so a custom tree follows
 * edits to the underlying data (ids deleted since are reported as missing).
 */

export const CUSTOM_TREES_STORAGE_KEY = 'tt-custom-trees-v1';
const STORAGE_VERSION = 1;

export const MAX_TREE_NAME_LENGTH = 80;
export const MAX_TREE_NOTES_LENGTH = 1000;
const MAX_TREES = 200;
const MAX_NODE_IDS = 5000;
const MAX_NODE_ID_LENGTH = 300;
const UNTITLED = 'Untitled tree';

export const CUSTOM_TREE_ORIGINS = [
  'pathway',
  'connected',
  'view',
  'builder',
  'copy',
  'import',
] as const;
export type CustomTreeOriginKind = (typeof CUSTOM_TREE_ORIGINS)[number];

export interface CustomTreeOrigin {
  kind: CustomTreeOriginKind;
  /** What it was made from, e.g. the pathway target's name. */
  label: string;
}

export interface CustomTree {
  id: string;
  name: string;
  topic: TopicKey;
  /** Chosen nodes, in the order they were added. */
  nodeIds: string[];
  /** The builder's own words about the tree; the assistant sees them. */
  notes: string;
  origin: CustomTreeOrigin;
  createdAt: number;
  updatedAt: number;
}

export interface NewTreeInput {
  name: string;
  topic: TopicKey;
  nodeIds: Iterable<string>;
  notes?: string;
  origin: CustomTreeOrigin;
}

export type CustomTreePatch = Partial<Pick<CustomTree, 'name' | 'notes'>> & {
  nodeIds?: Iterable<string>;
};

export function newTreeId(random: () => number = Math.random): string {
  return `ct_${Date.now().toString(36)}${random().toString(36).slice(2, 8)}`;
}

function cleanName(name: unknown): string {
  const text = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  return text.slice(0, MAX_TREE_NAME_LENGTH) || UNTITLED;
}

function cleanNotes(notes: unknown): string {
  return typeof notes === 'string' ? notes.trim().slice(0, MAX_TREE_NOTES_LENGTH) : '';
}

function cleanNodeIds(ids: Iterable<unknown>): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || !id || id.length > MAX_NODE_ID_LENGTH) continue;
    unique.add(id);
    if (unique.size >= MAX_NODE_IDS) break;
  }
  return [...unique];
}

function isOriginKind(value: unknown): value is CustomTreeOriginKind {
  return (
    typeof value === 'string' &&
    (CUSTOM_TREE_ORIGINS as readonly string[]).includes(value)
  );
}

/** A stored or imported tree, or null if it is unusable. */
export function sanitizeTree(value: unknown): CustomTree | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !/^ct_[\w-]{1,64}$/.test(record.id)) {
    return null;
  }
  if (!isTopicKey(record.topic) || !Array.isArray(record.nodeIds)) return null;
  const origin = record.origin as Record<string, unknown> | undefined;
  const createdAt = Number(record.createdAt);
  const updatedAt = Number(record.updatedAt);
  return {
    id: record.id,
    name: cleanName(record.name),
    topic: record.topic,
    nodeIds: cleanNodeIds(record.nodeIds),
    notes: cleanNotes(record.notes),
    origin: {
      kind: isOriginKind(origin?.kind) ? origin.kind : 'builder',
      label: typeof origin?.label === 'string' ? origin.label.slice(0, 200) : '',
    },
    createdAt: Number.isFinite(createdAt) ? createdAt : 0,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function treesFrom(value: unknown): CustomTree[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as { trees?: unknown }).trees
      : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const trees: CustomTree[] = [];
  for (const entry of list) {
    const tree = sanitizeTree(entry);
    if (!tree || seen.has(tree.id)) continue;
    seen.add(tree.id);
    trees.push(tree);
    if (trees.length >= MAX_TREES) break;
  }
  return trees;
}

/** Trees saved under `CUSTOM_TREES_STORAGE_KEY`; bad data is dropped. */
export function parseStoredTrees(raw: string | null): CustomTree[] {
  if (!raw) return [];
  try {
    return treesFrom(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function serializeTrees(trees: CustomTree[]): string {
  return JSON.stringify({ version: STORAGE_VERSION, trees });
}

/** `name`, or `name (2)`, `name (3)`… if the topic already has one. */
export function uniqueTreeName(
  trees: CustomTree[],
  topic: TopicKey,
  name: string,
  exceptId?: string,
): string {
  const base = cleanName(name);
  const taken = new Set(
    trees
      .filter((tree) => tree.topic === topic && tree.id !== exceptId)
      .map((tree) => tree.name.toLowerCase()),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, MAX_TREE_NAME_LENGTH - 5)} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function createTree(
  trees: CustomTree[],
  input: NewTreeInput,
  now: number = Date.now(),
  id: string = newTreeId(),
): { trees: CustomTree[]; tree: CustomTree } {
  const tree: CustomTree = {
    id,
    name: uniqueTreeName(trees, input.topic, input.name),
    topic: input.topic,
    nodeIds: cleanNodeIds(input.nodeIds),
    notes: cleanNotes(input.notes),
    origin: {
      kind: input.origin.kind,
      label: input.origin.label.slice(0, 200),
    },
    createdAt: now,
    updatedAt: now,
  };
  // Newest first; the cap drops the oldest.
  return { trees: [tree, ...trees].slice(0, MAX_TREES), tree };
}

export function updateTree(
  trees: CustomTree[],
  id: string,
  patch: CustomTreePatch,
  now: number = Date.now(),
): CustomTree[] {
  return trees.map((tree) =>
    tree.id === id
      ? {
          ...tree,
          ...(patch.name !== undefined
            ? { name: uniqueTreeName(trees, tree.topic, patch.name, id) }
            : {}),
          ...(patch.notes !== undefined ? { notes: cleanNotes(patch.notes) } : {}),
          ...(patch.nodeIds !== undefined
            ? { nodeIds: cleanNodeIds(patch.nodeIds) }
            : {}),
          updatedAt: now,
        }
      : tree,
  );
}

export function removeTree(trees: CustomTree[], id: string): CustomTree[] {
  return trees.filter((tree) => tree.id !== id);
}

export function duplicateTree(
  trees: CustomTree[],
  id: string,
  now: number = Date.now(),
  newId: string = newTreeId(),
): { trees: CustomTree[]; tree: CustomTree } | null {
  const source = trees.find((tree) => tree.id === id);
  if (!source) return null;
  return createTree(
    trees,
    {
      name: `${source.name} copy`,
      topic: source.topic,
      nodeIds: source.nodeIds,
      notes: source.notes,
      origin: { kind: 'copy', label: source.name },
    },
    now,
    newId,
  );
}

/** A file a visitor can keep or hand to someone else. */
export function exportTrees(trees: CustomTree[], now: number = Date.now()): string {
  return JSON.stringify(
    { format: 'investment-tech-tree/custom-trees', version: STORAGE_VERSION, exportedAt: now, trees },
    null,
    2,
  );
}

export type ImportResult =
  | { ok: true; trees: CustomTree[]; imported: CustomTree[]; skipped: number }
  | { ok: false; error: string };

/**
 * Adds the trees in an exported file. Ids that already exist get new ones
 * (so importing twice makes copies instead of overwriting), and names are
 * kept unique per topic.
 */
export function importTrees(
  existing: CustomTree[],
  json: string,
  now: number = Date.now(),
  makeId: () => string = newTreeId,
): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { trees?: unknown } | null)?.trees;
  if (!Array.isArray(list)) {
    return { ok: false, error: 'No trees found in that file.' };
  }
  const incoming = treesFrom(list);
  let trees = existing;
  const imported: CustomTree[] = [];
  const ids = new Set(existing.map((tree) => tree.id));
  for (const tree of incoming) {
    const id = ids.has(tree.id) ? makeId() : tree.id;
    ids.add(id);
    const added: CustomTree = {
      ...tree,
      id,
      name: uniqueTreeName(trees, tree.topic, tree.name),
      createdAt: tree.createdAt || now,
      updatedAt: now,
    };
    trees = [added, ...trees];
    imported.push(added);
  }
  return {
    ok: true,
    trees: trees.slice(0, MAX_TREES),
    imported,
    skipped: list.length - incoming.length,
  };
}

/** The nodes in `ids` and the links between them, in tree order. */
export function inducedSubtree(base: TechTree, ids: Iterable<string>): TechTree {
  const keep = ids instanceof Set ? (ids as Set<string>) : new Set(ids);
  return {
    nodes: base.nodes.filter((node) => keep.has(node.id)),
    edges: base.edges.filter(
      (edge) => keep.has(edge.source) && keep.has(edge.target),
    ),
  };
}

/** A custom tree drawn from the live data, plus ids that no longer exist. */
export function resolveCustomTree(
  base: TechTree,
  custom: Pick<CustomTree, 'nodeIds'>,
): { tree: TechTree; missingIds: string[] } {
  const present = new Set(base.nodes.map((node) => node.id));
  return {
    tree: inducedSubtree(base, custom.nodeIds),
    missingIds: custom.nodeIds.filter((id) => !present.has(id)),
  };
}

function closure(
  tree: TechTree,
  ids: Iterable<string>,
  direction: 'up' | 'down',
): Set<string> {
  const next = new Map<string, string[]>();
  for (const edge of tree.edges) {
    const [from, to] =
      direction === 'up' ? [edge.target, edge.source] : [edge.source, edge.target];
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  }
  const start = new Set(ids);
  const found = new Set<string>();
  const queue = [...start];
  for (let head = 0; head < queue.length; head++) {
    for (const neighbour of next.get(queue[head]) ?? []) {
      if (start.has(neighbour) || found.has(neighbour)) continue;
      found.add(neighbour);
      queue.push(neighbour);
    }
  }
  return found;
}

/** Every prerequisite (direct or not) of `ids`, excluding `ids` themselves. */
export function ancestorsOf(tree: TechTree, ids: Iterable<string>): Set<string> {
  return closure(tree, ids, 'up');
}

/** Everything `ids` unlock (directly or not), excluding `ids` themselves. */
export function descendantsOf(tree: TechTree, ids: Iterable<string>): Set<string> {
  return closure(tree, ids, 'down');
}

export interface TreeOverlap {
  shared: string[];
  onlyA: string[];
  onlyB: string[];
}

export function treeOverlap(a: Iterable<string>, b: Iterable<string>): TreeOverlap {
  const left = new Set(a);
  const right = new Set(b);
  return {
    shared: [...left].filter((id) => right.has(id)),
    onlyA: [...left].filter((id) => !right.has(id)),
    onlyB: [...right].filter((id) => !left.has(id)),
  };
}
