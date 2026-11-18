import { DataNode, TechTree } from '@/lib/types';
import {
  DEFAULT_MIN_RELEVANCE,
  filterSmrTechTree,
  isSmrTree,
} from '@/lib/smrFilters';
import {
  cleanConceptLabel,
  countPrerequisites,
  createGraphIndex,
  parseTrl,
} from '@/lib/pathway';

export interface TechnologyCatalogSmrFacts {
  status: string | null;
  electricMwe: number | null;
  coolant: string | null;
  countries: string[];
  coverImageId: string | null;
}

/** One pickable deployment concept, shaped for the onboarding cards. */
export interface TechnologyCatalogEntry {
  id: string;
  /** Cleaned label, disambiguated when several concepts share it. */
  label: string;
  category: string | null;
  trl: number | null;
  trlLabel: string | null;
  blurb: string | null;
  prerequisiteCount: number;
  smr: TechnologyCatalogSmrFacts | null;
}

export interface TreeSummary {
  concepts: number;
  milestones: number;
  technologies: number;
}

const SUGGESTED_LIMIT = 6;

/**
 * A short, diverse shortlist for first-run picking: last-viewed first, then
 * one per category, then fill by moderate prerequisite depth.
 */
export function suggestTechnologies(
  catalog: TechnologyCatalogEntry[],
  lastTechnologyId: string | null = null,
  limit: number = SUGGESTED_LIMIT,
): TechnologyCatalogEntry[] {
  if (catalog.length <= limit) return [...catalog];

  const picked: TechnologyCatalogEntry[] = [];
  const seen = new Set<string>();
  const take = (entry: TechnologyCatalogEntry | undefined) => {
    if (!entry || seen.has(entry.id) || picked.length >= limit) return;
    seen.add(entry.id);
    picked.push(entry);
  };

  if (lastTechnologyId) {
    take(catalog.find((entry) => entry.id === lastTechnologyId));
  }

  const byCategory = new Map<string, TechnologyCatalogEntry>();
  for (const entry of catalog) {
    const key = entry.category ?? 'Other';
    if (!byCategory.has(key)) byCategory.set(key, entry);
  }
  for (const entry of byCategory.values()) take(entry);

  const ranked = [...catalog].sort((left, right) => {
    const leftScore =
      left.prerequisiteCount > 0 ? Math.abs(left.prerequisiteCount - 8) : 99;
    const rightScore =
      right.prerequisiteCount > 0 ? Math.abs(right.prerequisiteCount - 8) : 99;
    return leftScore - rightScore || left.label.localeCompare(right.label);
  });
  for (const entry of ranked) take(entry);

  return picked;
}

const BLURB_MAX_LENGTH = 180;

/** First sentence of a description, cut at a word boundary if too long. */
export function summarizeBlurb(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const firstSentence =
    normalized.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? normalized;
  if (firstSentence.length <= BLURB_MAX_LENGTH) return firstSentence;

  const cut = firstSentence.slice(0, BLURB_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : BLURB_MAX_LENGTH).replace(/[\s,;:–-]+$/, '')}…`;
}

/**
 * The tree guided pathways are built on: SMR trees use the default detail
 * threshold so card counts match what the pathway shows.
 */
export function pathwaySourceTree(
  tree: TechTree,
  minRelevance: number = DEFAULT_MIN_RELEVANCE,
): TechTree {
  return isSmrTree(tree)
    ? filterSmrTechTree(tree, {
        minRelevance,
        sourceBackedOnly: false,
        category: 'All',
      })
    : tree;
}

function smrFacts(node: DataNode): TechnologyCatalogSmrFacts | null {
  const smr = node.data.smr;
  if (smr?.kind !== 'reactor') return null;
  return {
    status: smr.status,
    electricMwe: smr.electric_mwe,
    coolant: smr.coolant,
    countries: smr.countries,
    coverImageId: smr.cover_image_id,
  };
}

function blurbFor(node: DataNode, facts: TechnologyCatalogSmrFacts | null) {
  if (facts) {
    const parts = [
      facts.status,
      facts.electricMwe ? `${facts.electricMwe} MWe` : null,
      facts.coolant,
    ].filter(Boolean);
    if (parts.length) return parts.join(' · ');
  }
  // The API copies the label into `description`, so only a distinct one counts.
  const { label, description, detailedDescription } = node.data;
  if (description && description !== label) return summarizeBlurb(description);
  if (detailedDescription) return summarizeBlurb(detailedDescription);
  return null;
}

function disambiguate(entries: TechnologyCatalogEntry[]): TechnologyCatalogEntry[] {
  const countLabels = (list: TechnologyCatalogEntry[]) => {
    const counts = new Map<string, number>();
    list.forEach((entry) => counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1));
    return counts;
  };

  const firstCounts = countLabels(entries);
  const withTrl = entries.map((entry) =>
    firstCounts.get(entry.label)! > 1 && entry.trlLabel
      ? { ...entry, label: `${entry.label} (TRL ${entry.trlLabel})` }
      : entry,
  );
  const secondCounts = countLabels(withTrl);
  return withTrl.map((entry) =>
    secondCounts.get(entry.label)! > 1
      ? { ...entry, label: `${entry.label} [${entry.id}]` }
      : entry,
  );
}

/** Pickable deployment concepts of a tree, in source order. */
export function buildTechnologyCatalog(tree: TechTree): TechnologyCatalogEntry[] {
  const index = createGraphIndex(pathwaySourceTree(tree));
  const entries = tree.nodes
    .filter((node) => node.data.nodeLabel === 'ReactorConcept')
    .map((node): TechnologyCatalogEntry => {
      const facts = smrFacts(node);
      return {
        id: node.id,
        label: cleanConceptLabel(node.data.label),
        category: node.data.category ?? null,
        trl: parseTrl(node.data.trl_current),
        trlLabel: node.data.trl_current ?? null,
        blurb: blurbFor(node, facts),
        prerequisiteCount: countPrerequisites(index, node.id),
        smr: facts,
      };
    });
  return disambiguate(entries);
}

export function summarizeTree(tree: TechTree): TreeSummary {
  const summary: TreeSummary = { concepts: 0, milestones: 0, technologies: 0 };
  for (const node of tree.nodes) {
    if (node.data.nodeLabel === 'ReactorConcept') summary.concepts++;
    else if (node.data.nodeLabel === 'Milestone') summary.milestones++;
    else if (node.data.nodeLabel === 'EnablingTechnology') summary.technologies++;
  }
  return summary;
}
