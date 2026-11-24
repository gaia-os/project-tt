import { CompanyTechnologyMapping } from '@/lib/types';
import { normalizeRoleGroup } from '@/lib/reactorEntities';

/** A company's role on the tree, from its technology mappings. */
export type CompanyRole =
  | 'developer'
  | 'researcher'
  | 'manufacturer'
  | 'supplier'
  | 'programme'
  | 'other';

/** Highest first: a company with several roles takes the earliest. */
export const COMPANY_ROLE_ORDER: CompanyRole[] = [
  'developer',
  'researcher',
  'manufacturer',
  'supplier',
  'programme',
  'other',
];

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  developer: 'Developer',
  researcher: 'Researcher',
  manufacturer: 'Manufacturer',
  supplier: 'Supplier',
  programme: 'Programme / operator',
  other: 'Other',
};

/** Card accent (left border) and chip classes per role. */
export const COMPANY_ROLE_STYLES: Record<
  CompanyRole,
  { accent: string; chip: string; dot: string }
> = {
  developer: {
    accent: 'border-l-amber-500',
    chip: 'bg-amber-100 text-amber-900',
    dot: 'bg-amber-500',
  },
  researcher: {
    accent: 'border-l-violet-500',
    chip: 'bg-violet-100 text-violet-900',
    dot: 'bg-violet-500',
  },
  manufacturer: {
    accent: 'border-l-sky-500',
    chip: 'bg-sky-100 text-sky-900',
    dot: 'bg-sky-500',
  },
  supplier: {
    accent: 'border-l-emerald-500',
    chip: 'bg-emerald-100 text-emerald-900',
    dot: 'bg-emerald-500',
  },
  programme: {
    accent: 'border-l-rose-500',
    chip: 'bg-rose-100 text-rose-900',
    dot: 'bg-rose-500',
  },
  other: {
    accent: 'border-l-slate-400',
    chip: 'bg-slate-100 text-slate-700',
    dot: 'bg-slate-400',
  },
};

function mappingRole(mapping: CompanyTechnologyMapping): CompanyRole {
  if (mapping.is_primary || mapping.method?.toLowerCase() === 'develops') {
    return 'developer';
  }
  const raw = mapping.roles?.[0];
  if (raw && /research/i.test(raw)) return 'researcher';
  if (!raw) return mapping.method?.toLowerCase() === 'supplies' ? 'supplier' : 'other';
  return normalizeRoleGroup(raw);
}

/** The highest role across a company's mappings. */
export function companyRole(mappings: CompanyTechnologyMapping[]): CompanyRole {
  const roles = new Set(mappings.map(mappingRole));
  return COMPANY_ROLE_ORDER.find((role) => roles.has(role)) ?? 'other';
}
