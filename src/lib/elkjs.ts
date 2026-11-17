import {
  LABEL_COLORS_VARIABLES,
  NodeLabel,
  UiNode,
  GroupingMode,
  TechTree,
} from '@/lib/types';
import { Edge, MarkerType, Position } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

const nodeWidth = 150;
const nodeHeight = 80;

export const getLayoutedElements = async (
  groupingMode: GroupingMode = 'None',
  selectedNodeId: string | null = null,
  showOnlyConnected: boolean = false,
  searchTerm: string = '',
  techTree: TechTree, // Add techTree parameter
): Promise<{
  layoutedNodes: UiNode[];
  layoutedEdges: Edge[];
}> => {
  // Convert techTree nodes to UiNodes
  const allUiNodes = techTree.nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
    },
  })) as UiNode[];

  // Route to appropriate layout method
  if (groupingMode === 'None') {
    return getUnGroupedLayout(selectedNodeId, searchTerm, allUiNodes, techTree.edges);
  }

  if (selectedNodeId) {
    return getRelatedNodesLayoutWithGrouping(
      selectedNodeId,
      groupingMode,
      showOnlyConnected,
      searchTerm,
      allUiNodes,
      techTree.edges,
    );
  }

  return await getGroupedLayout(groupingMode, searchTerm, allUiNodes, techTree.edges);
};

// Update all helper functions to accept edges parameter
const getUnGroupedLayout = async (
  showingRelatedNodes: string | null = null,
  searchTerm: string = '',
  allUiNodes: UiNode[],
  dataEdges: Edge[],
) => {
  let visibleNodes = filterNodesBySearch(allUiNodes, searchTerm);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  let visibleEdges = filterEdgesByVisibleNodes(dataEdges, visibleNodeIds);

  if (showingRelatedNodes) {
    const { connectedNodeIds, connectedEdgeIds } = findConnectedNodesAndEdges(
      showingRelatedNodes,
      visibleEdges,
    );
    visibleNodes = allUiNodes.filter((node) => connectedNodeIds.has(node.id));
    visibleEdges = visibleEdges.filter((edge) => connectedEdgeIds.has(edge.id));
  }

  const preparedNodes = prepareUiNodes(visibleNodes);
  return await layoutGraph(
    preparedNodes,
    visibleEdges,
    showingRelatedNodes || undefined,
  );
};

// Continue updating other helper functions similarly...
// (I'll include the key ones below)

const getRelatedNodesLayoutWithGrouping = async (
  selectedNodeId: string,
  groupingMode: GroupingMode,
  showOnlyConnected: boolean = false,
  searchTerm: string = '',
  allUiNodes: UiNode[],
  dataEdges: Edge[],
) => {
  const { connectedNodeIds, connectedEdgeIds } = findConnectedNodesAndEdges(
    selectedNodeId,
    dataEdges,
  );

  if (!showOnlyConnected) {
    const nodesOfGroupingType = allUiNodes.filter(
      (node) => node.data.nodeLabel === groupingMode,
    );
    nodesOfGroupingType.forEach((node) => {
      connectedNodeIds.add(node.id);
    });
  }

  const connectedNodes = allUiNodes.filter((node) =>
    connectedNodeIds.has(node.id),
  );

  const filteredConnectedNodes = filterNodesBySearch(
    connectedNodes,
    searchTerm,
  );
  const visibleNodes = prepareUiNodes(filteredConnectedNodes);

  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = dataEdges.filter((edge) => {
    const sourceVisible = visibleNodeIds.has(edge.source);
    const targetVisible = visibleNodeIds.has(edge.target);
    const isConnectedToSelected = connectedEdgeIds.has(edge.id);
    const isBetweenSameCategory = sourceVisible && targetVisible;

    if (showOnlyConnected) {
      return isConnectedToSelected;
    }

    return isConnectedToSelected || isBetweenSameCategory;
  });

  return await layoutGraph(visibleNodes, visibleEdges, selectedNodeId);
};

const getGroupedLayout = async (
  groupingMode: string,
  searchTerm: string,
  allUiNodes: UiNode[],
  dataEdges: Edge[],
) => {
  const nodesOfGroupingType = allUiNodes.filter(
    (node) => node.data.nodeLabel === groupingMode,
  );

  const filteredNodes = filterNodesBySearch(nodesOfGroupingType, searchTerm);
  const visibleNodes = prepareUiNodes(filteredNodes);

  const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = filterEdgesByVisibleNodes(dataEdges, visibleNodeIds);

  return await layoutGraph(visibleNodes, visibleEdges);
};

// Keep all other helper functions unchanged
const filterNodesBySearch = (nodes: UiNode[], searchTerm: string): UiNode[] => {
  if (!searchTerm.trim()) {
    return nodes;
  }

  try {
    const regex = new RegExp(searchTerm, 'i');
    return nodes.filter((node) => {
      const label = node.data?.label || '';
      return regex.test(label);
    });
  } catch {
    const searchLower = searchTerm.toLowerCase();
    return nodes.filter((node) => {
      const label = node.data?.label || '';
      return label.toLowerCase().includes(searchLower);
    });
  }
};

const prepareUiNodes = (nodes: UiNode[]): UiNode[] => {
  return nodes.map((node) => ({
    ...node,
    width: nodeWidth,
    height: nodeHeight,
    targetPosition: Position.Left,
    sourcePosition: Position.Right,
  }));
};

const filterEdgesByVisibleNodes = (
  edges: Edge[],
  visibleNodeIds: Set<string>,
): Edge[] => {
  return edges.filter((edge) => {
    const sourceVisible = visibleNodeIds.has(edge.source);
    const targetVisible = visibleNodeIds.has(edge.target);
    return sourceVisible && targetVisible;
  });
};

const findConnectedNodesAndEdges = (nodeId: string, edges: Edge[]) => {
  const connectedNodeIds = new Set<string>([nodeId]);
  const connectedEdgeIds = new Set<string>();

  edges.forEach((edge) => {
    if (edge.source === nodeId || edge.target === nodeId) {
      connectedEdgeIds.add(edge.id);
      connectedNodeIds.add(edge.source);
      connectedNodeIds.add(edge.target);
    }
  });

  return { connectedNodeIds, connectedEdgeIds };
};

const layoutGraph = async (
  visibleNodes: UiNode[],
  visibleEdges: Edge[],
  selectedNodeId?: string,
) => {
  // Reactors are the end of every chain, so in a mixed view they all belong in
  // the last (rightmost) layer. Two things otherwise scatter them: each reactor
  // sits one layer after its own longest chain of technologies, and ELK lays
  // out disconnected parts of the tree side by side, each with its own layers.
  // Views with only reactors (or none) keep ELK's default packing.
  const isReactor = (node: UiNode) => node.data?.nodeLabel === 'ReactorConcept';
  const pinReactors = visibleNodes.some(isReactor) && !visibleNodes.every(isReactor);

  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      ...(pinReactors ? { 'elk.separateConnectedComponents': 'false' } : {}),
    },
    children: visibleNodes.map((node) => ({
      ...node,
      ...(pinReactors && isReactor(node)
        ? { layoutOptions: { 'elk.layered.layering.layerConstraint': 'LAST' } }
        : {}),
    })),
    edges: visibleEdges.map((edge) => ({
      id: `${edge.source}-${edge.target}`,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  const layoutedGraph = await elk.layout(graph);

  const layoutedNodes = visibleNodes.map((node) => {
    const layoutedNode = layoutedGraph.children?.find((n) => n.id === node.id);

    const positionedNode = {
      ...node,
      position: {
        x: (layoutedNode?.x || 0) - nodeWidth / 2,
        y: (layoutedNode?.y || 0) - nodeHeight / 2,
      },
    } as UiNode;

    return applyNodeStyling(positionedNode, selectedNodeId);
  });

  const layoutedEdges = visibleEdges.map(applyEdgeStyling);

  return {
    layoutedNodes,
    layoutedEdges,
  };
};

const applyNodeStyling = (node: UiNode, selectedNodeId?: string): UiNode => {
  return {
    ...node,
    style: {
      borderColor: `${LABEL_COLORS_VARIABLES[node.data.nodeLabel as NodeLabel]}`,
      borderStyle: 'solid',
      borderRadius: '6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center',
      borderWidth: node.id === selectedNodeId ? '3px' : '1px',
      boxShadow: node.id === selectedNodeId ? '0 0 0 2px #f97316' : 'none',
      fontWeight: node.id === selectedNodeId ? 'bold' : 'normal',
    },
  } as UiNode;
};

const applyEdgeStyling = (edge: Edge): Edge => {
  return {
    ...edge,
    style: {
      strokeWidth: 1,
      stroke: '#374151',
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: '#374151',
    },
  };
};