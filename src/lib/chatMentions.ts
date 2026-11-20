import { Edge } from '@xyflow/react';
import { ChatMention, DataNode, TechTree } from '@/lib/types';

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

export function matchMentionsToTree(
  mentions: ChatMention[],
  tree: TechTree,
): MentionMatch {
  const byLabel = labelIndex(tree);
  const seen = new Set<string>();
  const nodes: DataNode[] = [];
  const unmatched: ChatMention[] = [];
  for (const mention of mentions) {
    const node =
      (mention.name ? byLabel.get(normalize(mention.name)) : undefined) ??
      byLabel.get(normalize(mention.text));
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
