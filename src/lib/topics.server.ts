/**
 * Server-side topic discovery.
 *
 * A topic = a seeded tech-tree database. Primary source: MongoDB
 * `listDatabases` — every non-system database with a `nodes` collection is a
 * topic (the docker image only ships .next/standalone, so `data/` is not
 * guaranteed to exist at runtime). Fallback for dev setups whose DB user
 * can't run listDatabases: scan `data/extracted/*` for folders containing
 * `technologies/graph.json`.
 *
 * Per-dataset metadata (display label, chat system prompt) comes from the
 * `meta` document the seeder writes from `dataset.json`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DatasetMeta,
  dbNameForTopic,
  defaultSystemPrompt,
  titleizeLabel,
  TopicConfig,
  TopicKey,
} from '@/lib/topicConfig';

const SYSTEM_DBS = new Set(['admin', 'config', 'local']);
const EXTRACTED_DIR = path.join(process.cwd(), 'data', 'extracted');
const CACHE_TTL_MS = 15_000;

let cache: { topics: TopicConfig[]; at: number } | null = null;

function metaToConfig(id: string, meta: DatasetMeta | null | undefined): TopicConfig {
  const label = meta?.label ?? titleizeLabel(id);
  return {
    id,
    label,
    dbName: dbNameForTopic(id),
    systemPrompt: meta?.systemPrompt ?? defaultSystemPrompt(label),
  };
}

async function topicsFromMongo(): Promise<TopicConfig[]> {
  // Lazy import: @/lib/mongodb rejects at module load when MONGODB_URI is unset.
  const { default: clientPromise } = await import('@/lib/mongodb');
  const client = await clientPromise;
  const { databases } = await client.db('admin').admin().listDatabases();
  const topics: TopicConfig[] = [];
  for (const { name } of databases) {
    if (!name || SYSTEM_DBS.has(name)) continue;
    const db = client.db(name);
    const meta = await db.collection('meta').findOne<DatasetMeta>({});
    if (!meta) {
      // Unseeded foreign DBs (no meta doc) only count if they look like a tree.
      const hasNodes = await db.listCollections({ name: 'nodes' }).hasNext();
      if (!hasNodes) continue;
    }
    topics.push(metaToConfig(name, meta));
  }
  return topics;
}

function topicsFromFilesystem(): TopicConfig[] {
  try {
    return fs
      .readdirSync(EXTRACTED_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .filter((e) => fs.existsSync(path.join(EXTRACTED_DIR, e.name, 'technologies', 'graph.json')))
      .map((e) => {
        let meta: DatasetMeta | null = null;
        try {
          meta = JSON.parse(fs.readFileSync(path.join(EXTRACTED_DIR, e.name, 'dataset.json'), 'utf8'));
        } catch {
          /* no dataset.json — defaults */
        }
        return metaToConfig(e.name, meta);
      });
  } catch {
    return [];
  }
}

/** All available topics, sorted by label. Cached briefly to avoid a listDatabases round-trip per request. */
export async function listTopics(): Promise<TopicConfig[]> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.topics;
  let topics: TopicConfig[] = [];
  try {
    topics = await topicsFromMongo();
  } catch {
    // DB user may lack listDatabases (e.g. scoped Atlas users) — fall back to folders.
  }
  if (!topics.length) topics = topicsFromFilesystem();
  topics.sort((a, b) => a.label.localeCompare(b.label));
  cache = { topics, at: Date.now() };
  return topics;
}

/** Resolve a topic id (folder/DB name) to its config, or null if unknown. */
export async function getTopic(id: TopicKey | null | undefined): Promise<TopicConfig | null> {
  if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) return null;
  return (await listTopics()).find((t) => t.id === id) ?? null;
}
