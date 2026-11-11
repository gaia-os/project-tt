import { SmrEdgeData, TechTree } from '@/lib/types';

export const DEFAULT_MIN_RELEVANCE = 4;

export interface SmrTreeFilters {
  /** Minimum technology decision relevance; 0 shows every technology. */
  minRelevance: number;
  /** Drop relations that are only LLM-inferred. */
  sourceBackedOnly: boolean;
  /** 'All' or a node category; keeps nodes of that category plus their direct neighbours. */
  category: string;
}

export function isSmrTree(techTree: TechTree | null | undefined): boolean {
  return !!techTree?.nodes.some((node) => node.data.smr);
}

/**
 * Chat context for the LLM. SMR trees are far too large to send verbatim, so
 * keep every reactor (with key facts) plus only the top-relevance technologies
 * (names only); other trees pass through unchanged.
 */
export function chatContextTree(techTree: TechTree | null | undefined): TechTree {
  if (!techTree) return { nodes: [], edges: [] };
  if (!isSmrTree(techTree)) return techTree;

  const nodes = techTree.nodes.flatMap((node) => {
    const smr = node.data.smr;
    const base = {
      label: node.data.label,
      nodeLabel: node.data.nodeLabel,
      category: node.data.category,
      trl_current: node.data.trl_current,
      description: '',
    };
    if (smr?.kind === 'reactor') {
      const facts = [
        smr.status,
        smr.electric_mwe != null ? `${smr.electric_mwe} MWe` : null,
        smr.coolant,
        smr.countries.join('/'),
        node.data.detailedDescription,
      ].filter(Boolean);
      return [{ id: node.id, data: { ...base, detailedDescription: facts.join('; ') } }];
    }
    if (smr?.kind === 'technology' && smr.relevance >= 5) {
      return [{ id: node.id, data: base }];
    }
    return [];
  });

  return { nodes, edges: [] };
}

/**
 * Reduce a (large) SMR tech tree to a renderable subgraph. Reactors are never
 * dropped by the relevance threshold; technologies without a rating count as 0.
 */
export function filterSmrTechTree(techTree: TechTree, filters: SmrTreeFilters): TechTree {
  const keptIds = new Set(
    techTree.nodes
      .filter((node) => {
        const smr = node.data.smr;
        return !smr || smr.kind !== 'technology' || smr.relevance >= filters.minRelevance;
      })
      .map((node) => node.id),
  );

  let edges = techTree.edges.filter((edge) => {
    if (!keptIds.has(edge.source) || !keptIds.has(edge.target)) return false;
    return !filters.sourceBackedOnly || (edge.data as SmrEdgeData | undefined)?.source_backed !== false;
  });

  if (filters.category !== 'All') {
    const categoryIds = new Set(
      techTree.nodes
        .filter((node) => keptIds.has(node.id) && node.data.category === filters.category)
        .map((node) => node.id),
    );
    edges = edges.filter((edge) => categoryIds.has(edge.source) || categoryIds.has(edge.target));
    const neighbourIds = new Set(categoryIds);
    edges.forEach((edge) => {
      neighbourIds.add(edge.source);
      neighbourIds.add(edge.target);
    });
    return {
      nodes: techTree.nodes.filter((node) => neighbourIds.has(node.id)),
      edges,
    };
  }

  return {
    nodes: techTree.nodes.filter((node) => keptIds.has(node.id)),
    edges,
  };
}
