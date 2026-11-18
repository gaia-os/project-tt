import {
  CompanySummary,
  CompanyTechnologyMapping,
  DataNode,
  SmrReactorMeta,
  TechTree,
} from '@/lib/types';
import { getCountryName } from '@/lib/geography';

/** Coarse reactor families used on the world-view filter panel. */
export const REACTOR_TYPE_OPTIONS = [
  'PWR',
  'BWR',
  'Molten salt',
  'HTGR',
  'Fast reactor',
  'Microreactor',
] as const;

export type ReactorTypeOption = (typeof REACTOR_TYPE_OPTIONS)[number];

export const POWER_CLASS_OPTIONS = [
  'Micro (<20 MWe)',
  'Small (20–300 MWe)',
  'Medium (300–700 MWe)',
  'Large (≥700 MWe)',
] as const;

export type PowerClassOption = (typeof POWER_CLASS_OPTIONS)[number];

/** Empty selection means "no restriction" for that dimension. */
export interface WorldViewFilters {
  reactorTypes: ReactorTypeOption[];
  coolants: string[];
  spectra: string[];
  powerClasses: PowerClassOption[];
  countries: string[];
  statusLevels: number[];
}

export const EMPTY_WORLD_FILTERS: WorldViewFilters = {
  reactorTypes: [],
  coolants: [],
  spectra: [],
  powerClasses: [],
  countries: [],
  statusLevels: [],
};

export interface WorldFilterOption<T extends string | number = string> {
  value: T;
  label: string;
  count: number;
}

export interface WorldFilterCatalog {
  reactorTypes: WorldFilterOption<ReactorTypeOption>[];
  coolants: WorldFilterOption[];
  spectra: WorldFilterOption[];
  powerClasses: WorldFilterOption<PowerClassOption>[];
  countries: WorldFilterOption[];
  statusLevels: WorldFilterOption<number>[];
}

/** Attributes derived from a company's mapped tech-tree nodes. */
export interface CompanyWorldFacets {
  companyId: string;
  reactorTypes: Set<ReactorTypeOption>;
  coolants: Set<string>;
  spectra: Set<string>;
  powerClasses: Set<PowerClassOption>;
  /** HQ + manufacturing ISO codes. */
  countries: Set<string>;
  statusLevels: Set<number>;
  statusLabels: Set<string>;
}

const NUCLEAR_CONCEPT_TO_TYPE: Record<string, ReactorTypeOption> = {
  concept_lwr_smr: 'PWR',
  concept_htgr: 'HTGR',
  concept_msr: 'Molten salt',
  concept_sfr: 'Fast reactor',
  concept_lfr: 'Fast reactor',
  concept_twr: 'Fast reactor',
};

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function asReactorMeta(node: DataNode): SmrReactorMeta | null {
  const smr = node.data.smr;
  return smr?.kind === 'reactor' ? smr : null;
}

/** Canonical IAEA ARIS development-status labels by level id. */
export const IAEA_STATUS_LABELS: Record<number, string> = {
  1: 'Conceptual design',
  2: 'Basic design',
  3: 'Detailed design',
  4: 'Regulatory review',
  5: 'Construction / operation',
};

/** Map free-text design labels onto one or more filter families. */
export function classifyReactorTypes(
  ...parts: Array<string | null | undefined>
): ReactorTypeOption[] {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return [];

  const matched: ReactorTypeOption[] = [];
  if (/\b(microreactors?|micro[\s-]?reactors?|heat[\s-]?pipes?|heatpipes?)\b/.test(text)) {
    matched.push('Microreactor');
  }
  if (/\b(molten[\s-]?salt|msr)\b/.test(text)) matched.push('Molten salt');
  if (/\b(htgr|htr|helium|gas[\s-]?cooled|high[\s-]?temp)\b/.test(text)) {
    matched.push('HTGR');
  }
  if (/\b(bwr|boiling)\b/.test(text)) matched.push('BWR');
  if (/\b(pwr|pressuri[sz]ed|ipwr|light[\s-]?water)\b/.test(text)) {
    matched.push('PWR');
  }
  if (
    /\b(fast|sfr|lfr|sodium|lead|liquid[\s-]?metal|breed|traveling[\s-]?wave|twr)\b/.test(
      text,
    )
  ) {
    matched.push('Fast reactor');
  }
  return matched;
}

/** @deprecated Prefer classifyReactorTypes; kept for call-site convenience. */
export function classifyReactorType(
  ...parts: Array<string | null | undefined>
): ReactorTypeOption | null {
  return classifyReactorTypes(...parts)[0] ?? null;
}

export function powerClassFromMwe(
  mwe: number | null | undefined,
): PowerClassOption | null {
  if (mwe == null || !Number.isFinite(mwe) || mwe < 0) return null;
  if (mwe < 20) return 'Micro (<20 MWe)';
  if (mwe < 300) return 'Small (20–300 MWe)';
  if (mwe < 700) return 'Medium (300–700 MWe)';
  return 'Large (≥700 MWe)';
}

function reactorTypesForNode(node: DataNode): ReactorTypeOption[] {
  const fromConcept = NUCLEAR_CONCEPT_TO_TYPE[node.id];
  if (fromConcept) return [fromConcept];

  const smr = asReactorMeta(node);
  return classifyReactorTypes(
    node.data.subtype,
    node.data.category,
    node.data.label,
    smr?.coolant,
  );
}

function collectFacetOptions<T extends string | number>(
  facets: CompanyWorldFacets[],
  pick: (facet: CompanyWorldFacets) => Iterable<T>,
  labelFor: (value: T) => string = (value) => String(value),
): WorldFilterOption<T>[] {
  const counts = new Map<T, number>();
  for (const facet of facets) {
    for (const value of pick(facet)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, label: labelFor(value), count }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        String(left.label).localeCompare(String(right.label)),
    );
}

/**
 * Build per-company facets from mapped tech-tree nodes plus company geography.
 */
export function buildCompanyWorldFacets(
  companies: CompanySummary[],
  mappings: CompanyTechnologyMapping[],
  techTree: TechTree | null,
): Map<string, CompanyWorldFacets> {
  const nodeById = new Map((techTree?.nodes ?? []).map((node) => [node.id, node]));
  const mappingsByCompany = new Map<string, CompanyTechnologyMapping[]>();
  for (const mapping of mappings) {
    const list = mappingsByCompany.get(mapping.company_id) ?? [];
    list.push(mapping);
    mappingsByCompany.set(mapping.company_id, list);
  }

  const facets = new Map<string, CompanyWorldFacets>();
  for (const company of companies) {
    const facet: CompanyWorldFacets = {
      companyId: company.id,
      reactorTypes: new Set(),
      coolants: new Set(),
      spectra: new Set(),
      powerClasses: new Set(),
      countries: new Set(),
      statusLevels: new Set(),
      statusLabels: new Set(),
    };

    if (company.country_iso) facet.countries.add(company.country_iso.toUpperCase());
    for (const country of company.manufacturing_countries) {
      facet.countries.add(country.toUpperCase());
    }

    for (const type of classifyReactorTypes(company.primary_approach)) {
      facet.reactorTypes.add(type);
    }

    const primaryNode = company.tech_tree_primary_node
      ? nodeById.get(company.tech_tree_primary_node)
      : undefined;
    if (primaryNode) {
      for (const type of reactorTypesForNode(primaryNode)) {
        facet.reactorTypes.add(type);
      }
    } else if (company.tech_tree_primary_node) {
      const fallback = NUCLEAR_CONCEPT_TO_TYPE[company.tech_tree_primary_node];
      if (fallback) facet.reactorTypes.add(fallback);
    }

    for (const mapping of mappingsByCompany.get(company.id) ?? []) {
      const node = nodeById.get(mapping.tech_tree_node_id);
      if (!node) {
        const fallback = NUCLEAR_CONCEPT_TO_TYPE[mapping.tech_tree_node_id];
        if (fallback) facet.reactorTypes.add(fallback);
        continue;
      }
      for (const type of reactorTypesForNode(node)) facet.reactorTypes.add(type);
      const smr = asReactorMeta(node);
      if (!smr) continue;
      if (smr.coolant) facet.coolants.add(titleCase(smr.coolant));
      if (smr.neutron_spectrum) facet.spectra.add(titleCase(smr.neutron_spectrum));
      const powerClass = powerClassFromMwe(smr.electric_mwe);
      if (powerClass) facet.powerClasses.add(powerClass);
      if (smr.status_level != null) facet.statusLevels.add(smr.status_level);
      if (smr.status) facet.statusLabels.add(smr.status);
      for (const country of smr.countries) {
        facet.countries.add(country.toUpperCase());
      }
    }

    facets.set(company.id, facet);
  }

  return facets;
}

export function buildWorldFilterCatalog(
  facets: Map<string, CompanyWorldFacets>,
): WorldFilterCatalog {
  const list = [...facets.values()];
  const preferredReactorOrder = new Map(
    REACTOR_TYPE_OPTIONS.map((value, index) => [value, index]),
  );
  const preferredPowerOrder = new Map(
    POWER_CLASS_OPTIONS.map((value, index) => [value, index]),
  );

  return {
    reactorTypes: collectFacetOptions(list, (facet) => facet.reactorTypes).sort(
      (left, right) =>
        (preferredReactorOrder.get(left.value) ?? 99) -
          (preferredReactorOrder.get(right.value) ?? 99) ||
        left.label.localeCompare(right.label),
    ),
    coolants: collectFacetOptions(list, (facet) => facet.coolants),
    spectra: collectFacetOptions(list, (facet) => facet.spectra),
    powerClasses: collectFacetOptions(list, (facet) => facet.powerClasses).sort(
      (left, right) =>
        (preferredPowerOrder.get(left.value) ?? 99) -
          (preferredPowerOrder.get(right.value) ?? 99) ||
        left.label.localeCompare(right.label),
    ),
    countries: collectFacetOptions(
      list,
      (facet) => facet.countries,
      (iso) => getCountryName(String(iso)),
    ),
    statusLevels: collectFacetOptions(
      list,
      (facet) => facet.statusLevels,
      (level) => {
        const observed = new Set<string>();
        for (const facet of list) {
          if (!facet.statusLevels.has(level)) continue;
          for (const label of facet.statusLabels) observed.add(label);
        }
        const canonical = IAEA_STATUS_LABELS[level];
        const observedLabel = [...observed][0];
        const name = canonical ?? observedLabel ?? 'Unknown';
        return `Level ${level} · ${name}`;
      },
    ).sort((left, right) => Number(left.value) - Number(right.value)),
  };
}

function matchesSelection<T>(selected: T[], values: Set<T>): boolean {
  if (selected.length === 0) return true;
  return selected.some((value) => values.has(value));
}

export function companyMatchesWorldFilters(
  facet: CompanyWorldFacets | undefined,
  filters: WorldViewFilters,
): boolean {
  if (!facet) {
    return (
      filters.reactorTypes.length === 0 &&
      filters.coolants.length === 0 &&
      filters.spectra.length === 0 &&
      filters.powerClasses.length === 0 &&
      filters.countries.length === 0 &&
      filters.statusLevels.length === 0
    );
  }

  return (
    matchesSelection(filters.reactorTypes, facet.reactorTypes) &&
    matchesSelection(filters.coolants, facet.coolants) &&
    matchesSelection(filters.spectra, facet.spectra) &&
    matchesSelection(filters.powerClasses, facet.powerClasses) &&
    matchesSelection(filters.countries, facet.countries) &&
    matchesSelection(filters.statusLevels, facet.statusLevels)
  );
}

export function filterCompaniesByWorldFilters(
  companies: CompanySummary[],
  facets: Map<string, CompanyWorldFacets>,
  filters: WorldViewFilters,
): CompanySummary[] {
  if (
    filters.reactorTypes.length === 0 &&
    filters.coolants.length === 0 &&
    filters.spectra.length === 0 &&
    filters.powerClasses.length === 0 &&
    filters.countries.length === 0 &&
    filters.statusLevels.length === 0
  ) {
    return companies;
  }

  return companies.filter((company) =>
    companyMatchesWorldFilters(facets.get(company.id), filters),
  );
}

export function countActiveWorldFilters(filters: WorldViewFilters): number {
  return (
    filters.reactorTypes.length +
    filters.coolants.length +
    filters.spectra.length +
    filters.powerClasses.length +
    filters.countries.length +
    filters.statusLevels.length
  );
}

export function toggleWorldFilterValue<T extends string | number>(
  selected: T[],
  value: T,
): T[] {
  return selected.includes(value)
    ? selected.filter((item) => item !== value)
    : [...selected, value];
}
