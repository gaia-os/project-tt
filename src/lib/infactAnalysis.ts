import type { SmrInfactAnalysis } from '@/lib/types';

export type SmrInfactAnalysisSummary = Omit<SmrInfactAnalysis, 'has_report'>;

export function infactAnalysisSlug(nodeLabel: string): string {
  return nodeLabel.toLowerCase().replace(/ /g, '-').replace(/\//g, '-');
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const unitIntervalNumber = (value: unknown): value is number =>
  finiteNumber(value) && value >= 0 && value <= 1;

export function extractLatestInfactAnalysis(
  payload: unknown,
): SmrInfactAnalysisSummary | null {
  if (!isRecord(payload)) return null;
  const nodeLabel = payload.node_label;
  const trlCurrent = payload.trl_current;
  const evidence = payload.evidence;
  if (
    typeof nodeLabel !== 'string' ||
    typeof trlCurrent !== 'string' ||
    !Array.isArray(evidence)
  ) {
    return null;
  }

  const latest = evidence[evidence.length - 1];
  if (!isRecord(latest) || !unitIntervalNumber(latest.probability)) return null;
  const interval = latest.interval;
  if (
    !Array.isArray(interval) ||
    interval.length < 2 ||
    !unitIntervalNumber(interval[0]) ||
    !unitIntervalNumber(interval[1])
  ) {
    return null;
  }

  return {
    node_label: nodeLabel,
    trl_current: trlCurrent,
    probability: latest.probability,
    interval: [interval[0], interval[1]],
    evidence_count: evidence.length,
  };
}

export function formatInfactPercent(probability: number): string {
  const percent = probability * 100;
  if (percent > 0 && percent < 0.05) return '<0.1%';
  return `${percent.toFixed(1)}%`;
}

export function infactProbabilityColorClass(probability: number): string {
  if (probability < 0.2) return 'border-transparent bg-red-600 text-white';
  if (probability < 0.4) return 'border-transparent bg-red-400 text-red-950';
  if (probability < 0.6)
    return 'border-transparent bg-yellow-300 text-yellow-950';
  if (probability < 0.8)
    return 'border-transparent bg-green-300 text-green-950';
  return 'border-transparent bg-green-600 text-white';
}
