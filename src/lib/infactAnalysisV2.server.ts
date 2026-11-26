import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  extractInfactV2Analysis,
  infactAnalysisSlug,
} from '@/lib/infactAnalysis';
import type { SmrInfactAnalysis } from '@/lib/types';

export interface SmrInfactV2Document {
  analysis: SmrInfactAnalysis;
  reportPath: string | null;
  slug: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function infactV2DetailsDirectory(): string {
  return (
    process.env.INFACT_V2_DETAILS_DIR ||
    path.join(process.cwd(), 'outputs', 'infact-v2', 'node-infact-details')
  );
}

function artifactPath(
  detailsDirectory: string,
  slug: string,
  extension: 'json' | 'html',
): string | null {
  if (!slug) return null;
  const root = path.resolve(detailsDirectory);
  const candidate = path.resolve(root, `${slug}.${extension}`);
  return path.dirname(candidate) === root ? candidate : null;
}

export function loadSmrInfactV2Analysis(
  nodeId: string,
  nodeLabel: string,
  detailsDirectory = infactV2DetailsDirectory(),
): SmrInfactV2Document | null {
  const slug = infactAnalysisSlug(nodeLabel);
  const jsonPath = artifactPath(detailsDirectory, slug, 'json');
  if (!jsonPath || !fs.existsSync(jsonPath)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return null;
  }

  const summary = extractInfactV2Analysis(payload);
  if (!summary || summary.node_label !== nodeLabel) return null;
  if (isRecord(payload)) {
    const payloadNodeId = payload.node_id;
    if (typeof payloadNodeId === 'string' && payloadNodeId !== nodeId) {
      return null;
    }
  }

  const reportPath = artifactPath(detailsDirectory, slug, 'html');
  const hasReport = reportPath !== null && fs.existsSync(reportPath);
  return {
    analysis: { ...summary, has_report: hasReport },
    reportPath: hasReport ? reportPath : null,
    slug,
  };
}

export function readSmrInfactV2Report(
  document: SmrInfactV2Document,
): string | null {
  if (!document.reportPath) return null;
  try {
    return fs.readFileSync(document.reportPath, 'utf8');
  } catch {
    return null;
  }
}
