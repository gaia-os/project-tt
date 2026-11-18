import {
  CompanySummary,
  CompanyTechnologyMapping,
  DataNode,
  TechTree,
} from '@/lib/types';

/** Stable supply-chain role groups shown on the reactor entity panel. */
export type SupplyChainRoleGroup =
  | 'developer'
  | 'supplier'
  | 'manufacturer'
  | 'programme'
  | 'other';

export const SUPPLY_CHAIN_ROLE_ORDER: SupplyChainRoleGroup[] = [
  'developer',
  'manufacturer',
  'supplier',
  'programme',
  'other',
];

export const SUPPLY_CHAIN_ROLE_LABELS: Record<SupplyChainRoleGroup, string> = {
  developer: 'Developers',
  manufacturer: 'Manufacturers',
  supplier: 'Suppliers',
  programme: 'Programme / operators',
  other: 'Other linked organisations',
};

export interface LinkedEntityRef {
  /** Company document id when resolved; otherwise stripped org id. */
  id: string;
  /** Prefixed org id when known (org:…). */
  orgId: string | null;
  name: string;
  company: CompanySummary | null;
  /** Edge or catalogue roles that placed this entity in the group. */
  roles: string[];
  /** Mapping methods observed for this entity on the design. */
  methods: string[];
  /** Whether the link is via an enabling technology rather than the design itself. */
  viaTechnologyId: string | null;
  viaTechnologyLabel: string | null;
}

export interface LinkedEntityGroup {
  role: SupplyChainRoleGroup;
  label: string;
  entities: LinkedEntityRef[];
}

export interface CompanyDesignLink {
  nodeId: string;
  label: string;
  isReactor: boolean;
  methods: string[];
  roles: string[];
  isPrimary: boolean;
}

function titleCaseRole(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Strip a knowledge-graph prefix (`org:`, `smr:`, …) to a bare id. */
export function stripEntityPrefix(id: string): string {
  const separator = id.indexOf(':');
  return separator >= 0 ? id.slice(separator + 1) : id;
}

export function isReactorNode(node: DataNode | undefined): boolean {
  if (!node) return false;
  if (node.data.smr?.kind === 'reactor') return true;
  return node.data.nodeLabel === 'ReactorConcept';
}

function normalizeRoleGroup(raw: string | null | undefined): SupplyChainRoleGroup {
  const value = (raw ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!value) return 'other';
  if (/(develop|vendor|design authority|owner)/.test(value)) return 'developer';
  if (/(manufactur|fabricat|oem)/.test(value)) return 'manufacturer';
  if (/(program|programme|operator|utility|licensee)/.test(value)) {
    return 'programme';
  }
  if (/(suppl|vendor|component|fuel|epc)/.test(value)) return 'supplier';
  return 'other';
}

function roleGroupFromMapping(mapping: CompanyTechnologyMapping): SupplyChainRoleGroup {
  const method = (mapping.method ?? '').toLowerCase();
  if (method === 'develops' || mapping.is_primary) return 'developer';
  if (mapping.roles?.length) {
    return normalizeRoleGroup(mapping.roles[0]);
  }
  if (method === 'supplies') return 'supplier';
  return 'other';
}

function nodeLabel(node: DataNode | undefined, fallback: string): string {
  return node?.data.label ?? fallback;
}

/**
 * Technology node ids that directly enable a reactor design (one-hop
 * ENABLES-style edges in the tech tree).
 */
export function enablingTechnologyIdsForReactor(
  reactorId: string,
  techTree: TechTree | null,
): Set<string> {
  const ids = new Set<string>();
  if (!techTree) return ids;
  for (const edge of techTree.edges) {
    if (edge.target === reactorId) ids.add(edge.source);
  }
  return ids;
}

function upsertEntity(
  byKey: Map<string, LinkedEntityRef>,
  groupBuckets: Map<SupplyChainRoleGroup, Map<string, LinkedEntityRef>>,
  role: SupplyChainRoleGroup,
  entity: LinkedEntityRef,
) {
  const existing = byKey.get(entity.id);
  const merged: LinkedEntityRef = existing
    ? {
        ...existing,
        orgId: existing.orgId ?? entity.orgId,
        company: existing.company ?? entity.company,
        roles: [...new Set([...existing.roles, ...entity.roles])],
        methods: [...new Set([...existing.methods, ...entity.methods])],
        viaTechnologyId: existing.viaTechnologyId ?? entity.viaTechnologyId,
        viaTechnologyLabel:
          existing.viaTechnologyLabel ?? entity.viaTechnologyLabel,
      }
    : entity;
  byKey.set(entity.id, merged);

  const bucket = groupBuckets.get(role) ?? new Map<string, LinkedEntityRef>();
  const previous = bucket.get(entity.id);
  bucket.set(
    entity.id,
    previous
      ? {
          ...previous,
          roles: [...new Set([...previous.roles, ...merged.roles])],
          methods: [...new Set([...previous.methods, ...merged.methods])],
          company: previous.company ?? merged.company,
        }
      : merged,
  );
  groupBuckets.set(role, bucket);
}

/**
 * Group companies linked to a reactor design by supply-chain role.
 * Includes direct mappings plus suppliers of one-hop enabling technologies.
 */
export function groupEntitiesForReactor(
  reactorId: string,
  companies: CompanySummary[],
  mappings: CompanyTechnologyMapping[],
  techTree: TechTree | null,
): LinkedEntityGroup[] {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const nodeById = new Map((techTree?.nodes ?? []).map((node) => [node.id, node]));
  const enablingIds = enablingTechnologyIdsForReactor(reactorId, techTree);
  const relevantNodeIds = new Set([reactorId, ...enablingIds]);

  const byKey = new Map<string, LinkedEntityRef>();
  const groupBuckets = new Map<SupplyChainRoleGroup, Map<string, LinkedEntityRef>>();

  for (const mapping of mappings) {
    if (!relevantNodeIds.has(mapping.tech_tree_node_id)) continue;
    const company = companyById.get(mapping.company_id);
    if (!company) continue;
    const viaTechnologyId =
      mapping.tech_tree_node_id === reactorId ? null : mapping.tech_tree_node_id;
    const viaNode = viaTechnologyId ? nodeById.get(viaTechnologyId) : undefined;
    upsertEntity(byKey, groupBuckets, roleGroupFromMapping(mapping), {
      id: company.id,
      orgId: null,
      name: company.canonical_name,
      company,
      roles: mapping.roles?.map(titleCaseRole) ?? [],
      methods: mapping.method ? [mapping.method] : [],
      viaTechnologyId,
      viaTechnologyLabel: viaTechnologyId
        ? nodeLabel(viaNode, viaTechnologyId)
        : null,
    });
  }

  return SUPPLY_CHAIN_ROLE_ORDER.flatMap((role) => {
    const bucket = groupBuckets.get(role);
    if (!bucket || bucket.size === 0) return [];
    const entities = [...bucket.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    return [
      {
        role,
        label: SUPPLY_CHAIN_ROLE_LABELS[role],
        entities,
      },
    ];
  });
}

/**
 * All tech-tree designs a company participates in, with reactor designs first.
 */
export function designsForCompany(
  companyId: string,
  mappings: CompanyTechnologyMapping[],
  techTree: TechTree | null,
  /** Optional develops[] / tech_tree_all_nodes from a full company document. */
  extraNodeIds: string[] = [],
): CompanyDesignLink[] {
  const nodeById = new Map((techTree?.nodes ?? []).map((node) => [node.id, node]));
  const byNode = new Map<string, CompanyDesignLink>();

  const ensure = (nodeId: string) => {
    const existing = byNode.get(nodeId);
    if (existing) return existing;
    const node = nodeById.get(nodeId);
    const link: CompanyDesignLink = {
      nodeId,
      label: nodeLabel(node, nodeId),
      isReactor: isReactorNode(node) || nodeId.startsWith('smr:'),
      methods: [],
      roles: [],
      isPrimary: false,
    };
    byNode.set(nodeId, link);
    return link;
  };

  for (const mapping of mappings) {
    if (mapping.company_id !== companyId) continue;
    const link = ensure(mapping.tech_tree_node_id);
    if (mapping.method) link.methods = [...new Set([...link.methods, mapping.method])];
    if (mapping.roles?.length) {
      link.roles = [
        ...new Set([...link.roles, ...mapping.roles.map(titleCaseRole)]),
      ];
    }
    if (mapping.is_primary) link.isPrimary = true;
  }

  for (const nodeId of extraNodeIds) {
    if (nodeId) ensure(nodeId);
  }

  return [...byNode.values()].sort((left, right) => {
    if (left.isReactor !== right.isReactor) return left.isReactor ? -1 : 1;
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

export function resolveCompanyIdFromOrgRef(
  orgRef: string,
  companies: CompanySummary[],
): CompanySummary | null {
  const bare = stripEntityPrefix(orgRef);
  return (
    companies.find((company) => company.id === bare) ??
    companies.find((company) => company.id === orgRef) ??
    null
  );
}
