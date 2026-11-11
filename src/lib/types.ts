import { Edge, Node } from '@xyflow/react';

export interface NodeProperties {
  label: string;
  nodeLabel: NodeLabel;
  description: string;
  detailedDescription?: string; // Detailed description for AI context
  category?: string;
  subtype?: string;
  trl_current?: string;
  trl_projected_5_10_years?: string;
  references?: string[];
  // Group-related properties
  isGroup?: boolean;
  isExpanded?: boolean;
  childNodeIds?: string[];
  infact_analysis?: InfactAnalysis;
  infact_analysis_html_content?: string;
  infact_status?: string;
  /** Present only for topics built from the SMR knowledge base. */
  smr?: SmrNodeMeta;
}

// SMR knowledge-base types (smr_tt_db, seeded by scripts/add-smr-data.ts)
export interface SmrReactorMeta {
  kind: 'reactor';
  status: string | null;
  status_level: number | null;
  coverage: string | null;
  electric_mwe: number | null;
  thermal_mwth: number | null;
  coolant: string | null;
  neutron_spectrum: string | null;
  countries: string[];
  developers: string[];
  image_count: number;
  cover_image_id: string | null;
}

export interface SmrTechnologyMeta {
  kind: 'technology';
  /** IAEA/NEA-derived decision relevance 1-5 (0 = not rated). */
  relevance: number;
  importance_score: number | null;
  reactor_reach: number | null;
  tree_level: number | null;
  origin: string | null;
  availability: string | null;
}

export type SmrNodeMeta = SmrReactorMeta | SmrTechnologyMeta;

export interface SmrEdgeData extends Record<string, unknown> {
  /** Backed by a source document or verified literature (not only LLM-inferred). */
  source_backed: boolean;
}

export interface SmrImageRef {
  id: string;
  caption: string | null;
  category: string | null;
  width: number | null;
  height: number | null;
}

export interface SmrNodeRef {
  id: string;
  name: string;
}

export interface SmrCitation {
  title: string | null;
  year: number | null;
  url: string | null;
  cited_by: number | null;
  verdict: string | null;
  evidence: string | null;
}

export interface SmrReactorDetails {
  id: string;
  kind: 'reactor';
  name: string;
  aliases: string[];
  technology_line: string;
  coverage: string | null;
  developers: SmrNodeRef[];
  countries: { iso: string; name: string }[];
  headquarters: { city_region?: string; country?: string } | null;
  sources: { document?: string; publisher?: string; year?: number }[];
  status: {
    aris_status: string | null;
    aris_level: number | null;
    aris_level_max: number | null;
    development_stages: string[];
    declared_design_status: string | null;
  } | null;
  classification: {
    coolant: string | null;
    reactor_type: string | null;
    reactor_type_label: string | null;
    deployment: string[];
    applications: string[];
  };
  specs: { key: string; label: string; value: string; source: string; conflict: string | null }[];
  assessment: {
    dimension: string;
    label: string;
    level: number | null;
    stage: string | null;
    changed: boolean;
    previous_level: number | null;
    multiple_jurisdictions: boolean;
    text: string | null;
  }[];
  milestones: { year: string | null; milestone: string; status: string | null }[];
  financing: { section: string; text: string; usd: number | null }[];
  sections: { title: string; blocks: { heading: string | null; text: string }[] }[];
  images: SmrImageRef[];
  regulators: SmrNodeRef[];
  organisations: SmrNodeRef[];
}

export interface SmrTechnologyDetails {
  id: string;
  kind: 'technology';
  name: string;
  aliases: string[];
  category: string;
  origin: string | null;
  tree_level: number | null;
  importance: {
    score: number | null;
    decision_relevance: number | null;
    reactor_reach: number | null;
    direct_reactors: number | null;
    enabled_descendants: number | null;
    abstraction: string | null;
    rationale: string | null;
  };
  description: string | null;
  source_descriptions: string[];
  broader: (SmrNodeRef & { provenance: string[] })[];
  narrower: SmrNodeRef[];
  enables: {
    reactors: (SmrNodeRef & { verified: boolean; role: string | null; quote: string | null; document: string | null })[];
    technologies: (SmrNodeRef & { provenance: string[] })[];
  };
  enabled_by: (SmrNodeRef & {
    provenance: string[];
    relation_type: string | null;
    rationale: string | null;
    citations: SmrCitation[];
  })[];
  deployment: {
    availability: string | null;
    trl_band: string | null;
    summary: string | null;
    suppliers: { name: string; role: string | null; location: string | null; url: string | null; org_id: string | null }[];
    milestones: { date: string; event: string; url?: string }[];
    scaling_factors: string[];
  } | null;
}

export type SmrNodeDetails = SmrReactorDetails | SmrTechnologyDetails;

export interface InfactAnalysis {
  probability?: string | number;
  uncertainty?: string | number;
  interpretation?: string;
  [key: string]: unknown;
}

export type UiNode = Node<Record<string, unknown> & NodeProperties>;

export type DataNode = Pick<UiNode, 'id' | 'data'>;

export interface TechTree {
  nodes: DataNode[];
  edges: Edge[];
}

export interface HighlightedElements {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export const NODE_LABELS = [
  'ReactorConcept',
  'Milestone',
  'EnablingTechnology',
] as const;

export type NodeLabel = (typeof NODE_LABELS)[number];

export const LABEL_COLORS: Record<NodeLabel, string> = {
  ['ReactorConcept']: 'blue-500',
  ['Milestone']: 'green-500',
  ['EnablingTechnology']: 'red-500',
};

export const LABEL_COLORS_VARIABLES: Record<NodeLabel, string> = {
  ['ReactorConcept']: 'oklch(62.3% 0.214 259.815)',
  ['Milestone']: 'oklch(72.3% 0.219 149.579)',
  ['EnablingTechnology']: 'oklch(0.637 0.237 25.331)',
};

export interface InvestTechTreeNode {
  id: string;
  label: string;
  type: NodeLabel;
  category?: string;
  subtype?: string;
  trl_current?: string;
  trl_projected_5_10_years?: string;
  references: string[];
  detailedDescription?: string;
  subTypeOf?: string;
}

export interface InvestTechTreeEdge {
  id: string;
  source: string;
  target: string;
}

export interface InvestTechTreeGraph {
  nodes: InvestTechTreeNode[];
  edges: InvestTechTreeEdge[];
}

// Chat-related types
export interface ChatMessage {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  /** KG tool calls the agent ran to produce this answer (e.g. "search_chunks(...)"). */
  toolsUsed?: string[];
  timestamp: number;
}

export interface ChatHistory {
  messages: ChatMessage[];
  lastUpdated: number;
}

// Grouping-related types
export type GroupingMode = NodeLabel | 'None';

export interface GroupNode {
  id: string;
  type: 'group';
  groupType: NodeLabel;
  isExpanded: boolean;
  childNodeIds: string[];
}

export interface GroupState {
  mode: GroupingMode;
  expandedGroups: Set<string>;
}

// Company-related types
export interface CompanyInfo {
  id: string;
  canonical_name: string;
  country_iso?: string | null;
  country_tier?: number | null;
  country_tier_label?: string | null;
  trl_level?: number | null;
  trl_band?: string | null;
  trl_confidence?: number | null;
  primary_approach?: string | null;
  all_approaches?: string[];
  tech_tree_primary_node?: string | null;
  key_investors?: string[];
  manufacturing_countries?: string[];
  critical_material_deps?: string[];
  ownership_top_shareholders?: string[];
  is_primary?: boolean;
  relation_confidence?: number | null;
  relation_method?: string | null;
  relation_reasoning?: string | null;
  tech_tree_primary_method?: string | null;
  tech_tree_primary_confidence?: number | null;
  tech_tree_primary_reasoning?: string | null;
  tech_tree_primary_source_url?: string | null;
  tech_tree_all_nodes?: string[];
  tech_tree_product_clusters?: string[];

  // Financials & Scale
  founded_year?: number | null;
  funding_total_usd?: number | null;
  vc_funding_stage?: string | null;
  customer_count_band?: string | null;
  headcount_range?: string | null;
  description?: string | null;
  domain?: string | null;
  current_capacity?: string | null;
  role_in_supply_chain?: string | null;
  role_in_supply_chain_confidence?: number | null;
  role_in_supply_chain_reasoning?: string | null;
  sole_source_dependency?: boolean | null;
  foreign_ownership_flag?: boolean | null;
  foreign_ownership_flag_reasoning?: string | null;
  linkedin_headquarters?: string | null;
  linkedin_url?: string | null;
  linkedin_industry?: string | null;
  linkedin_specialties?: string | null;
  source?: string | null;
  source_url?: string | null;
  trl_source_url?: string | null;

  // Risk Scores
  financial_risk_score?: number | null;
  financial_risk_label?: string | null;
  financial_risk_summary?: string | null;

  commercial_risk_score?: number | null;
  commercial_risk_label?: string | null;
  commercial_risk_summary?: string | null;

  manufacturing_risk_score?: number | null;
  manufacturing_risk_label?: string | null;
  manufacturing_risk_summary?: string | null;

  geopolitical_risk_score?: number | null;
  geopolitical_risk_label?: string | null;
  geopolitical_risk_summary?: string | null;

  regulatory_risk_score?: number | null;
  regulatory_risk_score_reasoning?: string | null;

  export_control_exposure?: string | null;
  export_control_exposure_reasoning?: string | null;

  [key: string]: unknown;
}

export interface CompanyNodeData {
  label: string;
  nodeType: 'company';
  company: CompanyInfo;
  parentNodeId: string;
}

// KG literature-overlay types (materialized by enrich.py, served by /api/kg)
export type KgEntityKind = 'paper' | 'device' | 'finding';

export interface KgPaperRef {
  paperId: string;
  title?: string | null;
  year?: number | null;
  conference?: string | null;
  sessionCode?: string | null;
  authors?: string[];
  institute?: string | null;
  studyKind?: string | null;
}

export interface KgEntity {
  id: string;
  kind: KgEntityKind;
  name: string;
  summary?: string;
  relation?: string;
  paper?: KgPaperRef;
  device?: {
    majorRadius?: string | null;
    minorRadius?: string | null;
    magneticFieldStrength?: string | null;
    numberOfPeriods?: number | null;
    configurationType?: string | null;
  };
}

export interface KgExpandResponse {
  entities: KgEntity[];
  meta: {
    enriched?: boolean;
    resolved_entity?: string;
    paper_count?: number;
    truncated?: boolean;
    [key: string]: unknown;
  };
}

export interface KgMeasurement {
  parameter?: string | null;
  value?: string | null;
  unit?: string | null;
  diagnostic?: string | null;
}

export interface KgExperiment {
  /** Stable vote/curation key, attached server-side by /api/kg/paper. */
  voteKey?: string;
  name?: string | null;
  device?: string | null;
  heatingMethods?: { name?: string | null; frequency?: string | null; power?: string | null; pulseDuration?: string | null }[];
  findings?: (string | null)[];
  measurements?: KgMeasurement[];
  scalabilityClaims?: { statement?: string | null; limit?: string | null }[];
  constraints?: (string | null)[];
  instabilities?: { name?: string | null; observed?: boolean }[];
}

export interface KgPaperDossier {
  paperId: string;
  title?: string | null;
  authors?: string[];
  presenters?: string[];
  institute?: { name?: string | null; city?: string | null } | null;
  conference?: { name?: string | null; year?: number | null; location?: string | null; session?: string | null } | null;
  studyKind?: string | null;
  originalLanguage?: string | null;
  numPages?: number | null;
  experiments?: KgExperiment[];
  excerpts?: string[];
}

export interface LiteratureNodeData {
  label: string;
  nodeType: 'literature';
  entity: KgEntity;
  parentNodeId: string;
}

export const EXPLORER_VIEW_MODES = ['technology', 'company', 'world'] as const;

export type ExplorerViewMode = (typeof EXPLORER_VIEW_MODES)[number];

export const GEOGRAPHY_LAYERS = ['headquarters', 'manufacturing'] as const;

export type GeographyLayer = (typeof GEOGRAPHY_LAYERS)[number];

export const PRODUCT_REGIONS = [
  'All',
  'North America',
  'Europe',
  'China',
  'Asia-Pacific',
  'Latin America',
  'Middle East',
  'Africa',
  'Other/Unknown',
] as const;

export type ProductRegion = (typeof PRODUCT_REGIONS)[number];

export interface CompanySummary {
  id: string;
  canonical_name: string;
  country_iso: string | null;
  manufacturing_countries: string[];
  primary_approach: string | null;
  tech_tree_primary_node: string | null;
  trl_level: number | null;
  trl_band: string | null;
  funding_total_usd: number | null;
  vc_funding_stage: string | null;
  headcount_range: string | null;
  description: string | null;
  domain: string | null;
  geopolitical_risk_score: number | null;
  geopolitical_risk_label: string | null;
  logo_image_id?: string | null;
}

export interface CompanyLocation {
  company_id: string;
  label: string;
  country_iso: string;
  latitude: number;
  longitude: number;
  source_field: 'linkedin_headquarters' | 'hq';
  source_url: string | null;
}

export interface CompanyTechnologyMapping {
  id: string;
  company_id: string;
  tech_tree_node_id: string;
  is_primary: boolean;
  confidence: number | null;
  method: string | null;
  reasoning: string | null;
}

export interface CompanyViewCoverage {
  totalCompanies: number;
  mappedCompanies: number;
  excludedUnmappedCompanies: number;
  mappedWithHeadquarters: number;
  mappedWithoutHeadquarters: number;
  mappedWithManufacturing: number;
}

export interface AvailableCompanyViewResponse {
  available: true;
  companies: CompanySummary[];
  mappings: CompanyTechnologyMapping[];
  coverage: CompanyViewCoverage;
  /** Topic-specific HQ coordinates; falls back to data/company_locations.json when absent. */
  locations?: CompanyLocation[];
}

export interface UnavailableCompanyViewResponse {
  available: false;
  reason: string;
  companies: [];
  mappings: [];
  coverage: CompanyViewCoverage;
}

export type CompanyViewResponse =
  | AvailableCompanyViewResponse
  | UnavailableCompanyViewResponse;

export interface CompanyGraphCompanyNodeData {
  label: string;
  nodeType: 'companyGraphCompany';
  company: CompanySummary;
}

export interface CompanyGraphTechnologyNodeData {
  label: string;
  nodeType: 'companyGraphTechnology';
  technologyNode: DataNode;
}

export type CompanyGraphNode = Node<
  Record<string, unknown> &
    (CompanyGraphCompanyNodeData | CompanyGraphTechnologyNodeData)
>;

export type ExplorerSelection =
  | {
      kind: 'technology';
      node: UiNode;
    }
  | {
      kind: 'company';
      company: CompanySummary | CompanyInfo;
    }
  | {
      kind: 'country';
      countryIso: string;
      countryName: string;
      layer: GeographyLayer;
      companies: CompanySummary[];
    };
