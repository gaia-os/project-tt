/**
 * scripts/add-smr-data.ts
 *
 * Builds the SMR tech tree database (smr_tt_db) from the extracted SMR
 * knowledge base in data/extracted (reactors / technologies / orgs + IAEA
 * figures and org logos). The database is fully replaced on every run and
 * shares nothing with nuclear_tt_db / fossil_fuels_tt_db.
 *
 * Collections written:
 *   nodes                    lean graph nodes (reactors + technologies)
 *   edges                    ENABLES relations (tech->tech, tech->reactor)
 *   node_details             rich per-node payload, fetched lazily by the UI
 *   images                   IAEA figures + org logos as BSON Binary
 *   tt_companies             organisations in the CompanyInfo shape
 *   company_tech_tree_edges  DEVELOPS (org->reactor) / SUPPLIES (org->tech)
 *   tt_company_locations     geocoded org headquarters (world view)
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/add-smr-data.ts
 *
 * Optional env:
 *   SMR_DATA_DIR=data/extracted   source directory
 *   MONGODB_DB_NAME=smr_tt_db     target database
 *   SKIP_GEOCODE=true             only use the geocode cache, no Nominatim calls
 *   DRY_RUN=true                  parse + report, don't touch MongoDB
 *
 * Geocoding uses the public Nominatim API (max 1 request/s, results cached in
 * <SMR_DATA_DIR>/.geocode-cache.json so re-runs make no network requests).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Binary, Document, MongoClient } from 'mongodb';
import { parse as parseYaml } from 'yaml';
import countries from 'i18n-iso-countries';
import enLocale from 'i18n-iso-countries/langs/en.json';

countries.registerLocale(enLocale);

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT, process.env.SMR_DATA_DIR ?? 'data/extracted');
const DB_NAME = process.env.MONGODB_DB_NAME ?? 'smr_tt_db';
const SKIP_GEOCODE = process.env.SKIP_GEOCODE === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
const GEOCODE_CACHE_PATH = path.join(DATA_DIR, '.geocode-cache.json');
const NOMINATIM_USER_AGENT = 'investment-tech-tree-smr-seed/0.1 (research project, one-off geocoding)';
const MAX_CITATIONS = 3;

type Yaml = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function readMarkdown(file: string): { fm: Yaml; body: string } {
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`No frontmatter in ${file}`);
  return { fm: parseYaml(match[1]) ?? {}, body: match[2] };
}

function listMarkdown(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'index.md')
    .map((f) => path.join(dir, f));
}

const stripPrefix = (id: string) => id.replace(/^[a-z]+:/, '');
const compact = <T>(items: (T | null | undefined | false)[]): T[] =>
  items.filter((item): item is T => item !== null && item !== undefined && item !== false);
const unique = <T>(items: T[]): T[] => [...new Set(items)];

function titleCase(key: string): string {
  const special: Record<string, string> = {
    rv: 'RV', sse: 'SSE', trl: 'TRL', i: 'I', c: 'C',
  };
  return key
    .split('_')
    .map((w, i) => special[w] ?? (i === 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const CATEGORY_LABELS: Record<string, string> = {
  component: 'Component',
  system: 'System',
  material: 'Material',
  process: 'Process',
  software_method: 'Software & methods',
  instrumentation_control: 'Instrumentation & control',
  manufacturing: 'Manufacturing',
  fuel: 'Fuel',
};

const COUNTRY_ALIASES: Record<string, string> = {
  usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', us: 'US', 'united states of america': 'US',
  uk: 'GB', 'u.k.': 'GB', england: 'GB', scotland: 'GB', wales: 'GB',
  russia: 'RU', 'south korea': 'KR', korea: 'KR', 'republic of korea': 'KR',
  czechia: 'CZ', 'czech republic': 'CZ', iran: 'IR', taiwan: 'TW',
  'the netherlands': 'NL', turkey: 'TR', türkiye: 'TR', uae: 'AE',
};

function countryToIso(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = name.trim().replace(/\.$/, '');
  if (/^[A-Z]{2}$/.test(clean)) return clean;
  return COUNTRY_ALIASES[clean.toLowerCase()] ?? countries.getAlpha2Code(clean, 'en') ?? null;
}

/** "Preston, UK" / "Genoa, Italy" -> ISO of the last comma-separated part. */
function locationToIso(location: string | null | undefined): string | null {
  if (!location || /not stated/i.test(location)) return null;
  const parts = location.split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const iso = countryToIso(parts[i]);
    if (iso) return iso;
  }
  return null;
}

/** Render a characteristic value ({raw, unit, ...} | string | list) for display. */
function formatValue(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const parts = compact(value.map((v) => (v && typeof v === 'object' && 'raw' in v ? v.raw : formatValue(v))));
    return parts.length ? parts.join('; ') : null;
  }
  if (typeof value === 'object') {
    const v = value as Yaml;
    if ('raw' in v || 'value' in v) {
      const raw = v.raw ?? v.value;
      if (raw === null || raw === undefined) return null;
      return v.unit && !String(raw).includes(v.unit) ? `${raw} ${v.unit}` : String(raw);
    }
  }
  return null;
}

function numericValue(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Yaml;
  return v.value ?? v.max ?? v.min ?? null;
}

function trimCitation(c: Yaml) {
  return {
    title: c.title ?? null,
    year: c.year ?? null,
    url: c.url ?? c.doi ?? null,
    cited_by: c.cited_by ?? null,
    verdict: c.verification?.verdict ?? null,
    evidence: c.verification?.evidence ?? null,
  };
}

const trimCitations = (list: Yaml[] | undefined) =>
  (list ?? [])
    .slice()
    .sort((a, b) => Number(b.verification?.verdict === 'supports') - Number(a.verification?.verdict === 'supports'))
    .slice(0, MAX_CITATIONS)
    .map(trimCitation);

// ---------------------------------------------------------------------------
// Markdown body sections
// ---------------------------------------------------------------------------

interface Section {
  title: string;
  blocks: { heading: string | null; text: string }[];
}

/** Split the "## IAEA SMR Catalogue" chapter into its numbered narrative sections. */
function parseIaeaSections(body: string): Section[] {
  const start = body.indexOf('## IAEA SMR Catalogue');
  if (start < 0) return [];
  const chapter = body.slice(start);
  const sections: Section[] = [];
  let current: Section | null = null;
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (current && text) current.blocks.push({ heading, text });
    buffer = [];
  };

  for (const line of chapter.split('\n')) {
    const h3 = line.match(/^### (\d+)\. (.+)$/);
    if (h3 || /^### (Thematic mentions|Technical terms)/.test(line)) {
      flush();
      if (current && current.blocks.length) sections.push(current);
      current = h3 && !/Development Milestones/i.test(h3[2]) ? { title: h3[2].trim(), blocks: [] } : null;
      heading = null;
      continue;
    }
    if (!current) continue;
    const h4 = line.match(/^#### (.+)$/);
    if (h4) {
      flush();
      heading = h4[1].trim();
      continue;
    }
    if (/^!\[/.test(line) || /^\*`img:/.test(line) || /^\|/.test(line)) continue;
    buffer.push(line);
  }
  flush();
  if (current && current.blocks.length) sections.push(current);
  return sections;
}

/** Narrative text per NEA assessment dimension ("#### Licensing" ...). */
function parseNeaAssessmentText(body: string): Record<string, string> {
  const start = body.indexOf('### Assessment details');
  if (start < 0) return {};
  const end = body.indexOf('### Thematic mentions', start);
  const chunk = body.slice(start, end > 0 ? end : undefined);
  const result: Record<string, string> = {};
  for (const part of chunk.split(/^#### /m).slice(1)) {
    const [title, ...rest] = part.split('\n');
    const text = rest
      .filter((l) => !/^- \*\*(Level|Entities):\*\*/.test(l))
      .join('\n')
      .trim();
    if (text) result[title.trim().toLowerCase().replace(/\s+/g, '_')] = text;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Load sources
// ---------------------------------------------------------------------------

interface GraphJson {
  nodes: Yaml[];
  edges: Yaml[];
}

const graph: GraphJson = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'technologies/graph.json'), 'utf8'),
);
const reactorFiles = listMarkdown(path.join(DATA_DIR, 'reactors')).map((f) => ({ file: f, ...readMarkdown(f) }));
const techFiles = listMarkdown(path.join(DATA_DIR, 'technologies')).map((f) => ({ file: f, ...readMarkdown(f) }));
const orgFiles = listMarkdown(path.join(DATA_DIR, 'orgs')).map((f) => ({ file: f, ...readMarkdown(f) }));

const nodeNames = new Map(graph.nodes.map((n) => [n.id as string, n.name as string]));
const techMeta = new Map(graph.nodes.filter((n) => n.label === 'Technology').map((n) => [n.id as string, n]));

// ---------------------------------------------------------------------------
// Reactors
// ---------------------------------------------------------------------------

const COOLANT_TO_LINE: Record<string, string> = {
  'light water': 'Water-cooled SMRs',
  'heavy water': 'Water-cooled SMRs',
  gas: 'High-temperature gas-cooled SMRs',
  'molten salt': 'Molten salt SMRs',
  sodium: 'Fast neutron spectrum SMRs',
  lead: 'Fast neutron spectrum SMRs',
  'liquid metal': 'Fast neutron spectrum SMRs',
  'heat pipe': 'Microreactors',
};

const pick = (v: Yaml | undefined) => (v ? v.iaea ?? v.nea ?? null : null);

const imageDocs: Document[] = [];
const nodeDocs: Document[] = [];
const detailDocs: Document[] = [];

for (const { file, fm, body } of reactorFiles) {
  if (fm.type !== 'SMRDesign') continue;
  const iaea = fm.iaea ?? {};
  const nea = fm.nea ?? {};
  const dc = fm.design_classification ?? {};
  const ch = fm.characteristics ?? {};
  const coolant = pick(dc.coolant);
  const line = fm.technology_line?.label ?? COOLANT_TO_LINE[coolant ?? ''] ?? 'Other SMRs';

  // Figures -> images collection
  const images = compact<{ id: string; caption: string | null; category: string | null; width: number | null; height: number | null }>(
    (iaea.figures ?? []).map((fig: Yaml) => {
      const abs = path.resolve(path.dirname(file), fig.file);
      if (!fs.existsSync(abs)) return null;
      const id = stripPrefix(fig.id);
      imageDocs.push({
        id,
        owner_id: fm.id,
        kind: 'figure',
        caption: fig.caption ?? null,
        category: fig.category ?? null,
        width: fig.width_px ?? null,
        height: fig.height_px ?? null,
        content_type: abs.endsWith('.png') ? 'image/png' : 'image/jpeg',
        sha1: fig.sha1 ?? null,
        data: new Binary(fs.readFileSync(abs)),
      });
      return { id, caption: fig.caption ?? null, category: fig.category ?? null, width: fig.width_px ?? null, height: fig.height_px ?? null };
    }),
  );
  // Overview figures first, then document order
  images.sort((a, b) => Number(b.category === 'overview') - Number(a.category === 'overview'));

  // Specs: merged characteristics, IAEA preferred
  const specs = compact(
    Object.entries(ch).map(([key, v]) => {
      const entry = v as Yaml;
      const iaeaVal = formatValue(entry?.iaea);
      const neaVal = formatValue(entry?.nea);
      const value = iaeaVal ?? neaVal;
      if (!value) return null;
      return { key, label: titleCase(key), value, source: iaeaVal ? 'IAEA' : 'NEA', conflict: entry?.match === false && !!iaeaVal && !!neaVal && iaeaVal !== neaVal ? neaVal : null };
    }),
  );

  const neaText = parseNeaAssessmentText(body);
  const assessment = Object.entries(nea.assessment ?? {})
    .filter(([key]) => key !== 'scale')
    .map(([key, a]) => {
      const v = a as Yaml;
      return {
        dimension: key,
        label: titleCase(key),
        level: v.level ?? null,
        stage: v.stage ?? null,
        changed: v.changed_since_previous_edition ?? false,
        previous_level: v.previous_level ?? null,
        multiple_jurisdictions: v.multiple_jurisdictions ?? false,
        text: neaText[key] ?? null,
      };
    });

  const applications = unique<string>(
    [...(dc.applications?.iaea ?? []), ...(dc.applications?.nea ?? [])].map((a: Yaml) => a.application),
  );
  const deployment = unique<string>([...(dc.deployment?.nea ?? []), ...(dc.deployment?.iaea ?? [])]);
  const status = iaea.status?.aris_status ?? null;
  const licensing = assessment.find((a) => a.dimension === 'licensing');
  const statusLabel = status ?? (licensing?.level ? `NEA licensing ${licensing.level}/6` : null);
  const developers = (fm.developers ?? []).map((d: Yaml) => ({ id: d.id, name: d.name }));
  const countryIsos = compact<string>((fm.countries ?? []).map((c: Yaml) => stripPrefix(c.id ?? '') || countryToIso(c.name)));
  const description =
    pick(ch.reactor_description) ??
    parseIaeaSections(body)[0]?.blocks[0]?.text.split(/(?<=\.)\s/)[0] ??
    null;
  const electric = numericValue(ch.electric_power?.iaea) ?? numericValue(ch.electric_power?.nea);
  const thermal = numericValue(ch.thermal_power?.iaea) ?? numericValue(ch.thermal_power?.nea);

  const sources = Object.values(fm.sources ?? {}).map((s) => {
    const src = s as Yaml;
    return `${src.publisher}: ${src.document} (${src.year})`;
  });

  nodeDocs.push({
    id: fm.id,
    label: fm.reactor_name,
    type: 'ReactorConcept',
    category: line,
    subtype: pick(dc.reactor_type_label) ?? pick(dc.reactor_type),
    description,
    references: sources,
    smr: {
      kind: 'reactor',
      status: statusLabel,
      status_level: iaea.status?.aris_level ?? null,
      coverage: fm.coverage ?? null,
      electric_mwe: electric,
      thermal_mwth: thermal,
      coolant,
      neutron_spectrum: pick(ch.neutron_spectrum),
      countries: countryIsos,
      developers: developers.map((d: Yaml) => d.id),
      image_count: images.length,
      cover_image_id: images[0]?.id ?? null,
    },
  });

  detailDocs.push({
    id: fm.id,
    kind: 'reactor',
    name: fm.reactor_name,
    aliases: fm.aliases ?? [],
    technology_line: line,
    coverage: fm.coverage ?? null,
    developers,
    countries: (fm.countries ?? []).map((c: Yaml) => ({ iso: stripPrefix(c.id ?? ''), name: c.name })),
    headquarters: fm.headquarters ?? null,
    sources: Object.values(fm.sources ?? {}),
    status: iaea.status
      ? {
          aris_status: iaea.status.aris_status ?? null,
          aris_level: iaea.status.aris_level ?? null,
          aris_level_max: iaea.status.aris_level_max ?? null,
          development_stages: iaea.status.development_stages ?? [],
          declared_design_status: iaea.status.declared_design_status ?? null,
        }
      : null,
    classification: {
      coolant,
      reactor_type: pick(dc.reactor_type),
      reactor_type_label: pick(dc.reactor_type_label),
      deployment,
      applications,
    },
    specs,
    assessment,
    milestones: (iaea.milestones ?? []).map((m: Yaml) => ({
      year: m.year ?? null,
      milestone: m.milestone,
      status: m.status_normalized ?? m.status ?? null,
    })),
    financing: (nea.money ?? []).map((m: Yaml) => ({
      section: m.section,
      text: m.text,
      usd: m.equivalent?.currency === 'USD' ? m.equivalent.amount : m.currency === 'USD' ? m.amount : null,
    })),
    sections: parseIaeaSections(body),
    images,
    regulators: (nea.entities?.regulators ?? []).map((r: Yaml) => ({ id: r.id, name: r.name })),
    organisations: unique<string>([
      ...(nea.entities?.organisations ?? []).map((o: Yaml) => o.id),
      ...(iaea.entities?.organisations ?? []).map((o: Yaml) => o.id),
    ]).map((id) => ({ id, name: nodeNames.get(id) ?? stripPrefix(id) })),
  });
}

// ---------------------------------------------------------------------------
// Technologies
// ---------------------------------------------------------------------------

for (const { fm } of techFiles) {
  if (fm.type !== 'Technology' || !fm.name) continue;
  const meta = techMeta.get(fm.id) ?? {};
  const importance = fm.importance ?? meta.importance ?? {};
  const deployment = fm.deployment ?? null;
  const supplierUrls = compact<string>((deployment?.suppliers ?? []).map((s: Yaml) => s.url));

  nodeDocs.push({
    id: fm.id,
    label: fm.name,
    type: 'EnablingTechnology',
    category: CATEGORY_LABELS[fm.category] ?? fm.category ?? 'Other',
    subtype: importance.abstraction ?? null,
    trl_current: deployment?.trl_band ?? undefined,
    // Full description lives in node_details; keeps the tree payload small.
    description: null,
    references: unique(supplierUrls),
    smr: {
      kind: 'technology',
      relevance: importance.decision_relevance ?? 0,
      importance_score: importance.score ?? null,
      reactor_reach: importance.reactor_reach ?? null,
      tree_level: fm.tree_level ?? null,
      origin: fm.origin ?? null,
      availability: deployment?.availability ?? null,
    },
  });

  detailDocs.push({
    id: fm.id,
    kind: 'technology',
    name: fm.name,
    aliases: fm.aliases ?? [],
    category: CATEGORY_LABELS[fm.category] ?? fm.category,
    origin: fm.origin ?? null,
    tree_level: fm.tree_level ?? null,
    importance: {
      score: importance.score ?? null,
      decision_relevance: importance.decision_relevance ?? null,
      reactor_reach: importance.reactor_reach ?? null,
      direct_reactors: importance.direct_reactors ?? null,
      enabled_descendants: importance.enabled_descendants ?? null,
      abstraction: importance.abstraction ?? null,
      rationale: importance.relevance_rationale ?? null,
    },
    description: fm.description ?? null,
    source_descriptions: fm.source_descriptions ?? [],
    broader: (fm.broader ?? []).map((b: Yaml) => ({ id: b.id, name: b.name, provenance: b.provenance ?? [] })),
    narrower: (fm.narrower ?? []).map((b: Yaml) => ({ id: b.id, name: b.name })),
    enables: {
      reactors: (fm.enables?.reactors ?? []).map((r: Yaml) => ({
        id: r.id,
        name: r.name,
        verified: r.verified ?? false,
        role: r.evidence?.[0]?.role ?? null,
        quote: r.evidence?.[0]?.quote ?? null,
        document: r.evidence?.[0]?.document ?? null,
      })),
      technologies: (fm.enables?.technologies ?? []).map((t: Yaml) => ({
        id: t.id,
        name: t.name,
        provenance: t.provenance ?? [],
      })),
    },
    enabled_by: (fm.enabled_by ?? []).map((e: Yaml) => ({
      id: e.id,
      name: e.name,
      provenance: e.provenance ?? [],
      relation_type: e.relation_type ?? null,
      rationale: e.rationale ?? null,
      citations: trimCitations(e.citations),
    })),
    deployment: deployment
      ? {
          availability: deployment.availability ?? null,
          trl_band: deployment.trl_band ?? null,
          summary: deployment.summary ?? null,
          suppliers: (deployment.suppliers ?? []).map((s: Yaml) => ({
            name: s.name,
            role: s.role ?? null,
            location: s.location ?? null,
            url: s.url ?? null,
            org_id: s.org_id ?? null,
          })),
          milestones: deployment.milestones ?? [],
          scaling_factors: deployment.scaling_factors ?? [],
        }
      : null,
  });
}

// ---------------------------------------------------------------------------
// Edges (tech tree)
// ---------------------------------------------------------------------------

const nodeIds = new Set(nodeDocs.map((n) => n.id as string));
const edgeDocs = graph.edges
  .filter((e) => e.type === 'ENABLES' && nodeIds.has(e.source) && nodeIds.has(e.target))
  .map((e) => {
    const provenance: string[] = e.provenance ?? [];
    return {
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      relation_type: e.relation_type ?? (e.target.startsWith('smr:') ? 'used_in_design' : null),
      provenance,
      source_backed: provenance.some((p) => p === 'source' || p === 'literature'),
      verified: e.verified ?? null,
    };
  });

// ---------------------------------------------------------------------------
// Organisations -> companies
// ---------------------------------------------------------------------------

const AGGREGATOR_DOMAINS = /(linkedin|wikipedia|tavily|tracxn|crunchbase|bloomberg|pitchbook|zoominfo|craft\.co|cbinsights|dnb\.com|world-nuclear|reuters|google)/i;

function websiteDomain(urls: string[]): string | null {
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (!AGGREGATOR_DOMAINS.test(host)) return host;
    } catch {
      /* ignore malformed urls */
    }
  }
  return null;
}

const KIND_LABELS: Record<string, string> = {
  private_company: 'Private company',
  public_company: 'Public company',
  state_owned: 'State-owned enterprise',
  government: 'Government body',
  university: 'University',
  nonprofit: 'Non-profit',
  research_lab: 'Research laboratory',
  unknown: 'Unknown',
};

// manufacturing/supply locations per org from technology deployment tables
const supplyCountries = new Map<string, Set<string>>();
for (const { fm } of techFiles) {
  for (const s of fm.deployment?.suppliers ?? []) {
    if (!s.org_id || !['manufacturer', 'supplier'].includes(s.role)) continue;
    const iso = locationToIso(s.location);
    if (!iso) continue;
    const set = supplyCountries.get(s.org_id) ?? new Set<string>();
    set.add(iso);
    supplyCountries.set(s.org_id, set);
  }
}

const orgEdges = graph.edges.filter((e) => e.type === 'DEVELOPS' || e.type === 'SUPPLIES');
const companyDocs: Document[] = [];
const mappingDocs: Document[] = [];

for (const { file, fm } of orgFiles) {
  if (fm.type !== 'Organisation') continue;
  const companyId = stripPrefix(fm.id);
  const hqParts = (fm.hq ?? '').split(',').map((p: string) => p.trim()).filter(Boolean);
  const countryIso = hqParts.length ? locationToIso(fm.hq) : null;
  const develops = orgEdges.filter((e) => e.source === fm.id && e.type === 'DEVELOPS');
  const supplies = orgEdges.filter((e) => e.source === fm.id && e.type === 'SUPPLIES');
  const roles = unique<string>(supplies.flatMap((e) => e.roles ?? []));

  let logoImageId: string | null = null;
  const logoFile: string | undefined = typeof fm.logo === 'string' ? fm.logo : fm.logo?.file;
  if (logoFile) {
    const abs = path.resolve(path.dirname(file), logoFile);
    if (fs.existsSync(abs)) {
      logoImageId = `logo-${companyId}`;
      imageDocs.push({
        id: logoImageId,
        owner_id: fm.id,
        kind: 'logo',
        caption: fm.name,
        category: 'logo',
        width: null,
        height: null,
        content_type: abs.endsWith('.png') ? 'image/png' : 'image/jpeg',
        sha1: null,
        data: new Binary(fs.readFileSync(abs)),
      });
    }
  }

  const founded = typeof fm.founded === 'number' ? fm.founded : parseInt(String(fm.founded ?? ''), 10);
  const primaryNode = develops[0]?.target ?? supplies[0]?.target ?? null;

  companyDocs.push({
    id: companyId,
    org_id: fm.id,
    canonical_name: fm.name,
    aliases: fm.aliases ?? [],
    organisation_kind: KIND_LABELS[fm.kind] ?? fm.kind ?? null,
    primary_approach: develops.length
      ? 'SMR developer'
      : roles.length
        ? roles.map((r) => titleCase(r)).join(' / ')
        : KIND_LABELS[fm.kind] ?? null,
    description: fm.description ?? null,
    country_iso: countryIso,
    linkedin_headquarters: fm.hq ?? null,
    manufacturing_countries: [...(supplyCountries.get(fm.id) ?? [])],
    founded_year: Number.isFinite(founded) ? founded : null,
    headcount_range: fm.size ?? null,
    ticker: fm.ticker ?? null,
    valuation: fm.valuation ?? null,
    domain: websiteDomain(fm.urls ?? []),
    source_url: fm.urls?.[0] ?? null,
    tech_tree_primary_node: primaryNode,
    tech_tree_all_nodes: unique([...develops, ...supplies].map((e) => e.target)),
    develops: develops.map((e) => e.target),
    supply_roles: roles,
    stakeholders: (fm.stakeholders ?? []).map((s: Yaml) => ({ name: s.name, relation: s.relation, url: s.url ?? null })),
    sources: fm.sources ?? [],
    confidence: fm.confidence ?? null,
    logo_image_id: logoImageId,
  });

  for (const e of [...develops, ...supplies]) {
    if (!nodeIds.has(e.target)) continue;
    const isDevelops = e.type === 'DEVELOPS';
    mappingDocs.push({
      id: `${companyId}__${e.target}`,
      company_id: companyId,
      tech_tree_node_id: e.target,
      is_primary: isDevelops,
      confidence: null,
      method: isDevelops ? 'develops' : 'supplies',
      reasoning: isDevelops
        ? `Developer of ${nodeNames.get(e.target) ?? e.target}`
        : `Role: ${(e.roles ?? []).join(', ') || 'supplier'}`,
      roles: e.roles ?? [],
    });
  }
}

// ---------------------------------------------------------------------------
// Geocoding (Nominatim, cached)
// ---------------------------------------------------------------------------

interface GeoHit {
  lat: number;
  lon: number;
  display_name: string;
}

async function geocodeAll(): Promise<Document[]> {
  const cache: Record<string, GeoHit | null> = fs.existsSync(GEOCODE_CACHE_PATH)
    ? JSON.parse(fs.readFileSync(GEOCODE_CACHE_PATH, 'utf8'))
    : {};
  const pending = unique(
    companyDocs.map((c) => c.linkedin_headquarters as string | null).filter((hq): hq is string => !!hq && !(hq in cache)),
  );
  if (pending.length && SKIP_GEOCODE) {
    console.warn(`  SKIP_GEOCODE: ${pending.length} uncached HQs left unlocated`);
  } else if (pending.length) {
    console.log(`  geocoding ${pending.length} HQs via Nominatim (~${Math.ceil(pending.length * 1.1)}s) ...`);
    for (const [index, hq] of pending.entries()) {
      const iso = locationToIso(hq);
      const params = new URLSearchParams({ q: hq, format: 'jsonv2', limit: '1' });
      if (iso) params.set('countrycodes', iso.toLowerCase());
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
          headers: { 'User-Agent': NOMINATIM_USER_AGENT, 'Accept-Language': 'en' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const [hit] = (await res.json()) as { lat: string; lon: string; display_name: string }[];
        cache[hq] = hit ? { lat: Number(hit.lat), lon: Number(hit.lon), display_name: hit.display_name } : null;
      } catch (err) {
        console.warn(`  geocode failed for "${hq}": ${(err as Error).message}`);
      }
      if ((index + 1) % 25 === 0) {
        fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 1));
        console.log(`  ... ${index + 1}/${pending.length}`);
      }
      await new Promise((r) => setTimeout(r, 1100));
    }
    fs.writeFileSync(GEOCODE_CACHE_PATH, JSON.stringify(cache, null, 1));
  }

  return compact(
    companyDocs.map((c) => {
      const hq = c.linkedin_headquarters as string | null;
      const hit = hq ? cache[hq] : null;
      if (!hit || !c.country_iso) return null;
      return {
        company_id: c.id,
        label: hq!.split(',').slice(0, -1).join(',').trim() || hq,
        country_iso: c.country_iso,
        latitude: hit.lat,
        longitude: hit.lon,
        source_field: 'hq',
        source_url: c.source_url ?? null,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

async function main() {
  const locationDocs = await geocodeAll();

  const reactorCount = nodeDocs.filter((n) => n.type === 'ReactorConcept').length;
  const imageBytes = imageDocs.reduce((sum, d) => sum + (d.data as Binary).length(), 0);
  console.log(`Parsed from ${DATA_DIR}:`);
  console.log(`  nodes            ${nodeDocs.length} (${reactorCount} reactors, ${nodeDocs.length - reactorCount} technologies)`);
  console.log(`  edges            ${edgeDocs.length} (${edgeDocs.filter((e) => e.source_backed).length} source-backed)`);
  console.log(`  node_details     ${detailDocs.length}`);
  console.log(`  images           ${imageDocs.length} (${(imageBytes / 1e6).toFixed(1)} MB)`);
  console.log(`  companies        ${companyDocs.length} (${companyDocs.filter((c) => c.country_iso).length} with HQ country)`);
  console.log(`  company mappings ${mappingDocs.length}`);
  console.log(`  locations        ${locationDocs.length}`);

  if (DRY_RUN) return;
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set');

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db(DB_NAME);
    const writes: [string, Document[], Document][] = [
      ['nodes', nodeDocs, { id: 1 }],
      ['edges', edgeDocs, { id: 1 }],
      ['node_details', detailDocs, { id: 1 }],
      ['images', imageDocs, { id: 1 }],
      ['tt_companies', companyDocs, { id: 1 }],
      ['company_tech_tree_edges', mappingDocs, { id: 1 }],
      ['tt_company_locations', locationDocs, { company_id: 1 }],
    ];
    for (const [name, docs, key] of writes) {
      const collection = db.collection(name);
      await collection.deleteMany({});
      // images are inserted in small batches to stay well below the 48MB message limit
      const batch = name === 'images' ? 50 : 1000;
      for (let i = 0; i < docs.length; i += batch) await collection.insertMany(docs.slice(i, i + batch));
      await collection.createIndex(key, { unique: true });
      console.log(`  wrote ${DB_NAME}.${name}: ${docs.length}`);
    }
    await db.collection('company_tech_tree_edges').createIndex({ tech_tree_node_id: 1 });
    await db.collection('images').createIndex({ owner_id: 1 });
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
