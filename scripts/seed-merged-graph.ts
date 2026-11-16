/**
 * scripts/seed-merged-graph.ts
 *
 * Seeds a merged tech-tree dataset into MongoDB directly from
 * `technologies/graph.json` (no markdown frontmatter required).
 *
 * Writes the same collections the app reads:
 *   meta          dataset label / chat system prompt (from dataset.json)
 *   nodes         lean graph nodes (reactors + technologies + orgs)
 *   edges         ENABLES relations (tech->tech, tech->reactor)
 *   node_details  rich per-node payload built from graph.json fields
 *
 * Skips images / companies / geocoding (no markdown sources to read).
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-merged-graph.ts <folder>
 *
 * Optional env:
 *   MONGODB_DB_NAME  override the database name (default: folder name)
 *   DRY_RUN=true      parse + report, don't touch MongoDB
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Document, MongoClient } from 'mongodb';

const ROOT = path.resolve(__dirname, '..');
const DATASET = process.argv[2];
if (!DATASET) {
  console.error('usage: npx tsx --env-file=.env.local scripts/seed-merged-graph.ts <folder>');
  console.error('       (folder under data/extracted/, e.g. "merged")');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]+$/.test(DATASET)) {
  console.error(`Invalid dataset name "${DATASET}" — use only letters, digits, - and _.`);
  process.exit(1);
}
const DATA_DIR = path.join(ROOT, 'data/extracted', DATASET);
if (!fs.existsSync(path.join(DATA_DIR, 'technologies', 'graph.json'))) {
  console.error(`No dataset at ${DATA_DIR} — expected technologies/graph.json inside the folder.`);
  process.exit(1);
}
const DB_NAME = process.env.MONGODB_DB_NAME ?? DATASET;
const DRY_RUN = process.env.DRY_RUN === 'true';

type Yaml = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface GraphJson {
  nodes: Yaml[];
  edges: Yaml[];
}

const graph: GraphJson = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'technologies/graph.json'), 'utf8'),
);

let datasetMeta: Document = {};
try {
  datasetMeta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'dataset.json'), 'utf8'));
} catch {
  /* no dataset.json — selector falls back to the folder name */
}

// ---------------------------------------------------------------------------
// Category labels (mirror scripts/seed-dataset.ts)
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string> = {
  component: 'Component',
  system: 'System',
  material: 'Material',
  process: 'Process',
  software_method: 'Software & methods',
  instrumentation_control: 'Instrumentation & control',
  manufacturing: 'Manufacturing',
  fuel: 'Fuel',
};

const TYPE_TO_NODELABEL: Record<string, string> = {
  Technology: 'EnablingTechnology',
  ReactorDesign: 'ReactorConcept',
  Organisation: 'Organisation',
};

// ---------------------------------------------------------------------------
// Build nodes + node_details from graph.json
// ---------------------------------------------------------------------------
const nodeDocs: Document[] = [];
const detailDocs: Document[] = [];

for (const n of graph.nodes) {
  const label = n.label as string;
  const id = n.id as string;
  const name = n.name as string;
  const importance = (n.importance ?? {}) as Yaml;
  const mergedFrom = (n.merged_from ?? []) as string[];

  const nodeLabel = TYPE_TO_NODELABEL[label] ?? label;

  if (label === 'ReactorDesign') {
    nodeDocs.push({
      id,
      label: name,
      type: nodeLabel,
      category: n.category ?? null,
      subtype: n.subtype ?? null,
      description: n.description ?? null,
      references: [],
      smr: {
        kind: 'reactor',
        status: null,
        status_level: null,
        coverage: null,
        electric_mwe: null,
        thermal_mwth: null,
        coolant: null,
        neutron_spectrum: null,
        countries: [],
        developers: [],
        image_count: 0,
        cover_image_id: null,
      },
    });
    detailDocs.push({
      id,
      kind: 'reactor',
      name,
      aliases: [],
      technology_line: null,
      coverage: null,
      developers: [],
      countries: [],
      headquarters: null,
      sources: [],
      status: null,
      classification: { coolant: null, reactor_type: null, reactor_type_label: null, deployment: [], applications: [] },
      specs: [],
      assessment: [],
      milestones: [],
      financing: [],
      sections: [],
      images: [],
      regulators: [],
      organisations: [],
      merged_from: mergedFrom,
    });
  } else if (label === 'Technology') {
    nodeDocs.push({
      id,
      label: name,
      type: nodeLabel,
      category: CATEGORY_LABELS[n.category as string] ?? n.category ?? 'Other',
      subtype: importance.abstraction ?? null,
      trl_current: undefined,
      description: null,
      references: [],
      smr: {
        kind: 'technology',
        relevance: importance.decision_relevance ?? 0,
        importance_score: importance.score ?? null,
        reactor_reach: importance.reactor_reach ?? null,
        tree_level: n.tree_level ?? null,
        origin: n.origin ?? null,
        availability: null,
      },
    });
    detailDocs.push({
      id,
      kind: 'technology',
      name,
      aliases: [],
      category: CATEGORY_LABELS[n.category as string] ?? n.category,
      origin: n.origin ?? null,
      tree_level: n.tree_level ?? null,
      importance: {
        score: importance.score ?? null,
        decision_relevance: importance.decision_relevance ?? null,
        reactor_reach: importance.reactor_reach ?? null,
        direct_reactors: importance.direct_reactors ?? null,
        enabled_descendants: importance.enabled_descendants ?? null,
        abstraction: importance.abstraction ?? null,
        rationale: importance.relevance_rationale ?? null,
      },
      description: null,
      source_descriptions: [],
      broader: [],
      narrower: [],
      enables: { reactors: [], technologies: [] },
      enabled_by: [],
      deployment: null,
      merged_from: mergedFrom,
    });
  } else if (label === 'Organisation') {
    // Organisations are not rendered as tree nodes by the app, but we still
    // record a node_details entry so the side panel can show something.
    detailDocs.push({
      id,
      kind: 'organisation',
      name,
      aliases: [],
      category: null,
      origin: n.origin ?? null,
      merged_from: mergedFrom,
    });
  }
}

// ---------------------------------------------------------------------------
// Edges (ENABLES only — matches app/api/tech-tree/route.ts expectations)
// ---------------------------------------------------------------------------
const nodeIds = new Set(nodeDocs.map((n) => n.id as string));

const edgeDocs = graph.edges
  .filter((e) => e.type === 'ENABLES' && nodeIds.has(e.source) && nodeIds.has(e.target))
  .map((e) => {
    const provenance: string[] = e.provenance ?? [];
    const sourceGraph = (e.source_graph ?? null) as string | null;
    const sourceBacked =
      provenance.some((p) => p === 'source' || p === 'literature') ||
      (e.verified === true && sourceGraph === 'both');
    return {
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      relation_type: e.relation_type ?? (e.target.startsWith('smr:') ? 'used_in_design' : null),
      provenance,
      source_backed: sourceBacked,
      verified: e.verified ?? null,
      source_graph: sourceGraph,
    };
  });

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
async function main() {
  const reactorCount = nodeDocs.filter((n) => n.type === 'ReactorConcept').length;
  const techCount = nodeDocs.filter((n) => n.type === 'EnablingTechnology').length;
  console.log(`Parsed from ${DATA_DIR}:`);
  console.log(`  nodes         ${nodeDocs.length} (${reactorCount} reactors, ${techCount} technologies)`);
  console.log(`  edges         ${edgeDocs.length} (${edgeDocs.filter((e) => e.source_backed).length} source-backed)`);
  console.log(`  node_details  ${detailDocs.length}`);

  if (DRY_RUN) {
    console.log('  DRY_RUN=true — not writing to MongoDB');
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    await db.collection('meta').deleteMany({});
    await db.collection('meta').insertOne({
      _id: 'meta',
      id: DATASET,
      ...datasetMeta,
      seeded_at: new Date().toISOString(),
    });
    const writes: [string, Document[], Document][] = [
      ['nodes', nodeDocs, { id: 1 }],
      ['edges', edgeDocs, { id: 1 }],
      ['node_details', detailDocs, { id: 1 }],
    ];
    for (const [name, docs, key] of writes) {
      const collection = db.collection(name);
      await collection.deleteMany({});
      for (let i = 0; i < docs.length; i += 1000) {
        await collection.insertMany(docs.slice(i, i + 1000));
      }
      await collection.createIndex(key, { unique: true });
      console.log(`  wrote ${DB_NAME}.${name}: ${docs.length}`);
    }
    await db.collection('edges').createIndex({ source: 1 });
    await db.collection('edges').createIndex({ target: 1 });
    await db.collection('node_details').createIndex({ kind: 1 });
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
