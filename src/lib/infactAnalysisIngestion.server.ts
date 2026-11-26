import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractLatestInfactAnalysis } from '@/lib/infactAnalysis';
import type { SmrInfactAnalysis } from '@/lib/types';

export interface StoredSmrInfactAnalysis extends SmrInfactAnalysis {
  id: string;
  slug: string;
  analysis: unknown;
  report_html: string | null;
  source_files: {
    analysis: string;
    report: string | null;
  };
}

export interface InfactIngestionResult {
  documents: StoredSmrInfactAnalysis[];
  invalidFiles: string[];
  unmatchedLabels: string[];
  duplicateLabels: string[];
  missingReports: string[];
}

export function infactAnalysisDetailsDirectory(datasetDir: string): string {
  return path.join(
    datasetDir,
    'infact-smr-analysis',
    'nodes',
    'node-infact-details',
  );
}

export function loadInfactAnalysisDocuments(
  datasetDir: string,
  technologyIdsByName: ReadonlyMap<string, string>,
): InfactIngestionResult {
  const result: InfactIngestionResult = {
    documents: [],
    invalidFiles: [],
    unmatchedLabels: [],
    duplicateLabels: [],
    missingReports: [],
  };
  const detailsDir = infactAnalysisDetailsDirectory(datasetDir);
  if (!fs.existsSync(detailsDir)) return result;

  const seenLabels = new Set<string>();
  const files = fs
    .readdirSync(detailsDir)
    .filter((file) => file.endsWith('.json'))
    .sort();

  for (const file of files) {
    const jsonPath = path.join(detailsDir, file);
    let payload: unknown;
    try {
      payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    } catch {
      result.invalidFiles.push(file);
      continue;
    }

    const summary = extractLatestInfactAnalysis(payload);
    if (!summary) {
      result.invalidFiles.push(file);
      continue;
    }

    const techId = technologyIdsByName.get(summary.node_label);
    if (!techId) {
      result.unmatchedLabels.push(summary.node_label);
      continue;
    }
    if (seenLabels.has(summary.node_label)) {
      result.duplicateLabels.push(summary.node_label);
      continue;
    }
    seenLabels.add(summary.node_label);

    const slug = file.replace(/\.json$/, '');
    const reportFile = `${slug}.html`;
    const reportPath = path.join(detailsDir, reportFile);
    let reportHtml: string | null = null;
    if (fs.existsSync(reportPath)) {
      try {
        reportHtml = fs.readFileSync(reportPath, 'utf8');
      } catch {
        result.missingReports.push(file);
      }
    } else {
      result.missingReports.push(file);
    }

    result.documents.push({
      id: techId,
      slug,
      ...summary,
      has_report: reportHtml !== null,
      analysis: payload,
      report_html: reportHtml,
      source_files: {
        analysis: file,
        report: reportHtml === null ? null : reportFile,
      },
    });
  }

  return result;
}
