import { Edge } from '@xyflow/react';
import {
  ChatMention,
  CompanySummary,
  CompanyTechnologyMapping,
  DataNode,
  TechTree,
} from '@/lib/types';
import type { CompanyDirectoryEntry } from '@/lib/companyGraph';

/** Company cards ChatView may show, plus every mapping for their details. */
export interface ChatCompanies {
  entries: CompanyDirectoryEntry[];
  mappings: CompanyTechnologyMapping[];
}

/*
 * The kg-service bolds named entities in answers and emits them (linked to
 * KG entities) as `ChatMention`s. These helpers match them to the tech tree
 * the visitor is looking at: the resolved canonical name first, then the raw
 * span, so tree nodes the KG does not know still match by label.
 */

const normalize = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function labelIndex(tree: TechTree): Map<string, DataNode> {
  const byLabel = new Map<string, DataNode>();
  for (const node of tree.nodes) {
    const key = normalize(node.data.label ?? '');
    if (key && !byLabel.has(key)) byLabel.set(key, node);
  }
  return byLabel;
}

export interface MentionMatch {
  /** Tree nodes mentioned in the answer, in order of first mention. */
  nodes: DataNode[];
  /** Resolved KG entities with no node on this tree. */
  unmatched: ChatMention[];
}

export type MentionMatcher = (mentions: ChatMention[]) => MentionMatch;

/** Matcher bound to one tree's label index — built once, used per message. */
export function createMentionMatcher(tree: TechTree): MentionMatcher {
  const byLabel = labelIndex(tree);
  return (mentions) => {
    const seen = new Set<string>();
    const nodes: DataNode[] = [];
    const unmatched: ChatMention[] = [];
    for (const mention of mentions) {
      // Composite spans like "ACP100/Linglong One" or "RITM-200M/N/S" rarely
      // match a single label — try each part as well.
      const candidates = [
        mention.name,
        mention.text,
        ...mention.text.split('/'),
      ]
        .filter((part): part is string => !!part && part.trim().length >= 3)
        .map(normalize);
      const node = candidates
        .map((candidate) => byLabel.get(candidate))
        .find((match): match is DataNode => !!match);
      if (node) {
        if (!seen.has(node.id)) {
          seen.add(node.id);
          nodes.push(node);
        }
      } else if (mention.name) {
        unmatched.push(mention);
      }
    }
    return { nodes, unmatched };
  };
}

const COMPANY_SUFFIX =
  /\s+(inc|incorporated|ltd|limited|llc|plc|corp|corporation|co|company|gmbh|ag|sa|nv|bv)$/;

/** Name keys for a company: normalized, and without a legal-form suffix. */
const companyKeys = (text: string): string[] => {
  const key = normalize(text);
  const bare = key.replace(COMPANY_SUFFIX, '');
  return bare && bare !== key ? [key, bare] : [key];
};

export interface CompanyMentionMatch<T> {
  /** Company cards named in the answer, in order of first mention. */
  companies: T[];
  /** The mentions that resolved to one of `companies`. */
  matched: Set<ChatMention>;
}

/**
 * Companies named in an answer, limited to `entries` (the cards the Company
 * view shows) so every match opens a real card.
 */
export function matchMentionsToCompanies<T extends { company: CompanySummary }>(
  mentions: ChatMention[],
  entries: T[],
): CompanyMentionMatch<T> {
  const byName = new Map<string, T>();
  for (const entry of entries) {
    for (const key of companyKeys(entry.company.canonical_name)) {
      if (key && !byName.has(key)) byName.set(key, entry);
    }
  }
  const seen = new Set<string>();
  const companies: T[] = [];
  const matched = new Set<ChatMention>();
  for (const mention of mentions) {
    const entry = [mention.name, mention.text, ...mention.text.split('/')]
      .filter((part): part is string => !!part && part.trim().length >= 3)
      .flatMap(companyKeys)
      .map((key) => byName.get(key))
      .find((match): match is T => !!match);
    if (!entry) continue;
    matched.add(mention);
    if (!seen.has(entry.company.id)) {
      seen.add(entry.company.id);
      companies.push(entry);
    }
  }
  return { companies, matched };
}

export function matchMentionsToTree(
  mentions: ChatMention[],
  tree: TechTree,
): MentionMatch {
  return createMentionMatcher(tree)(mentions);
}

/** Tree edges with both ends among the mentioned nodes (deduped). */
export function mentionEdges(nodes: DataNode[], edges: Edge[]): Edge[] {
  const ids = new Set(nodes.map((node) => node.id));
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (!ids.has(edge.source) || !ids.has(edge.target)) return false;
    const key = `${edge.source}->${edge.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
