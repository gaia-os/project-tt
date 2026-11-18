import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NodeLabel, TechTree } from '@/lib/types';

interface DatasetNode {
  id: string;
  label: string;
  type: NodeLabel;
  category?: string;
  subtype?: string;
  trl_current?: string;
  trl_projected_5_10_years?: string;
  description?: string;
  detailedDescription?: string;
}

interface DatasetEdge {
  id: string;
  source: string;
  target: string;
}

/** Loads a `data/*.json` source file shaped like `GET /api/tech-tree`. */
export function loadDatasetTree(fileName: string): TechTree {
  const filePath = path.join(process.cwd(), 'data', fileName);
  const { graph } = JSON.parse(readFileSync(filePath, 'utf8')) as {
    graph: { nodes: DatasetNode[]; edges: DatasetEdge[] };
  };

  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      data: {
        label: node.label,
        nodeLabel: node.type,
        description: node.label,
        detailedDescription: node.description || node.detailedDescription,
        category: node.category,
        subtype: node.subtype,
        trl_current: node.trl_current,
        trl_projected_5_10_years: node.trl_projected_5_10_years,
      },
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
  };
}
