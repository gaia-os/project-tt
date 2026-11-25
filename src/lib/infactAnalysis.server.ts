import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SmrInfactAnalysis } from '@/lib/types';
import {
  extractLatestInfactAnalysis,
  infactAnalysisSlug,
} from '@/lib/infactAnalysis';
import type { TopicKey } from '@/lib/topicConfig';

function infactDetailsDirectory(topic: TopicKey): string {
  return path.resolve(
    process.cwd(),
    'data',
    'extracted',
    topic,
    'infact-smr-analysis',
    'nodes',
    'node-infact-details',
  );
}

function infactFilePath(
  topic: TopicKey,
  nodeLabel: string,
  extension: 'json' | 'html',
): string | null {
  const directory = infactDetailsDirectory(topic);
  const filePath = path.resolve(
    directory,
    `${infactAnalysisSlug(nodeLabel)}.${extension}`,
  );
  return filePath.startsWith(`${directory}${path.sep}`) ? filePath : null;
}

async function fileExists(filePath: string | null): Promise<boolean> {
  if (!filePath) return false;
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export async function readSmrInfactAnalysis(
  topic: TopicKey,
  nodeLabel: string,
): Promise<SmrInfactAnalysis | null> {
  const jsonPath = infactFilePath(topic, nodeLabel, 'json');
  if (!jsonPath) return null;

  let raw: string;
  try {
    raw = await fs.readFile(jsonPath, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) {
      console.warn(`Could not read InFact analysis ${jsonPath}:`, error);
    }
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    console.warn(`Could not parse InFact analysis ${jsonPath}:`, error);
    return null;
  }

  const analysis = extractLatestInfactAnalysis(payload);
  if (!analysis) return null;
  if (analysis.node_label !== nodeLabel) {
    console.warn(
      `Ignoring InFact analysis ${jsonPath}: label "${analysis.node_label}" does not match "${nodeLabel}"`,
    );
    return null;
  }

  return {
    ...analysis,
    has_report: await fileExists(infactFilePath(topic, nodeLabel, 'html')),
  };
}

export async function readSmrInfactAnalysisReport(
  topic: TopicKey,
  nodeLabel: string,
): Promise<string | null> {
  const analysis = await readSmrInfactAnalysis(topic, nodeLabel);
  if (!analysis?.has_report) return null;
  const htmlPath = infactFilePath(topic, nodeLabel, 'html');
  if (!htmlPath) return null;
  try {
    return await fs.readFile(htmlPath, 'utf8');
  } catch (error) {
    if (!isMissingFile(error)) {
      console.warn(`Could not read InFact report ${htmlPath}:`, error);
    }
    return null;
  }
}
