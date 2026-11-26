import clientPromise from '@/lib/mongodb';
import { parseSmrInfactAnalysis } from '@/lib/infactAnalysis';
import type { SmrInfactAnalysis } from '@/lib/types';

const COLLECTION = 'infact_analyses';

export async function readSmrInfactAnalysis(
  dbName: string,
  nodeId: string,
): Promise<SmrInfactAnalysis | null> {
  const client = await clientPromise;
  const document = await client
    .db(dbName)
    .collection(COLLECTION)
    .findOne(
      { id: nodeId },
      {
        projection: {
          _id: 0,
          node_label: 1,
          trl_current: 1,
          probability: 1,
          interval: 1,
          evidence_count: 1,
          has_report: 1,
        },
      },
    );
  return parseSmrInfactAnalysis(document);
}

export async function readSmrInfactAnalysisReport(
  dbName: string,
  nodeId: string,
): Promise<string | null> {
  const client = await clientPromise;
  const document = await client
    .db(dbName)
    .collection(COLLECTION)
    .findOne({ id: nodeId }, { projection: { _id: 0, report_html: 1 } });
  return typeof document?.report_html === 'string'
    ? document.report_html
    : null;
}
