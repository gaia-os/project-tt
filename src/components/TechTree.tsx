'use client';

import { getLayoutedElements } from '@/lib/elkjs';
import { HighlightedElements, UiNode, GroupingMode, CompanyInfo, CompanyNodeData, KgEntity, KgExpandResponse, KgPaperDossier, LiteratureNodeData } from '@/lib/types';
import { TopicKey } from '@/lib/topicConfig';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { Legend } from './Legend';
import { LoadingSpinner } from './LoadingSpinner';
import { GroupSelector } from './GroupSelector';
import { KnowledgeBaseSelector } from './KnowledgeBaseSelector';
import { CustomNode } from './CustomNode';
import { CompanyNode } from './CompanyNode';
import { MoreCompaniesNode, MoreCompaniesNodeData } from './MoreCompaniesNode';
import { LiteratureNode } from './LiteratureNode';
import PaperDetails from './PaperDetails';
import LiteratureReview from './LiteratureReview';
import { VoteCounts, fetchVotes, optimisticVote } from '@/lib/votes';
import TabPanel from './TabPanel';
import EditInterface from './EditInterface';
import { useTechTree } from '@/hooks/useTechTree';
import { setAdminPassword, verifyAdminPassword } from '@/lib/adminClient';
import { DEFAULT_MIN_RELEVANCE, filterSmrTechTree, isSmrTree } from '@/lib/smrFilters';

// Suppress hydration warnings for Radix UI
if (typeof window !== 'undefined') {
  const originalError = console.error;
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Hydration failed') &&
      args[0].includes('aria-controls')
    ) {
      return;
    }
    originalError.apply(console, args);
  };
}

interface TechTreeProps {
  topic: TopicKey;
  onTopicChange: (value: TopicKey) => void;
  requestedTechnologyId?: string;
  technologyFocusRequestKey?: number;
}

function areSetsEqual(left: Set<string>, right: Set<string>): boolean {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

const TechTree: React.FC<TechTreeProps> = ({
  topic,
  onTopicChange,
  requestedTechnologyId,
  technologyFocusRequestKey,
}) => {
  const { techTree, isLoading: isLoadingData, error } = useTechTree(topic);
  const [isLoading, setIsLoading] = useState(true);
  const [nodes, setNodes] = useState<UiNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const layoutedNodesRef = useRef<UiNode[]>([]);
  const layoutedEdgesRef = useRef<Edge[]>([]);
  const [selectedNode, setSelectedNode] = useState<UiNode | undefined>(undefined);
  const [highlightedElements, setHighlightedElements] = useState<HighlightedElements>({
    nodeIds: new Set(),
    edgeIds: new Set(),
  });
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('None');
  const [showingRelatedNodes, setShowingRelatedNodes] = useState<string | null>(null);
  const [showOnlyConnected, setShowOnlyConnected] = useState<boolean>(false);
  const [searchInput, setSearchInput] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const [showLegend, setShowLegend] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // Company overlay state
  const [companyNodes, setCompanyNodes] = useState<UiNode[]>([]);
  const [companyEdges, setCompanyEdges] = useState<Edge[]>([]);
  const [expandedCompanyNodeIds, setExpandedCompanyNodeIds] = useState<Set<string>>(new Set());

  // Literature (KG) overlay state
  const [literatureNodes, setLiteratureNodes] = useState<UiNode[]>([]);
  const [literatureEdges, setLiteratureEdges] = useState<Edge[]>([]);
  const [expandedLiteratureNodeIds, setExpandedLiteratureNodeIds] = useState<Set<string>>(new Set());
  const [paperDossier, setPaperDossier] = useState<KgPaperDossier | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showLitEdgeLabels, setShowLitEdgeLabels] = useState(false);
  const [litVotes, setLitVotes] = useState<Map<string, VoteCounts>>(new Map());
  // 'overview': lit nodes on top of the full tree; 'focused': only parent + lit nodes
  const [litViewMode, setLitViewMode] = useState<'overview' | 'focused'>('overview');
  // nodeId -> {papers, weakMatch} for nodes that actually have KG enrichment
  const [enrichedNodes, setEnrichedNodes] = useState<Map<string, { papers: number; weakMatch: boolean }>>(new Map());
 
  // Category filtering state
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  // SMR-style trees (large, relevance-rated, provenance-tagged edges)
  const smrTree = useMemo(() => isSmrTree(techTree), [techTree]);
  const [minRelevance, setMinRelevance] = useState<number>(DEFAULT_MIN_RELEVANCE);
  const [sourceBackedOnly, setSourceBackedOnly] = useState<boolean>(false);
  const revealedFocusKeyRef = useRef<number | undefined>(undefined);
  const smrFilteredTree = useMemo(
    () =>
      techTree && smrTree
        ? filterSmrTechTree(techTree, {
            minRelevance,
            sourceBackedOnly,
            category: selectedCategory,
          })
        : null,
    [techTree, smrTree, minRelevance, sourceBackedOnly, selectedCategory],
  );

  // Refs to imperatively switch TabPanel tabs / sub-views
  const showNodeDetailsTabRef = useRef<(() => void) | null>(null);
  const showCompaniesSubViewRef = useRef<(() => void) | null>(null);

  const MAX_VISIBLE_COMPANIES = 5;
  
  const { fitView } = useReactFlow();

  // Extract unique categories from nodes
  const uniqueCategories = useMemo(() => {
    if (!techTree) return [];
    const categories = new Set<string>();
    categories.add('All');
    techTree.nodes.forEach(node => {
      if (node.data.category) {
        categories.add(node.data.category);
      }
    });
    return Array.from(categories).sort();
  }, [techTree]);

  const handleEnterEditMode = async () => {
    const password = prompt('Please enter the admin password:');
    if (password === null) return;
    if (await verifyAdminPassword(password)) {
      setAdminPassword(password);
      setIsEditing(true);
    } else {
      alert('Incorrect password.');
    }
  };

  const handleExitEditMode = () => {
    if (window.confirm('Are you sure you want to exit edit mode? Any unsaved changes will be lost.')) {
      setIsEditing(false);
    }
  };

  const handleOpenReview = async () => {
    const password = prompt('Please enter the admin password:');
    if (password === null) return;
    if (await verifyAdminPassword(password)) {
      setAdminPassword(password);
      setShowReview(true);
    } else {
      alert('Incorrect password.');
    }
  };

  // Function to find connected nodes and edges
  const findConnectedElements = useCallback(
    (nodeId: string, allEdges: Edge[]) => {
      const connectedNodeIds = new Set<string>();
      const connectedEdgeIds = new Set<string>();

      connectedNodeIds.add(nodeId);

      allEdges.forEach((edge) => {
        if (edge.source === nodeId || edge.target === nodeId) {
          connectedEdgeIds.add(edge.id);
          if (edge.source === nodeId) {
            connectedNodeIds.add(edge.target);
          }
          if (edge.target === nodeId) {
            connectedNodeIds.add(edge.source);
          }
        }
      });

      return { nodeIds: connectedNodeIds, edgeIds: connectedEdgeIds };
    },
    [],
  );

  useEffect(() => {
    setSearchTerm(searchInput);
  }, [searchInput, searchTerm]);

  // Fetch which nodes have KG literature (icon gating), once per topic.
  const refreshEnrichedNodes = useCallback(() => {
    fetch(`/investment-tech-tree/api/kg?topic=${topic}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.enrichedNodes) return;
        setEnrichedNodes(
          new Map(
            d.enrichedNodes.map((n: { nodeId: string; papers: number; weakMatch: boolean }) => [
              n.nodeId,
              { papers: n.papers, weakMatch: n.weakMatch },
            ]),
          ),
        );
      })
      .catch(() => {});
  }, [topic]);

  useEffect(() => {
    refreshEnrichedNodes();
  }, [refreshEnrichedNodes]);

  // Smoothly refit when entering or leaving focused literature mode.
  const litFocused =
    litViewMode === 'focused' && expandedLiteratureNodeIds.size > 0;
  useEffect(() => {
    fitView({ duration: 400, padding: 0.35 });
  }, [litFocused, fitView]);

  // Clear company overlay whenever the ELK layout is about to regenerate
  // so company nodes don't linger at stale positions.
  useEffect(() => {
    setCompanyNodes([]);
    setCompanyEdges([]);
    setExpandedCompanyNodeIds(new Set());
    setLiteratureNodes([]);
    setLiteratureEdges([]);
    setExpandedLiteratureNodeIds(new Set());
  }, [techTree, groupingMode, showingRelatedNodes, showOnlyConnected, searchTerm, selectedCategory, smrFilteredTree]);

  useEffect(() => {
    if (!techTree) return;

    const loadLayout = async () => {
      setIsLoading(true);
      
      // Apply category filter
      let filteredTechTree = smrFilteredTree ?? techTree;
      if (!smrFilteredTree && selectedCategory !== 'All') {
        filteredTechTree = {
          nodes: techTree.nodes.filter(node => node.data.category === selectedCategory),
          edges: techTree.edges.filter(edge => {
            const sourceExists = techTree.nodes.some(n => n.id === edge.source && n.data.category === selectedCategory);
            const targetExists = techTree.nodes.some(n => n.id === edge.target && n.data.category === selectedCategory);
            return sourceExists && targetExists;
          })
        };
      }
      
      const { layoutedNodes, layoutedEdges } = await getLayoutedElements(
        groupingMode,
        showingRelatedNodes,
        showOnlyConnected,
        searchTerm,
        filteredTechTree,
      );
      layoutedNodesRef.current = layoutedNodes;
      layoutedEdgesRef.current = layoutedEdges;
      setNodes(() => layoutedNodes);
      setEdges(() => layoutedEdges);
      setIsLoading(false);
      fitView();
    };

    loadLayout();
  }, [
    fitView,
    groupingMode,
    showingRelatedNodes,
    showOnlyConnected,
    searchTerm,
    techTree,
    selectedCategory,
    smrFilteredTree,
  ]);

  // Update node and edge styles based on highlighted elements
  useEffect(() => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        style: {
          ...node.style,
          borderWidth: highlightedElements.nodeIds.has(node.id) ? '3px' : '1px',
          boxShadow: highlightedElements.nodeIds.has(node.id)
            ? '0 0 0 2px #f97316'
            : 'none',
          fontWeight: highlightedElements.nodeIds.has(node.id)
            ? 'bold'
            : 'normal',
        },
      })),
    );

    setEdges((currentEdges) =>
      currentEdges.map((edge) => ({
        ...edge,
        style: {
          ...edge.style,
          strokeWidth: highlightedElements.edgeIds.has(edge.id) ? 3 : 1,
          stroke: highlightedElements.edgeIds.has(edge.id)
            ? '#f97316'
            : '#374151',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: highlightedElements.edgeIds.has(edge.id)
            ? '#f97316'
            : '#374151',
        },
      })),
    );
  }, [highlightedElements]);

  const handleShowCompanies = useCallback(
    async (nodeId: string) => {
      if (expandedCompanyNodeIds.has(nodeId)) {
        // Toggle off
        setCompanyNodes((prev) =>
          prev.filter((n) => {
            const d = n.data as unknown as CompanyNodeData | MoreCompaniesNodeData;
            return d.parentNodeId !== nodeId;
          }),
        );
        setCompanyEdges((prev) =>
          prev.filter((e) => !e.id.startsWith(`company-edge-${nodeId}-`)),
        );
        setExpandedCompanyNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
        return;
      }

      // Collapse any previously expanded company nodes before showing new ones
      setCompanyNodes([]);
      setCompanyEdges([]);
      setExpandedCompanyNodeIds(new Set());
      
      // update selected node and highlights when expanding a new node
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (targetNode) {
        setSelectedNode(() => ({ ...targetNode }));
        const connected = findConnectedElements(nodeId, edges);
        setHighlightedElements(connected);
      }

      try {
        const res = await fetch(`/investment-tech-tree/api/companies?nodeId=${encodeURIComponent(nodeId)}&topic=${topic}`);
        if (!res.ok) return;
        const data = await res.json();
        const allCompanies: CompanyInfo[] = data.companies ?? [];
        if (!allCompanies.length) return;

        const parentNode = nodes.find((n) => n.id === nodeId);
        if (!parentNode) return;

        const visibleCompanies = allCompanies.slice(0, MAX_VISIBLE_COMPANIES);
        const remainingCount = allCompanies.length - visibleCompanies.length;

        const companyWidth = 140;
        const companyHeight = 80;
        const companyGap = 10;
        const px = parentNode.position.x - companyWidth - 30;
        const visibleCount = visibleCompanies.length + (remainingCount > 0 ? 1 : 0);
        const totalHeight = visibleCount * (companyHeight + companyGap) - companyGap;
        const startY = parentNode.position.y + 40 - totalHeight / 2;

        const newCompanyNodes: UiNode[] = visibleCompanies.map((company, index) => ({
          id: `company-${company.id}`,
          type: 'company',
          position: { x: px, y: startY + index * (companyHeight + companyGap) },
          width: companyWidth,
          height: companyHeight,
          data: {
            label: company.canonical_name,
            nodeType: 'company',
            company,
            parentNodeId: nodeId,
          } as unknown as UiNode['data'],
          style: {
            background: '#ffffff',
            borderColor: company.is_primary ? '#ca8a04' : '#eab308',
            borderStyle: 'solid',
            borderWidth: company.is_primary ? '2px' : '1px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        }));

        if (remainingCount > 0) {
          const moreY = startY + visibleCompanies.length * (companyHeight + companyGap);
          newCompanyNodes.push({
            id: `more-companies-${nodeId}`,
            type: 'moreCompanies',
            position: { x: px, y: moreY },
            width: companyWidth,
            height: companyHeight,
            data: {
              label: `+${remainingCount} More Companies`,
              nodeType: 'moreCompanies',
              parentNodeId: nodeId,
            } as unknown as UiNode['data'],
            style: {
              background: '#f8fafc',
              borderColor: '#94a3b8',
              borderStyle: 'dashed',
              borderWidth: '2px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            },
          });
        }

        const newCompanyEdges: Edge[] = visibleCompanies.map((company) => ({
          id: `company-edge-${nodeId}-${company.id}`,
          source: `company-${company.id}`,
          target: nodeId,
          style: { strokeWidth: 1, stroke: '#eab308', strokeDasharray: '4 2' },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: '#eab308',
          },
        }));

        if (remainingCount > 0) {
          newCompanyEdges.push({
            id: `company-edge-${nodeId}-more`,
            source: `more-companies-${nodeId}`,
            target: nodeId,
            style: { strokeWidth: 1, stroke: '#94a3b8', strokeDasharray: '4 2' },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: '#94a3b8',
            },
          });
        }

        setCompanyNodes((prev) => [...prev, ...newCompanyNodes]);
        setCompanyEdges((prev) => [...prev, ...newCompanyEdges]);
        setExpandedCompanyNodeIds((prev) => new Set([...prev, nodeId]));
      } catch (err) {
        console.error('Error fetching companies:', err);
      }
    },
    [
      nodes,
      edges,
      topic,
      expandedCompanyNodeIds,
      MAX_VISIBLE_COMPANIES,
      findConnectedElements,
    ],
  );

  const handleShowLiterature = useCallback(
    async (nodeId: string) => {
      if (expandedLiteratureNodeIds.has(nodeId)) {
        // Toggle off
        setLiteratureNodes((prev) =>
          prev.filter(
            (n) => (n.data as unknown as LiteratureNodeData).parentNodeId !== nodeId,
          ),
        );
        setLiteratureEdges((prev) =>
          prev.filter((e) => !e.id.startsWith(`lit-edge-${nodeId}-`)),
        );
        setExpandedLiteratureNodeIds((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
        return;
      }

      // Collapse any previously expanded literature before showing new ones
      setLiteratureNodes([]);
      setLiteratureEdges([]);
      setExpandedLiteratureNodeIds(new Set());

      // update selected node and highlights when expanding a new node
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (targetNode) {
        setSelectedNode(() => ({ ...targetNode }));
        const connected = findConnectedElements(nodeId, edges);
        setHighlightedElements(connected);
      }

      try {
        const res = await fetch(
          `/investment-tech-tree/api/kg?nodeId=${encodeURIComponent(nodeId)}&topic=${topic}`,
        );
        if (!res.ok) return;
        const data: KgExpandResponse = await res.json();
        if (!data.entities?.length) return;

        const parentNode = nodes.find((n) => n.id === nodeId);
        if (!parentNode) return;

        const litWidth = 160;
        const litHeight = 80;
        const litGap = 10;
        // Literature nodes render to the RIGHT of the parent (companies go left).
        const px = parentNode.position.x + 150 + 30;
        const totalHeight =
          data.entities.length * (litHeight + litGap) - litGap;
        const startY = parentNode.position.y + 40 - totalHeight / 2;

        const kindBorder: Record<string, string> = {
          paper: '#6366f1',
          device: '#14b8a6',
          finding: '#f59e0b',
        };

        const newLitNodes: UiNode[] = data.entities.map((entity, index) => ({
          id: `lit-${entity.id}`,
          type: 'literature',
          position: { x: px, y: startY + index * (litHeight + litGap) },
          width: litWidth,
          height: litHeight,
          data: {
            label:
              entity.kind === 'paper'
                ? (entity.paper?.title ?? entity.name)
                : entity.name,
            nodeType: 'literature',
            entity,
            parentNodeId: nodeId,
          } as unknown as UiNode['data'],
          style: {
            background: '#ffffff',
            borderColor: kindBorder[entity.kind] ?? '#94a3b8',
            borderStyle: 'solid',
            borderWidth: entity.kind === 'paper' ? '2px' : '1px',
            borderRadius: '6px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        }));

        const newLitEdges: Edge[] = data.entities.map((entity) => {
          const color = kindBorder[entity.kind] ?? '#94a3b8';
          return {
            id: `lit-edge-${nodeId}-${entity.id}`,
            source: `lit-${entity.id}`,
            target: nodeId,
            targetHandle: 'lit-target',
            label: entity.relation,
            labelStyle: { fontSize: 9, fill: color },
            labelBgStyle: { fill: '#ffffff', fillOpacity: 0.85 },
            style: { strokeWidth: 1, stroke: color, strokeDasharray: '4 2' },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color,
            },
          };
        });

        setLiteratureNodes((prev) => [...prev, ...newLitNodes]);
        setLiteratureEdges((prev) => [...prev, ...newLitEdges]);
        setExpandedLiteratureNodeIds((prev) => new Set([...prev, nodeId]));
        // Fetch vote tallies for votable overlay entities (paper votes live in PaperDetails).
        fetchVotes(
          topic,
          data.entities.filter((e) => e.kind !== 'paper').map((e) => e.id),
        ).then((v) =>
          setLitVotes((prev) => new Map([...prev, ...Object.entries(v)])),
        );
      } catch (err) {
        console.error('Error fetching KG literature:', err);
      }
    },
    [nodes, edges, topic, expandedLiteratureNodeIds, findConnectedElements],
  );

  const handleLitVote = useCallback(
    async (targetId: string, vote: 'up' | 'down' | null) => {
      await optimisticVote(topic, targetId, vote, litVotes.get(targetId), (counts) =>
        setLitVotes((prev) => {
          const next = new Map(prev);
          if (counts) next.set(targetId, counts);
          else next.delete(targetId);
          return next;
        }),
      );
    },
    [topic, litVotes],
  );

  const handleShowPaper = useCallback(
    async (entity: KgEntity) => {
      const paperId = entity.paper?.paperId;
      if (!paperId) return;
      try {
        const res = await fetch(
          `/investment-tech-tree/api/kg/paper/${encodeURIComponent(paperId)}?topic=${topic}`,
        );
        if (!res.ok) return;
        setPaperDossier(await res.json());
      } catch (err) {
        console.error('Error fetching paper dossier:', err);
      }
    },
    [topic],
  );

  // Re-expand an open literature overlay after a curation verdict changed,
  // and refresh the icon-availability map.
  const handleVerdictChanged = useCallback(
    (nodeId: string) => {
      refreshEnrichedNodes();
      if (!expandedLiteratureNodeIds.has(nodeId)) return;
      setLiteratureNodes((prev) =>
        prev.filter(
          (n) => (n.data as unknown as LiteratureNodeData).parentNodeId !== nodeId,
        ),
      );
      setLiteratureEdges((prev) =>
        prev.filter((e) => !e.id.startsWith(`lit-edge-${nodeId}-`)),
      );
      setExpandedLiteratureNodeIds((prev) => {
        const next = new Set(prev);
        next.delete(nodeId);
        return next;
      });
      setTimeout(() => handleShowLiterature(nodeId), 0);
    },
    [expandedLiteratureNodeIds, refreshEnrichedNodes, handleShowLiterature],
  );

  const handleShowCompanyDetails = useCallback(
    (companyId: string) => {
      const companyNode = companyNodes.find(
        (n) => (n.data as unknown as CompanyNodeData).company?.id === companyId,
      );
      if (companyNode) {
        const parentNodeId = (companyNode.data as unknown as CompanyNodeData).parentNodeId;
        const parentNode = nodes.find((n) => n.id === parentNodeId);
        if (parentNode) {
          setSelectedNode(() => ({ ...parentNode }));
          const connected = findConnectedElements(parentNodeId, edges);
          setHighlightedElements(connected);
          // Ensure panel is expanded then switch to companies sub-view
          setIsPanelExpanded(true);
          if (showCompaniesSubViewRef.current) showCompaniesSubViewRef.current();
        }
      }
    },
    [companyNodes, nodes, edges, findConnectedElements],
  );

  const handleShowMoreCompanies = useCallback(
    (parentNodeId: string) => {
      const parentNode = nodes.find((n) => n.id === parentNodeId);
      if (parentNode) {
        const isSameNode = selectedNode?.id === parentNodeId;

        setSelectedNode(() => ({ ...parentNode }));
        const connected = findConnectedElements(parentNodeId, edges);
        setHighlightedElements(connected);

        // Always expand the panel
        setIsPanelExpanded(true);

        if (isSameNode) {
          // selectedNode.id won't change, so the TabPanel effect won't fire.
          // Call both refs directly: first switch to details tab, then set sub-view.
          if (showNodeDetailsTabRef.current) showNodeDetailsTabRef.current();
          if (showCompaniesSubViewRef.current) showCompaniesSubViewRef.current();
        } else {
          // selectedNode.id will change, TabPanel's useEffect will consume pendingSubViewRef.
          // Set pending before the state update propagates.
          if (showCompaniesSubViewRef.current) showCompaniesSubViewRef.current();
        }
      }
    },
    [nodes, edges, findConnectedElements, selectedNode],
  );

  const handleShowDetails = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setSelectedNode(() => ({ ...node }));
        const connected = findConnectedElements(nodeId, edges);
        setHighlightedElements(connected);
        
        // Always switch to details tab when clicking node buttons
        if (showNodeDetailsTabRef.current) {
          showNodeDetailsTabRef.current();
        }

        // Auto-expand panel on mobile when node details are shown
        if (window.innerWidth < 768) {
          setIsPanelExpanded(true);
        }
      }
    },
    [nodes, edges, findConnectedElements],
  );

  // Called from the simulation panel when a top-N row is clicked.
  // Highlights the node and its connections just like clicking the info button,
  // but does NOT switch the tab to "details".
  const handleSimulationNodeSelect = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setSelectedNode(() => ({ ...node }));
        const connected = findConnectedElements(nodeId, edges);
        setHighlightedElements(connected);
      }
    },
    [nodes, edges, findConnectedElements],
  );

  const handleShowConnected = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) {
        setSelectedNode(() => ({ ...node }));
        setShowingRelatedNodes(nodeId);
        setShowOnlyConnected(true);
        setSearchInput('');
        setSearchTerm('');
        setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
      }
    },
    [nodes],
  );

  const handleGroupingModeChange = useCallback((mode: GroupingMode) => {
    setGroupingMode(mode);
    setSelectedNode(undefined);
    setShowingRelatedNodes(null);
    setShowOnlyConnected(false);
    setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
  }, []);

  const handleReset = useCallback(() => {
    setSelectedNode(undefined);
    setShowingRelatedNodes(null);
    setShowOnlyConnected(false);
    setSearchInput('');
    setSearchTerm('');
    setSelectedCategory('All');
    setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    setSelectedNode(undefined);
    setShowingRelatedNodes(null);
    setShowOnlyConnected(false);
    setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
  }, []);

  useEffect(() => {
    if (!requestedTechnologyId || isLoading) return;
    const node = layoutedNodesRef.current.find(
      (candidate) => candidate.id === requestedTechnologyId,
    );
    if (!node) {
      // Hidden by the SMR detail threshold: lower it once per focus request
      // so the node gets laid out (without fighting later slider changes).
      const smr = techTree?.nodes.find((n) => n.id === requestedTechnologyId)?.data.smr;
      if (
        smr?.kind === 'technology' &&
        smr.relevance < minRelevance &&
        revealedFocusKeyRef.current !== technologyFocusRequestKey
      ) {
        revealedFocusKeyRef.current = technologyFocusRequestKey;
        setSelectedCategory('All');
        setMinRelevance(smr.relevance);
      }
      return;
    }

    setSelectedNode((current) => (current?.id === node.id ? current : node));
    const connected = findConnectedElements(
      node.id,
      layoutedEdgesRef.current,
    );
    setHighlightedElements((current) =>
      areSetsEqual(current.nodeIds, connected.nodeIds) &&
      areSetsEqual(current.edgeIds, connected.edgeIds)
        ? current
        : connected,
    );
    setIsPanelExpanded(true);
    showNodeDetailsTabRef.current?.();
  }, [
    requestedTechnologyId,
    technologyFocusRequestKey,
    isLoading,
    findConnectedElements,
    techTree,
    minRelevance,
  ]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100">
        <div className="rounded-lg bg-white p-8 text-center shadow-lg">
          <h2 className="mb-4 text-2xl font-bold text-red-600">
            Error Loading Data
          </h2>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full bg-gray-100 flex">
      <div className={`relative transition-all duration-300 flex flex-col h-full ${
        isPanelExpanded 
          ? 'w-full md:w-2/4'
          : 'w-full'
      }`}>
        <GroupSelector
          currentMode={groupingMode}
          onModeChange={handleGroupingModeChange}
          selectedNode={selectedNode}
          showingConnectedNodes={showingRelatedNodes !== null}
          onReset={handleReset}
          searchInput={searchInput}
          onSearchChange={handleSearchChange}
          onEnterEditMode={handleEnterEditMode}
          onOpenReview={handleOpenReview}
          isEditing={isEditing}
          hasLiterature={enrichedNodes.size > 0}
          litViewMode={litViewMode}
          onLitViewModeChange={setLitViewMode}
          showLitEdgeLabels={showLitEdgeLabels}
          onToggleLitEdgeLabels={setShowLitEdgeLabels}
          showLegend={showLegend}
          showOptions={showOptions}
          onToggleLegend={() => setShowLegend(!showLegend)}
          onToggleOptions={() => setShowOptions(!showOptions)}
          selectedCategory={selectedCategory}
          categories={uniqueCategories}
          onCategoryChange={setSelectedCategory}
          {...(smrTree
            ? {
                minRelevance,
                onMinRelevanceChange: setMinRelevance,
                visibleNodeCount: smrFilteredTree?.nodes.length,
                sourceBackedOnly,
                onSourceBackedOnlyChange: setSourceBackedOnly,
              }
            : {})}
        />
        {isLoadingData || isLoading ? (
          <div className="flex-grow flex items-center justify-center h-full">
            <LoadingSpinner />
          </div>
        ) : (
          <div className="flex-grow relative">
            <ReactFlow
              nodes={
                // Focused mode: show only the expanded node + its literature.
                litFocused
                  ? [
                      ...nodes.filter((n) => expandedLiteratureNodeIds.has(n.id)),
                      ...literatureNodes,
                    ]
                  : [...nodes, ...companyNodes, ...literatureNodes]
              }
              edges={(
                litFocused
                  ? literatureEdges.filter((e) =>
                      [...expandedLiteratureNodeIds].some((id) =>
                        e.id.startsWith(`lit-edge-${id}-`),
                      ),
                    )
                  : [...edges, ...companyEdges, ...literatureEdges]
              ).map((e) =>
                !showLitEdgeLabels && e.id.startsWith('lit-edge-')
                  ? { ...e, label: undefined }
                  : e,
              )}
              nodeTypes={{
                default: (props) => (
                  <CustomNode
                    {...props}
                    onShowDetails={handleShowDetails}
                    onShowConnected={handleShowConnected}
                    onShowCompanies={handleShowCompanies}
                    isCompaniesExpanded={(id) => expandedCompanyNodeIds.has(id)}
                    onShowLiterature={
                      enrichedNodes.has(props.id) ? handleShowLiterature : undefined
                    }
                    isLiteratureExpanded={(id) => expandedLiteratureNodeIds.has(id)}
                    literatureCount={enrichedNodes.get(props.id)?.papers}
                  />
                ),
                literature: (props) => {
                  const litData = props.data as unknown as LiteratureNodeData;
                  return (
                    <LiteratureNode
                      {...props}
                      data={litData}
                      onShowPaper={handleShowPaper}
                      votes={litVotes.get(litData.entity.id)}
                      onVote={(v) => handleLitVote(litData.entity.id, v)}
                    />
                  );
                },
                company: (props) => {
                  const companyData = props.data as unknown as CompanyNodeData;
                  return (
                    <CompanyNode
                      {...props}
                      data={companyData}
                      onShowCompanyDetails={handleShowCompanyDetails}
                    />
                  );
                },
                moreCompanies: (props) => {
                  const moreData = props.data as unknown as MoreCompaniesNodeData;
                  return (
                    <MoreCompaniesNode
                      {...props}
                      data={moreData}
                      onShowParentCompanies={handleShowMoreCompanies}
                    />
                  );
                },
              }}
              onNodesChange={undefined}
              onEdgesChange={undefined}
              onConnect={undefined}
              onEdgeClick={undefined}
              onNodeDragStop={undefined}
              draggable={false}
              nodesConnectable={false}
              colorMode={'light'}
              fitView
              fitViewOptions={{ padding: 0.5 }}
              minZoom={0.3}
              className="h-full w-full"
            >
              <Background bgColor="white" variant={BackgroundVariant.Dots} />
              <Controls 
                showInteractive={false} 
                showZoom={true} 
                showFitView={true}
                className="!left-4 !top-[180px] !bottom-auto md:!top-auto md:!bottom-4"
              />
            </ReactFlow>
            
            {/* Knowledge Base Selector - Positioned above Legend */}
            <KnowledgeBaseSelector topic={topic} onTopicChange={onTopicChange} />

            {paperDossier && (
              <PaperDetails
                dossier={paperDossier}
                topic={topic}
                onClose={() => setPaperDossier(null)}
              />
            )}
            {showReview && (
              <LiteratureReview
                topic={topic}
                onClose={() => setShowReview(false)}
                onVerdictChanged={handleVerdictChanged}
              />
            )}
            
            {/* Legend */}
            <div className={`${showLegend ? 'block' : 'hidden'} md:block`}>
              <Legend />
            </div>
          </div>
        )}
      </div>
      <div 
        className={`bg-white shadow-lg transition-all duration-300 relative ${
          isPanelExpanded 
            ? 'w-full md:w-2/4'
            : 'w-0'
        } ${
          isPanelExpanded ? 'fixed md:relative inset-0 md:inset-auto z-40 md:z-auto' : ''
        }`}
      >
        {isEditing ? (
          <EditInterface onExit={handleExitEditMode} topic={topic} />
        ) : (
          <TabPanel 
            selectedNode={selectedNode}
            techTree={techTree}
            isPanelExpanded={isPanelExpanded}
            onTogglePanel={() => setIsPanelExpanded(!isPanelExpanded)}
            topic={topic}
            onNodeSelect={handleSimulationNodeSelect}
            onShowNodeDetailsRef={(fn) => { showNodeDetailsTabRef.current = fn; }}
            onShowCompaniesViewRef={(fn) => { showCompaniesSubViewRef.current = fn; }}
          />
        )}
      </div>
    </div>
  );
};

export default TechTree;