import { NodeLabel } from '@/lib/types';

/** Plain-language labels for graph roles (never show the raw enum). */
export const NODE_ROLE_LABELS: Record<NodeLabel, string> = {
  ReactorConcept: 'Deployment concept',
  Milestone: 'Milestone',
  EnablingTechnology: 'Enabling technology',
};

export function nodeRoleLabel(role: NodeLabel | string | undefined): string {
  if (!role) return 'Unknown';
  return NODE_ROLE_LABELS[role as NodeLabel] ?? role;
}

/** Plural role names, used for aggregated groups ("12 Milestones"). */
export const NODE_ROLE_PLURAL_LABELS: Record<NodeLabel, string> = {
  ReactorConcept: 'Deployment concepts',
  Milestone: 'Milestones',
  EnablingTechnology: 'Enabling technologies',
};

export function nodeRolePluralLabel(
  role: NodeLabel | string | undefined,
): string {
  if (!role) return 'Unknown';
  return NODE_ROLE_PLURAL_LABELS[role as NodeLabel] ?? role;
}
