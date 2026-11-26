/**
 * scripts/seed-infact-analysis.ts
 *
 * Refreshes only the derived `infact_analyses` collection for one seeded
 * dataset, using node_details already present in MongoDB to map InFact
 * node_label values to technology node ids. Unlike scripts/seed-dataset.ts,
 * this does not replace the rest of the database.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/seed-infact-analysis.ts <folder>
 *
 * Optional env:
 *   MONGODB_DB_NAME override the database name (default: folder name)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Document, MongoClient } from 'mongodb';
import {
  infactAnalysisDetailsDirectory,
  loadInfactAnalysisDocuments,
} from '@/lib/infactAnalysisIngestion.server';

const ROOT = path.resolve(__dirname, '..');
const DATASET = process.argv[2];
if (!DATASET) {
  console.error(
    'usage: npx tsx --env-file=.env.local scripts/seed-infact-analysis.ts <folder>',
  );
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]+$/.test(DATASET)) {
  console.error(`Invalid dataset name "${DATASET}"`);
  process.exit(1);
}

const DATA_DIR = path.join(ROOT, 'data/extracted', DATASET);
const DB_NAME = process.env.MONGODB_DB_NAME ?? DATASET;
const BATCH_SIZE = 100;

async function main() {
  if (!fs.existsSync(path.join(DATA_DIR, 'technologies', 'graph.json'))) {
    throw new Error(`No dataset at ${DATA_DIR}`);
  }
  const detailsDir = infactAnalysisDetailsDirectory(DATA_DIR);
  if (!fs.existsSync(detailsDir)) {
    console.log(
      `No InFact analysis directory at ${detailsDir}; database left unchanged`,
    );
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const technologies = await db
      .collection('node_details')
      .find({ kind: 'technology' }, { projection: { _id: 0, id: 1, name: 1 } })
      .toArray();
    const technologyIdsByName = new Map<string, string>();
    for (const technology of technologies) {
      if (
        typeof technology.id === 'string' &&
        typeof technology.name === 'string' &&
        !technologyIdsByName.has(technology.name)
      ) {
        technologyIdsByName.set(technology.name, technology.id);
      }
    }

    const ingestion = loadInfactAnalysisDocuments(
      DATA_DIR,
      technologyIdsByName,
    );
    const docs = ingestion.documents.map(
      (document) => ({ ...document }) as Document,
    );
    console.log(`Parsed InFact analyses from ${detailsDir}:`);
    console.log(
      `  analyses         ${docs.length} (${docs.filter((d) => d.has_report).length} reports)`,
    );
    console.log(`  invalid files    ${ingestion.invalidFiles.length}`);
    console.log(`  unmatched labels ${ingestion.unmatchedLabels.length}`);
    console.log(`  duplicates       ${ingestion.duplicateLabels.length}`);

    if (!docs.length) {
      console.warn('  no valid InFact analyses found; database left unchanged');
      return;
    }

    const collection = db.collection('infact_analyses');
    await collection.createIndex({ id: 1 }, { unique: true });
    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      await collection.bulkWrite(
        docs.slice(i, i + BATCH_SIZE).map((document) => ({
          replaceOne: {
            filter: { id: document.id },
            replacement: document,
            upsert: true,
          },
        })),
      );
    }
    await collection.deleteMany({
      id: { $nin: docs.map((document) => document.id) },
    });
    console.log(`  wrote ${DB_NAME}.infact_analyses: ${docs.length}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
