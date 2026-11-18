import { TechTree } from '@/lib/types';

/** Calendar year the scheduler and the shipped simulation outputs start from. */
export const SIMULATION_BASE_YEAR = 2026;

/**
 * Years of work per readiness level. Base matches the scheduler; the
 * optimistic and cautious bounds match the Monte Carlo pace distribution.
 */
export const YEARS_PER_TRL = { optimistic: 1.5, base: 2.5, cautious: 3.5 } as const;

export interface ScheduleFields {
  trl_current?: string;
  trl_projected_5_10_years?: string;
}

export interface DeploymentWindow {
  optimistic: number;
  base: number;
  cautious: number;
}

/**
 * Years of work left before a node is complete: (9 - TRL) levels at
 * `yearsPerTrl` each. A node with a 5-10 year projection counts as three
 * levels; an unparseable TRL counts as two.
 */
export function nodeDurationYears(
  node: ScheduleFields,
  yearsPerTrl: number = YEARS_PER_TRL.base,
): number {
  if (node.trl_projected_5_10_years) return 3 * yearsPerTrl;
  const trl = Number.parseFloat((node.trl_current || '1').split('-')[0].split(' ')[0]);
  if (!Number.isFinite(trl)) return 2 * yearsPerTrl;
  return Math.max(0, 9 - trl) * yearsPerTrl;
}

export interface ScheduleIndex {
  fieldsById: Map<string, ScheduleFields>;
  prerequisites: Map<string, string[]>;
}

export function createScheduleIndex(tree: TechTree): ScheduleIndex {
  const fieldsById = new Map<string, ScheduleFields>(
    tree.nodes.map((node) => [node.id, node.data]),
  );
  const prerequisites = new Map<string, string[]>();
  for (const edge of tree.edges) {
    if (!fieldsById.has(edge.source) || !fieldsById.has(edge.target)) continue;
    const list = prerequisites.get(edge.target);
    if (list) list.push(edge.source);
    else prerequisites.set(edge.target, [edge.source]);
  }
  return { fieldsById, prerequisites };
}

/**
 * Earliest completion year of a node under the scheduler rule: its own
 * duration after its slowest prerequisite finishes. Cycles are ignored
 * rather than treated as infinite.
 */
export function estimateCompletionYear(
  index: ScheduleIndex,
  nodeId: string,
  yearsPerTrl: number = YEARS_PER_TRL.base,
): number | null {
  if (!index.fieldsById.has(nodeId)) return null;
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const totalYears = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    let slowestPrerequisite = 0;
    for (const prerequisite of index.prerequisites.get(id) ?? []) {
      slowestPrerequisite = Math.max(slowestPrerequisite, totalYears(prerequisite));
    }
    visiting.delete(id);
    const result =
      nodeDurationYears(index.fieldsById.get(id)!, yearsPerTrl) + slowestPrerequisite;
    memo.set(id, result);
    return result;
  };

  return Math.round(SIMULATION_BASE_YEAR + totalYears(nodeId));
}

/** Optimistic, base and cautious completion years of one node. */
export function estimateDeploymentWindow(
  tree: TechTree,
  nodeId: string,
  index: ScheduleIndex = createScheduleIndex(tree),
): DeploymentWindow | null {
  const base = estimateCompletionYear(index, nodeId, YEARS_PER_TRL.base);
  if (base === null) return null;
  return {
    optimistic: estimateCompletionYear(index, nodeId, YEARS_PER_TRL.optimistic)!,
    base,
    cautious: estimateCompletionYear(index, nodeId, YEARS_PER_TRL.cautious)!,
  };
}
