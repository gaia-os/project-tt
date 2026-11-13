import type { Document } from 'mongodb';
import {
  CompanyInfo,
  CompanyLocation,
  CompanySummary,
  CompanyTechnologyMapping,
  CompanyViewResponse,
} from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import { getTopic } from '@/lib/topics.server';

export const COMPANIES_COLLECTION = 'tt_companies';
export const COMPANY_TECH_EDGES_COLLECTION = 'company_tech_tree_edges';
export const COMPANY_LOCATIONS_COLLECTION = 'tt_company_locations';

const COMPANY_SUMMARY_PROJECTION = {
  _id: 0,
  id: 1,
  canonical_name: 1,
  country_iso: 1,
  manufacturing_countries: 1,
  primary_approach: 1,
  tech_tree_primary_node: 1,
  trl_level: 1,
  trl_band: 1,
  funding_total_usd: 1,
  vc_funding_stage: 1,
  headcount_range: 1,
  description: 1,
  domain: 1,
  geopolitical_risk_score: 1,
  geopolitical_risk_label: 1,
  logo_image_id: 1,
} as const;

const COMPANY_MAPPING_PROJECTION = {
  _id: 0,
  id: 1,
  company_id: 1,
  tech_tree_node_id: 1,
  is_primary: 1,
  confidence: 1,
  method: 1,
  reasoning: 1,
} as const;

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && !!item.trim());
}

function toCompanySummary(document: Document): CompanySummary {
  return {
    id: String(document.id),
    canonical_name: String(document.canonical_name),
    country_iso: nullableString(document.country_iso)?.toUpperCase() ?? null,
    manufacturing_countries: stringArray(document.manufacturing_countries).map((country) =>
      country.toUpperCase(),
    ),
    primary_approach: nullableString(document.primary_approach),
    tech_tree_primary_node: nullableString(document.tech_tree_primary_node),
    trl_level: nullableNumber(document.trl_level),
    trl_band: nullableString(document.trl_band),
    funding_total_usd: nullableNumber(document.funding_total_usd),
    vc_funding_stage: nullableString(document.vc_funding_stage),
    headcount_range: nullableString(document.headcount_range),
    description: nullableString(document.description),
    domain: nullableString(document.domain),
    geopolitical_risk_score: nullableNumber(document.geopolitical_risk_score),
    geopolitical_risk_label: nullableString(document.geopolitical_risk_label),
    logo_image_id: nullableString(document.logo_image_id),
  };
}

function toCompanyLocation(document: Document): CompanyLocation | null {
  const latitude = nullableNumber(document.latitude);
  const longitude = nullableNumber(document.longitude);
  const countryIso = nullableString(document.country_iso)?.toUpperCase();
  if (latitude === null || longitude === null || !countryIso) return null;
  return {
    company_id: String(document.company_id),
    label: nullableString(document.label) ?? countryIso,
    country_iso: countryIso,
    latitude,
    longitude,
    source_field: document.source_field === 'hq' ? 'hq' : 'linkedin_headquarters',
    source_url: nullableString(document.source_url),
  };
}

function toCompanyTechnologyMapping(document: Document): CompanyTechnologyMapping {
  const companyId = String(document.company_id);
  const techTreeNodeId = String(document.tech_tree_node_id);

  return {
    id: nullableString(document.id) ?? `${companyId}__${techTreeNodeId}`,
    company_id: companyId,
    tech_tree_node_id: techTreeNodeId,
    is_primary: document.is_primary === true,
    confidence: nullableNumber(document.confidence),
    method: nullableString(document.method),
    reasoning: nullableString(document.reasoning),
  };
}

export function buildCompanyViewResponse(
  companyDocuments: Document[],
  mappingDocuments: Document[],
  topicLabel: string,
  locationDocuments: Document[] = [],
): CompanyViewResponse {
  const mappedCompanyIds = new Set(
    mappingDocuments.map((mapping) => String(mapping.company_id)),
  );
  const mappedCompanies = companyDocuments
    .filter((company) => mappedCompanyIds.has(String(company.id)))
    .map(toCompanySummary)
    .sort((left, right) =>
      left.canonical_name.localeCompare(right.canonical_name),
    );
  const availableCompanyIds = new Set(
    mappedCompanies.map((company) => company.id),
  );
  const mappings = mappingDocuments
    .map(toCompanyTechnologyMapping)
    .filter((mapping) => availableCompanyIds.has(mapping.company_id))
    .sort((left, right) => left.id.localeCompare(right.id));

  const coverage = {
    totalCompanies: companyDocuments.length,
    mappedCompanies: mappedCompanies.length,
    excludedUnmappedCompanies: Math.max(
      companyDocuments.length - mappedCompanies.length,
      0,
    ),
    mappedWithHeadquarters: mappedCompanies.filter(
      (company) => company.country_iso !== null,
    ).length,
    mappedWithoutHeadquarters: mappedCompanies.filter(
      (company) => company.country_iso === null,
    ).length,
    mappedWithManufacturing: mappedCompanies.filter(
      (company) => company.manufacturing_countries.length > 0,
    ).length,
  };

  if (companyDocuments.length === 0 || mappings.length === 0) {
    return {
      available: false,
      reason: `Company and geography data are not yet available for ${topicLabel}.`,
      companies: [],
      mappings: [],
      coverage,
    };
  }

  const locations = locationDocuments
    .map(toCompanyLocation)
    .filter((location): location is CompanyLocation => location !== null);

  return {
    available: true,
    companies: mappedCompanies,
    mappings,
    coverage,
    ...(locations.length ? { locations } : {}),
  };
}

export async function getCompanyViewData(
  topic: TopicKey,
): Promise<CompanyViewResponse> {
  const { default: clientPromise } = await import('@/lib/mongodb');
  const client = await clientPromise;
  const db = client.db((await getTopic(topic))!.dbName);

  const [companyDocuments, mappingDocuments, locationDocuments] = await Promise.all([
    db
      .collection(COMPANIES_COLLECTION)
      .find({}, { projection: COMPANY_SUMMARY_PROJECTION })
      .toArray(),
    db
      .collection(COMPANY_TECH_EDGES_COLLECTION)
      .find({}, { projection: COMPANY_MAPPING_PROJECTION })
      .toArray(),
    db
      .collection(COMPANY_LOCATIONS_COLLECTION)
      .find({}, { projection: { _id: 0 } })
      .toArray(),
  ]);

  return buildCompanyViewResponse(
    companyDocuments,
    mappingDocuments,
    (await getTopic(topic))!.label,
    locationDocuments,
  );
}

export async function getCompanyById(
  topic: TopicKey,
  companyId: string,
): Promise<CompanyInfo | null> {
  const { default: clientPromise } = await import('@/lib/mongodb');
  const client = await clientPromise;
  const db = client.db((await getTopic(topic))!.dbName);
  const company = await db
    .collection(COMPANIES_COLLECTION)
    .findOne({ id: companyId });

  if (!company) return null;

  return Object.fromEntries(
    Object.entries(company).filter(([key]) => key !== '_id'),
  ) as unknown as CompanyInfo;
}
