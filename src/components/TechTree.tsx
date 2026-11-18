'use client';

import {
  AggregateNodeData,
  BOX_PREVIEW_RING,
  DRAFT_RING,
  EdgeWeightData,
  LayoutResult,
  edgeMarker,
  edgeStrokeWidth,
  layoutProjection,
  nodeShadow,
  selectVisibleTree,
  shiftLayout,
} from '@/lib/elkjs';
import {
  CustomTree,
  ancestorsOf,
  descendantsOf,
  resolveCustomTree,
} from '@/lib/customTrees';
import {
  ChatScope,
  customThreadKey,
  draftThreadKey,
  resolveChatScope,
} from '@/lib/chatContext';
import { deleteThread, moveThread } from '@/lib/chatThreadStorage';
import { cleanConceptLabel } from '@/lib/pathway';
import { nodeRoleLabel } from '@/lib/nodeRoles';
import {
  customTreeStore,
  getCustomTrees,
  useCustomTrees,
  useIsClient,
} from '@/hooks/useCustomTrees';
import { StartDraftOptions, useTreeBuilder } from '@/hooks/useTreeBuilder';
import { TreeBuilderPanel } from './TreeBuilderPanel';
import { SaveTreeDialog, SaveTreeRequest } from './SaveTreeDialog';
import { MyTreesDialog } from './MyTreesDialog';
import { BoxSelection } from './BoxSelection';
import {
  LAYOUT_TRANSITION_MS,
  MAX_ANIMATED_NODES,
  planLayoutTransition,
} from '@/lib/layoutTransition';
import { AnimatedReactFlow, FlowTransition } from './AnimatedReactFlow';
import { HighlightedElements, UiNode, GroupingMode, CompanyInfo, CompanyNodeData, KgEntity, KgExpandResponse, KgPaperDossier, LiteratureNodeData, TechTree as TechTreeData } from '@/lib/types';
import { labelForTopic, TopicKey } from '@/lib/topicConfig';
import {
  AggregationMode,
  TreeProjection,
  aggregateNodeId,
  groupFrameId,
  groupKeysOf,
  projectTree,
} from '@/lib/treeProjection';
import { Bounds, boundsOf, minZoomForBounds } from '@/lib/canvasZoom';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  MarkerType,
  getViewportForBounds,
  useReactFlow,
  useStore,
} from '@xyflow/react';
import React, { useCallback, useEffect, useLayoutEffect, useState, useMemo, useRef } from 'react';
import { Legend } from './Legend';
import { LoadingSpinner } from './LoadingSpinner';
import { GroupSelector } from './GroupSelector';
import { KnowledgeBaseSelector } from './KnowledgeBaseSelector';
import { MoreCompaniesNodeData } from './MoreCompaniesNode';
import { TECH_TREE_NODE_TYPES } from './techTreeNodeTypes';
import {
  TechTreeNodeActions,
  TechTreeNodeActionsContext,
  TreeBuilderActions,
} from './techTreeNodeActions';
import { ZoomDetailLevelSync } from './ZoomDetailLevelSync';
import { TreeComparison, ComparisonMode, TreeRef } from './TreeComparison';
import { useCanvasWheel } from '@/hooks/useCanvasWheel';
import PaperDetails from './PaperDetails';
import LiteratureReview from './LiteratureReview';
import { VoteCounts, fetchVotes, optimisticVote } from '@/lib/votes';
import TabPanel from './TabPanel';
import EditInterface from './EditInterface';
import { useTechTree } from '@/hooks/useTechTree';
import { useTopics } from '@/hooks/useTopics';
import { setAdminPassword, verifyAdminPassword } from '@/lib/adminClient';
import { DEFAULT_MIN_RELEVANCE, filterSmrTechTree, isSmrTree } from '@/lib/smrFilters';
import { pathwaySourceTree } from '@/lib/technologyCatalog';
import { usePathwayMode } from '@/hooks/usePathwayMode';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import { PathwayGuide } from './pathway/PathwayGuide';
import { Button } from '@/components/ui/button';

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
  /** Reports the node shown in the details panel so it can be shared. */
  onFocusChange?: (nodeId: string | null) => void;
  /** Target of the guided pathway, from the URL. */
  pathwayTargetId?: string | null;
  pathwayStep?: number;
  onPathwayStepChange?: (step: number) => void;
  /** Leaves the pathway, optionally focusing a node in the full map. */
  onExitPathway?: (focusNodeId?: string) => void;
  /** Opens the technology picker. */
  onChooseTechnology?: () => void;
  /** Side-panel tab from the URL (`panel=`). */
  panel?: 'details' | 'chat' | 'simulations' | null;
  onPanelChange?: (panel: 'details' | 'chat' | 'simulations') => void;
  /** Custom tree to show instead of the whole topic tree (URL `tree=`). */
  customTreeId?: string | null;
  /** Shows a saved custom tree (switching topic if needed). */
  onOpenCustomTree?: (tree: CustomTree) => void;
  /** Back to the whole topic tree. */
  onCloseCustomTree?: () => void;
}

const FIT_VIEW_OPTIONS = { padding: 0.5, maxZoom: 1.25 };

const EMPTY_HIGHLIGHTS: HighlightedElements = {
  nodeIds: new Set(),
  edgeIds: new Set(),
};

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** What a layout is computed from; identity changes mark it stale. */
interface LayoutInput {
  /** Tree the layout came from, so a new topic never shows the old one. */
  source: TechTreeData;
  /** Filtered tree before aggregation and folding. */
  visibleTree: TechTreeData;
  projection: TreeProjection;
  isPathway: boolean;
  /** Node the connected-nodes view is centred on. */
  anchorNodeId: string | null;
  showFoldControls: boolean;
}

/**
 * How the next relayout should move. Set by a fold or unfold just before
 * the state change that causes it.
 *
 * - `anchor`: the toggled element keeps its place; the new layout is moved
 *   so `fromId` (before) and `toId` (after, e.g. aggregate → frame) line up,
 *   and the camera stays put.
 * - `fit`: bulk changes (unfold all, a new aggregation); the camera glides
 *   to frame the new layout while the nodes morph.
 */
interface PendingTransition {
  kind: 'anchor' | 'fit';
  anchor?: { fromId: string; toId: string };
  /**
   * An unfold: afterwards the camera makes sure the anchor and everything
   * that came out of it is on screen.
   */
  reveal?: boolean;
  /** Ignored if no relayout picked it up soon after. */
  at: number;
}

const PENDING_TRANSITION_TTL_MS = 2000;

type CameraMode = 'keep' | 'glide' | 'fit';

/** Room kept around revealed nodes, in screen pixels. */
const REVEAL_MARGIN = 48;

function toggled(set: ReadonlySet<string>, id: string, on: boolean) {
  if (set.has(id) === on) return set;
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
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
  onFocusChange,
  pathwayTargetId,
  pathwayStep = 0,
  onPathwayStepChange,
  onExitPathway,
  onChooseTechnology,
  panel = null,
  onPanelChange,
  customTreeId = null,
  onOpenCustomTree,
  onCloseCustomTree,
}) => {
  const {
    techTree,
    isLoading: isLoadingData,
    error,
    retry: retryTechTree,
  } = useTechTree(topic);
  const { topics } = useTopics();
  const topicLabel = labelForTopic(topics, topic);
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

  // Scaling the tree down: aggregate groups, unfold some, fold branches.
  const [aggregationMode, setAggregationMode] = useState<AggregationMode>('none');
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const [foldedNodeIds, setFoldedNodeIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const [isComparing, setIsComparing] = useState(false);

  // Custom trees (kept in this browser) and building one on the canvas.
  const customTrees = useCustomTrees();
  const isClient = useIsClient();
  const activeCustomTree = useMemo(
    () =>
      customTreeId
        ? (customTrees.find((tree) => tree.id === customTreeId && tree.topic === topic) ??
          null)
        : null,
    [customTrees, customTreeId, topic],
  );
  const builder = useTreeBuilder();
  const draft = builder.draft?.topic === topic ? builder.draft : null;
  const isBuilding = draft !== null;
  const [saveRequest, setSaveRequest] = useState<SaveTreeRequest | null>(null);
  const [isMyTreesOpen, setIsMyTreesOpen] = useState(false);
  const [missingTreeNotice, setMissingTreeNotice] = useState(false);
  const [boxPreviewIds, setBoxPreviewIds] = useState<ReadonlySet<string>>(EMPTY_IDS);

  // SMR-style trees (large, relevance-rated, provenance-tagged edges)
  const smrTree = useMemo(() => isSmrTree(techTree), [techTree]);
  const [minRelevance, setMinRelevance] = useState<number>(DEFAULT_MIN_RELEVANCE);
  const [sourceBackedOnly, setSourceBackedOnly] = useState<boolean>(false);
  const revealedFocusKeyRef = useRef<number | undefined>(undefined);
  const revealedHiddenFocusRef = useRef<string | null>(null);
  const appliedFocusRef = useRef<string | null>(null);
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
  const resolvedCustomTree = useMemo(
    () =>
      techTree && activeCustomTree ? resolveCustomTree(techTree, activeCustomTree) : null,
    [techTree, activeCustomTree],
  );

  // Guided pathway (URL-driven). It ignores category, search and grouping
  // but respects the SMR detail threshold.
  const pathwaySource = useMemo(() => {
    if (!techTree || !pathwayTargetId) return null;
    return smrTree ? pathwaySourceTree(techTree, minRelevance) : techTree;
  }, [techTree, pathwayTargetId, smrTree, minRelevance]);
  const pathwayMode = usePathwayMode({
    sourceTree: pathwaySource,
    targetId: pathwayTargetId,
    step: pathwayStep,
  });
  const pathwayActive = pathwayMode !== null;
  const pathwayTree = pathwayMode?.pathwayTree ?? null;
  const currentPathwayStep = pathwayMode?.currentStep ?? null;
  const emptyPathwayTargetId =
    pathwayMode && !pathwayTree ? pathwayMode.pathway.targetId : null;
  const nodeById = useMemo(
    () => new Map((techTree?.nodes ?? []).map((node) => [node.id, node])),
    [techTree],
  );

  // Switching topics invalidates node-specific view state.
  const previousTopicRef = useRef(topic);
  useEffect(() => {
    if (previousTopicRef.current === topic) return;
    previousTopicRef.current = topic;
    setSelectedNode(undefined);
    setShowingRelatedNodes(null);
    setShowOnlyConnected(false);
    setSearchInput('');
    setSearchTerm('');
    setSelectedCategory('All');
    setHighlightedElements(EMPTY_HIGHLIGHTS);
    // Group keys and node ids belong to the old tree; the mode carries over.
    setExpandedGroups(EMPTY_IDS);
    setFoldedNodeIds(EMPTY_IDS);
    setBoxPreviewIds(EMPTY_IDS);
  }, [topic]);

  // Refs to imperatively switch TabPanel tabs / sub-views
  const showNodeDetailsTabRef = useRef<(() => void) | null>(null);
  const showCompaniesSubViewRef = useRef<(() => void) | null>(null);
  const showChatTabRef = useRef<(() => void) | null>(null);

  const MAX_VISIBLE_COMPANIES = 5;
  
  const { fitView, getNodesBounds, setViewport, getViewport } = useReactFlow();

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
  const reducedMotion = usePrefersReducedMotion();
  useEffect(() => {
    fitView({ duration: reducedMotion ? 0 : 400, padding: 0.35 });
  }, [litFocused, fitView, reducedMotion]);

  // Everything the ELK layout depends on. A pathway replaces the filtered
  // tree with its own subgraph; identity changes mark the layout as stale.
  const layoutInput = useMemo((): LayoutInput | null => {
    if (!techTree) return null;
    if (pathwayTree) {
      return {
        source: techTree,
        visibleTree: pathwayTree,
        projection: projectTree(pathwayTree),
        isPathway: true,
        anchorNodeId: null,
        showFoldControls: false,
      };
    }

    // An open custom tree replaces the topic tree (its nodes were picked by
    // hand, so the SMR detail threshold does not apply); building a tree
    // shows the whole topic so anything can be added.
    const customBase =
      !isBuilding && resolvedCustomTree ? resolvedCustomTree.tree : null;
    let tree = customBase ?? smrFilteredTree ?? techTree;
    const categoryApplied = !customBase && smrFilteredTree !== null;
    if (!categoryApplied && selectedCategory !== 'All') {
      const base = tree;
      const inCategory = new Set(
        base.nodes
          .filter((node) => node.data.category === selectedCategory)
          .map((node) => node.id),
      );
      tree = {
        nodes: base.nodes.filter((node) => inCategory.has(node.id)),
        edges: base.edges.filter(
          (edge) => inCategory.has(edge.source) && inCategory.has(edge.target),
        ),
      };
    }
    const visibleTree = selectVisibleTree(
      groupingMode,
      showingRelatedNodes,
      showOnlyConnected,
      searchTerm,
      tree,
    );
    // The connected-nodes view is already small and centred on one node, so
    // it is never aggregated or folded.
    const transformable = !showingRelatedNodes;
    return {
      source: techTree,
      visibleTree,
      projection: projectTree(
        visibleTree,
        transformable
          ? { mode: aggregationMode, expandedGroups, foldedNodeIds }
          : {},
      ),
      isPathway: false,
      anchorNodeId: showingRelatedNodes,
      showFoldControls: transformable,
    };
  }, [
    techTree,
    pathwayTree,
    smrFilteredTree,
    resolvedCustomTree,
    isBuilding,
    selectedCategory,
    groupingMode,
    showingRelatedNodes,
    showOnlyConnected,
    searchTerm,
    aggregationMode,
    expandedGroups,
    foldedNodeIds,
  ]);
  const [layoutedInput, setLayoutedInput] = useState<LayoutInput | null>(null);
  const isLayoutReady = layoutInput !== null && layoutedInput === layoutInput;
  // Keep the previous graph on screen while a relayout of the same tree
  // runs (folding, filters); only a new tree shows the spinner.
  const hasLayout = layoutedInput !== null && layoutedInput.source === techTree;
  // Pathway layouts are framed by the step camera instead of React Flow's
  // automatic fit, so the two never race.
  const autoFit = !layoutInput?.isPathway;

  // Zoom-out limit: far enough to see the whole tree, however large.
  const [layoutBounds, setLayoutBounds] = useState<Bounds | null>(null);
  const canvasWidth = useStore((state) => state.width);
  const canvasHeight = useStore((state) => state.height);
  const minZoom = useMemo(
    () => minZoomForBounds(layoutBounds, canvasWidth, canvasHeight),
    [layoutBounds, canvasWidth, canvasHeight],
  );
  const fitViewOptions = useMemo(
    () => ({ ...FIT_VIEW_OPTIONS, minZoom }),
    [minZoom],
  );

  const groupKeys = useMemo(
    () =>
      layoutInput && !layoutInput.isPathway && !layoutInput.anchorNodeId
        ? groupKeysOf(layoutInput.visibleTree, aggregationMode)
        : [],
    [layoutInput, aggregationMode],
  );
  const foldedBranchCount = useMemo(
    () =>
      layoutInput?.projection.nodes.filter(
        (node) => node.kind === 'node' && node.foldedCount > 0,
      ).length ?? 0,
    [layoutInput],
  );

  // Clear company overlay whenever the ELK layout is about to regenerate
  // so company nodes don't linger at stale positions.
  useEffect(() => {
    setCompanyNodes([]);
    setCompanyEdges([]);
    setExpandedCompanyNodeIds(new Set());
    setLiteratureNodes([]);
    setLiteratureEdges([]);
    setExpandedLiteratureNodeIds(new Set());
  }, [layoutInput]);

  // Set by a fold/unfold just before the relayout it causes.
  const pendingTransitionRef = useRef<PendingTransition | null>(null);
  // How to frame a finished layout; consumed once the canvas can move.
  const cameraRequestRef = useRef<{
    layout: LayoutInput;
    mode: CameraMode;
    /** Flow-space box that must end up on screen (after an unfold). */
    reveal?: Bounds | null;
  } | null>(null);
  const layoutResultRef = useRef<LayoutResult | null>(null);
  // The layout on screen and its styled nodes, read when the next one lands.
  const layoutedInputRef = useRef<LayoutInput | null>(null);
  const shownNodesRef = useRef<UiNode[]>([]);
  const shownEdgesRef = useRef<Edge[]>([]);
  useLayoutEffect(() => {
    shownNodesRef.current = nodes;
    shownEdgesRef.current = edges;
  }, [nodes, edges]);
  // Where animated nodes are on screen mid-animation (AnimatedReactFlow).
  const liveRectsRef = useRef<Map<string, Bounds> | null>(null);
  const [transition, setTransition] = useState<FlowTransition | null>(null);
  const transitionIdRef = useRef(0);
  const animationBlockedRef = useRef(false);
  animationBlockedRef.current = reducedMotion || litFocused;

  useEffect(() => {
    if (!layoutInput) return;
    // ELK is async: a slower, older layout must not overwrite a newer one.
    let cancelled = false;
    const pending = pendingTransitionRef.current;
    pendingTransitionRef.current = null;

    const loadLayout = async () => {
      let result = await layoutProjection(layoutInput.projection, {
        anchorNodeId: layoutInput.anchorNodeId,
        showFoldControls: layoutInput.showFoldControls,
      });
      if (cancelled) return;

      const previousResult = layoutResultRef.current;
      const previousInput = layoutedInputRef.current;
      const live = liveRectsRef.current;
      // Only a fold or unfold within the same tree morphs; anything else
      // (new topic, filters, pathways) is a fresh picture.
      const morph =
        pending !== null &&
        Date.now() - pending.at < PENDING_TRANSITION_TTL_MS &&
        previousResult !== null &&
        previousInput !== null &&
        previousInput.source === layoutInput.source &&
        !previousInput.isPathway &&
        !layoutInput.isPathway;

      let reveal: Bounds | null = null;
      if (morph && pending.anchor) {
        const { fromId, toId } = pending.anchor;
        const before = live?.get(fromId) ?? previousResult.rects.get(fromId);
        const after = result.rects.get(toId);
        if (before && after) {
          result = shiftLayout(result, {
            x: before.x - after.x,
            y: before.y - after.y,
          });
        }
        if (pending.reveal) {
          // The anchor plus every node that was drawn as it before.
          const previousRep = previousInput.projection.representative;
          const nextRep = layoutInput.projection.representative;
          const shown = [toId];
          for (const [id, drawnAs] of previousRep) {
            if (drawnAs === fromId && nextRep.get(id) === id) shown.push(id);
          }
          const nextRects = result.rects;
          reveal = boundsOf(
            shown
              .map((id) => nextRects.get(id))
              .filter((rect): rect is Bounds => rect !== undefined),
          );
        }
      }

      let nextTransition: FlowTransition | null = null;
      if (morph && !animationBlockedRef.current) {
        const plan = planLayoutTransition(
          {
            nodes: shownNodesRef.current.filter((node) =>
              previousResult.rects.has(node.id),
            ),
            edges: shownEdgesRef.current,
            rects: live ? new Map([...previousResult.rects, ...live]) : previousResult.rects,
            projection: previousInput.projection,
          },
          {
            nodes: result.layoutedNodes,
            edges: result.layoutedEdges,
            rects: result.rects,
            projection: layoutInput.projection,
          },
        );
        if (plan.tracks.size <= MAX_ANIMATED_NODES) {
          transitionIdRef.current += 1;
          nextTransition = { id: transitionIdRef.current, plan };
        }
      }

      layoutResultRef.current = result;
      layoutedInputRef.current = layoutInput;
      layoutedNodesRef.current = result.layoutedNodes;
      layoutedEdgesRef.current = result.layoutedEdges;
      setNodes(() => result.layoutedNodes);
      setEdges(() => result.layoutedEdges);
      setTransition(nextTransition);
      setLayoutBounds(result.bounds);
      setLayoutedInput(layoutInput);
      cameraRequestRef.current = {
        layout: layoutInput,
        mode: !morph
          ? 'fit'
          : pending.kind === 'anchor'
            ? 'keep'
            : nextTransition
              ? 'glide'
              : 'fit',
        reveal,
      };
    };

    loadLayout();
    return () => {
      cancelled = true;
    };
  }, [layoutInput]);

  const isPanZoomReady = useStore((state) => state.panZoom !== null);

  // Frame each new layout once it is on screen. A fold needs nothing (the
  // layout itself was moved so the toggled element stays put); bulk changes
  // glide to the new extent alongside the node morph; anything else shows
  // the whole tree. Runs before paint so a new layout never flashes at the
  // old camera.
  useLayoutEffect(() => {
    const request = cameraRequestRef.current;
    if (
      !request ||
      request.layout !== layoutedInput ||
      !isPanZoomReady ||
      !canvasWidth ||
      !canvasHeight
    ) {
      return;
    }
    cameraRequestRef.current = null;
    if (request.layout.isPathway) return;
    if (request.mode === 'keep') {
      // An unfold that grew past the screen edge: glide (while it grows)
      // until all of it is visible, zooming out only if it must.
      const rect = request.reveal;
      if (!rect) return;
      const viewport = getViewport();
      const left = rect.x * viewport.zoom + viewport.x;
      const top = rect.y * viewport.zoom + viewport.y;
      const fits =
        left >= REVEAL_MARGIN &&
        top >= REVEAL_MARGIN &&
        left + rect.width * viewport.zoom <= canvasWidth - REVEAL_MARGIN &&
        top + rect.height * viewport.zoom <= canvasHeight - REVEAL_MARGIN;
      if (fits) return;
      setViewport(
        getViewportForBounds(
          rect,
          canvasWidth,
          canvasHeight,
          minZoom,
          Math.min(viewport.zoom, FIT_VIEW_OPTIONS.maxZoom),
          `${REVEAL_MARGIN}px`,
        ),
        { duration: reducedMotion ? 0 : LAYOUT_TRANSITION_MS, interpolate: 'linear' },
      );
      return;
    }
    const bounds = layoutResultRef.current?.bounds;
    if (request.mode === 'glide' && bounds) {
      // fitView would measure nodes mid-morph; frame the final layout instead.
      setViewport(
        getViewportForBounds(
          bounds,
          canvasWidth,
          canvasHeight,
          minZoom,
          FIT_VIEW_OPTIONS.maxZoom,
          FIT_VIEW_OPTIONS.padding,
        ),
        { duration: LAYOUT_TRANSITION_MS, interpolate: 'linear' },
      );
      return;
    }
    fitView(fitViewOptions);
  }, [
    layoutedInput,
    isPanZoomReady,
    canvasWidth,
    canvasHeight,
    minZoom,
    fitView,
    fitViewOptions,
    setViewport,
    getViewport,
    reducedMotion,
  ]);

  const dimOthers = currentPathwayStep?.dimOthers ?? false;
  // The "show connected" anchor is styled by the layout itself; keep it.
  const layoutAnchorId = layoutedInput?.anchorNodeId ?? null;

  // Update node and edge styles based on highlighted elements. Also re-runs
  // after every layout, which replaces the styled nodes.
  // Building a tree: picked nodes get a ring, the rest step back.
  const draftIds = draft?.ids ?? null;

  useEffect(() => {
    // Drawn ids fully in the draft (an aggregate counts when all members are).
    const inDraft = new Set<string>();
    const partlyInDraft = new Set<string>();
    if (draftIds) {
      for (const node of layoutedNodesRef.current) {
        if (node.type === 'aggregate') {
          const members = (node.data as AggregateNodeData).aggregate.memberIds;
          const count = members.filter((id) => draftIds.has(id)).length;
          if (count === members.length) inDraft.add(node.id);
          else if (count > 0) partlyInDraft.add(node.id);
        } else if (draftIds.has(node.id)) {
          inDraft.add(node.id);
        }
      }
    }

    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        // Frames are backdrops; they keep their own look.
        if (node.type === 'groupFrame') return node;
        const isHighlighted =
          highlightedElements.nodeIds.has(node.id) || node.id === layoutAnchorId;
        const ring = boxPreviewIds.has(node.id)
          ? BOX_PREVIEW_RING
          : inDraft.has(node.id)
            ? DRAFT_RING
            : null;
        const stepsBack = draftIds
          ? !inDraft.has(node.id) && !partlyInDraft.has(node.id) && !ring
          : dimOthers && !isHighlighted;
        return {
          ...node,
          style: {
            ...node.style,
            borderWidth: isHighlighted ? '3px' : '1px',
            boxShadow: nodeShadow(node, isHighlighted, ring),
            fontWeight: isHighlighted ? 'bold' : 'normal',
            opacity: stepsBack ? (draftIds ? 0.5 : 0.25) : 1,
            transition: 'opacity 300ms ease',
          },
        };
      }),
    );

    setEdges((currentEdges) =>
      currentEdges.map((edge) => {
        const isHighlighted = highlightedElements.edgeIds.has(edge.id);
        // Aggregated edges are drawn thicker by how many links they carry.
        const weight = (edge.data as EdgeWeightData | undefined)?.weight ?? 1;
        const baseWidth = edgeStrokeWidth(weight);
        const color = isHighlighted ? '#f97316' : '#374151';
        const stepsBack = draftIds
          ? !(inDraft.has(edge.source) && inDraft.has(edge.target))
          : dimOthers && !isHighlighted;
        return {
          ...edge,
          style: {
            ...edge.style,
            strokeWidth: isHighlighted ? baseWidth + 2 : baseWidth,
            stroke: color,
            opacity: stepsBack ? (draftIds ? 0.3 : 0.2) : 1,
            transition: 'opacity 300ms ease',
          },
          markerEnd: edgeMarker(color, weight),
        };
      }),
    );
  }, [
    highlightedElements,
    dimOthers,
    layoutAnchorId,
    layoutedInput,
    draftIds,
    boxPreviewIds,
  ]);

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
        // Members of an unfolded group are positioned inside its frame.
        const parentPosition =
          layoutResultRef.current?.absolutePositions.get(nodeId) ??
          parentNode.position;

        const visibleCompanies = allCompanies.slice(0, MAX_VISIBLE_COMPANIES);
        const remainingCount = allCompanies.length - visibleCompanies.length;

        const companyWidth = 140;
        const companyHeight = 80;
        const companyGap = 10;
        const px = parentPosition.x - companyWidth - 30;
        const visibleCount = visibleCompanies.length + (remainingCount > 0 ? 1 : 0);
        const totalHeight = visibleCount * (companyHeight + companyGap) - companyGap;
        const startY = parentPosition.y + 40 - totalHeight / 2;

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
        const parentPosition =
          layoutResultRef.current?.absolutePositions.get(nodeId) ??
          parentNode.position;

        const litWidth = 160;
        const litHeight = 80;
        const litGap = 10;
        // Literature nodes render to the RIGHT of the parent (companies go left).
        const px = parentPosition.x + 150 + 30;
        const totalHeight =
          data.entities.length * (litHeight + litGap) - litGap;
        const startY = parentPosition.y + 40 - totalHeight / 2;

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
        // The pathway step owns the URL while a pathway is active.
        if (!pathwayActive) onFocusChange?.(nodeId);
      }
    },
    [nodes, edges, findConnectedElements, onFocusChange, pathwayActive],
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
        // The connected view needs the full tree, so it ends a pathway.
        if (pathwayActive) onExitPathway?.();
        setSelectedNode(() => ({ ...node }));
        setShowingRelatedNodes(nodeId);
        setShowOnlyConnected(true);
        setSearchInput('');
        setSearchTerm('');
        setHighlightedElements(EMPTY_HIGHLIGHTS);
        onFocusChange?.(null);
      }
    },
    [nodes, onFocusChange, pathwayActive, onExitPathway],
  );

  const handleExitPathway = useCallback(() => {
    const targetId = pathwayMode?.pathway.targetId;
    setShowingRelatedNodes(null);
    setShowOnlyConnected(false);
    setHighlightedElements(EMPTY_HIGHLIGHTS);
    onExitPathway?.(targetId);
  }, [pathwayMode, onExitPathway]);

  // Panel list only: the graph overlay sits left of the node, which in a
  // pathway layout is exactly where its prerequisites are.
  const handlePathwayShowCompanies = useCallback(() => {
    setIsPanelExpanded(true);
    showNodeDetailsTabRef.current?.();
    showCompaniesSubViewRef.current?.();
  }, []);

  const handlePathwayAskAssistant = useCallback(() => {
    setIsPanelExpanded(true);
    showChatTabRef.current?.();
  }, []);

  // Each step highlights its stage and moves the details panel along.
  useEffect(() => {
    if (!currentPathwayStep || !isLayoutReady) return;
    setHighlightedElements({
      nodeIds: new Set(currentPathwayStep.highlightNodeIds),
      edgeIds: new Set(currentPathwayStep.highlightEdgeIds),
    });
    const focusNode = layoutedNodesRef.current.find(
      (node) => node.id === currentPathwayStep.focusNodeId,
    );
    if (focusNode) {
      setSelectedNode((current) => (current?.id === focusNode.id ? current : focusNode));
    }
    showNodeDetailsTabRef.current?.();
  }, [currentPathwayStep, isLayoutReady]);

  // Frame the step, keeping it clear of the floating guide (bottom) and the
  // toolbars (top). The viewport is computed directly because the queued
  // `fitView({ nodes })` only resolves after a re-measure, which never comes
  // for this controlled graph once node styles change.
  const graphCanvasRef = useRef<HTMLDivElement | null>(null);
  const pathwayGuideRef = useRef<HTMLElement>(null);
  const framedLayoutRef = useRef<typeof layoutInput>(null);
  useEffect(() => {
    if (!currentPathwayStep || !isLayoutReady || !isPanZoomReady) return;
    const fitNodeIds = currentPathwayStep.fitNodeIds;
    if (fitNodeIds.length === 0) return;
    // Jump on a fresh layout (nothing to animate from); glide between steps.
    const duration =
      !reducedMotion && framedLayoutRef.current === layoutedInput ? 500 : 0;
    const frame = requestAnimationFrame(() => {
      framedLayoutRef.current = layoutedInput;
      const canvas = graphCanvasRef.current;
      if (!canvas) return;
      const { width, height } = canvas.getBoundingClientRect();
      const guideHeight = pathwayGuideRef.current?.offsetHeight ?? 0;
      const viewport = getViewportForBounds(
        getNodesBounds(fitNodeIds),
        width,
        height,
        minZoom,
        1.25,
        // Bare numbers are viewport ratios; pixel paddings need the unit.
        {
          top: '120px',
          bottom: `${guideHeight + 88}px`,
          left: '48px',
          right: '48px',
        },
      );
      setViewport(viewport, { duration });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    currentPathwayStep,
    isLayoutReady,
    isPanZoomReady,
    layoutedInput,
    getNodesBounds,
    setViewport,
    reducedMotion,
    minZoom,
  ]);

  // No prerequisites: fall back to the existing direct-connections view, and
  // undo it however the pathway ends (exit, new pathway, cross-view focus).
  const emptyFallbackTargetRef = useRef<string | null>(null);
  useEffect(() => {
    if (emptyPathwayTargetId) {
      emptyFallbackTargetRef.current = emptyPathwayTargetId;
      setShowingRelatedNodes(emptyPathwayTargetId);
      setShowOnlyConnected(true);
      setSearchInput('');
      setSearchTerm('');
      return;
    }
    const fallbackTarget = emptyFallbackTargetRef.current;
    if (!fallbackTarget) return;
    emptyFallbackTargetRef.current = null;
    setShowingRelatedNodes((current) => (current === fallbackTarget ? null : current));
  }, [emptyPathwayTargetId]);

  // An unknown pathway target (stale or mistyped link) falls back to the map.
  useEffect(() => {
    if (pathwayTargetId && techTree && !pathwayMode) onExitPathway?.();
  }, [pathwayTargetId, techTree, pathwayMode, onExitPathway]);

  // The next relayout keeps `currentId` (drawn as `targetId` afterwards)
  // where it is and morphs everything else around it.
  const captureAnchor = useCallback(
    (currentId: string, targetId: string, reveal: boolean) => {
      pendingTransitionRef.current = {
        kind: 'anchor',
        anchor: { fromId: currentId, toId: targetId },
        reveal,
        at: Date.now(),
      };
    },
    [],
  );

  // The next relayout morphs while the camera glides to frame it.
  const markBulkTransition = useCallback(() => {
    pendingTransitionRef.current = { kind: 'fit', at: Date.now() };
  }, []);

  const handleToggleFold = useCallback(
    (nodeId: string) => {
      const unfolding = foldedNodeIds.has(nodeId);
      captureAnchor(nodeId, nodeId, unfolding);
      setFoldedNodeIds((current) => toggled(current, nodeId, !current.has(nodeId)));
    },
    [captureAnchor, foldedNodeIds],
  );

  const handleExpandGroup = useCallback(
    (groupKey: string, aggregateId: string) => {
      captureAnchor(aggregateId, groupFrameId(groupKey), true);
      setExpandedGroups((current) => toggled(current, groupKey, true));
    },
    [captureAnchor],
  );

  const handleCollapseGroup = useCallback(
    (groupKey: string, frameId: string) => {
      captureAnchor(frameId, aggregateNodeId(groupKey), false);
      setExpandedGroups((current) => toggled(current, groupKey, false));
    },
    [captureAnchor],
  );

  const handleAggregationModeChange = useCallback(
    (mode: AggregationMode) => {
      markBulkTransition();
      setAggregationMode(mode);
      setExpandedGroups(EMPTY_IDS);
    },
    [markBulkTransition],
  );

  const handleUnfoldAllGroups = useCallback(() => {
    markBulkTransition();
    setExpandedGroups(new Set(groupKeys));
  }, [markBulkTransition, groupKeys]);

  const handleFoldAllGroups = useCallback(() => {
    markBulkTransition();
    setExpandedGroups(EMPTY_IDS);
  }, [markBulkTransition]);

  const handleUnfoldAllBranches = useCallback(() => {
    markBulkTransition();
    setFoldedNodeIds(EMPTY_IDS);
  }, [markBulkTransition]);

  const handleOpenComparedTopic = useCallback(
    (nextTopic: TopicKey, mode: ComparisonMode) => {
      setIsComparing(false);
      handleAggregationModeChange(mode);
      if (nextTopic !== topic) onTopicChange(nextTopic);
      else if (customTreeId) onCloseCustomTree?.();
    },
    [handleAggregationModeChange, onTopicChange, topic, customTreeId, onCloseCustomTree],
  );

  const handleOpenComparedTree = useCallback(
    (tree: CustomTree, mode: ComparisonMode) => {
      setIsComparing(false);
      handleAggregationModeChange(mode);
      onOpenCustomTree?.(tree);
    },
    [handleAggregationModeChange, onOpenCustomTree],
  );

  // --- Custom trees -------------------------------------------------------

  const openChatTab = useCallback(() => {
    setIsPanelExpanded(true);
    showChatTabRef.current?.();
  }, []);

  /** What the canvas shows (before aggregation and folding). */
  const visibleTree =
    layoutInput && !layoutInput.isPathway ? layoutInput.visibleTree : null;
  const connectedLabel = showingRelatedNodes
    ? (nodeById.get(showingRelatedNodes)?.data.label ?? showingRelatedNodes)
    : null;
  const filterLabel = useMemo(() => {
    const parts: string[] = [];
    if (searchTerm.trim()) parts.push(`Search “${searchTerm.trim()}”`);
    if (selectedCategory !== 'All') parts.push(selectedCategory);
    if (groupingMode !== 'None') parts.push(`${nodeRoleLabel(groupingMode)} only`);
    return parts.length ? parts.join(' · ') : null;
  }, [searchTerm, selectedCategory, groupingMode]);

  const {
    start: startDraft,
    stop: stopDraft,
    toggle: toggleDraft,
    toggleGroup: toggleDraftGroup,
    add: addToDraft,
    clear: clearDraft,
    setName: setDraftName,
    setNotes: setDraftNotes,
    isDirty: isDraftDirty,
  } = builder;

  const startBuilder = useCallback(
    (options: Omit<StartDraftOptions, 'topic'>) => {
      // Building needs the whole tree in view.
      if (pathwayActive) onExitPathway?.();
      setShowingRelatedNodes(null);
      setShowOnlyConnected(false);
      setHighlightedElements(EMPTY_HIGHLIGHTS);
      setIsMyTreesOpen(false);
      // A new tree starts a fresh conversation.
      if (!options.editingId) deleteThread(draftThreadKey(topic));
      startDraft({ topic, ...options });
    },
    [pathwayActive, onExitPathway, startDraft, topic],
  );

  const handleNewTree = useCallback(() => startBuilder({}), [startBuilder]);

  const handleNewTreeFromView = useCallback(() => {
    if (!visibleTree) return;
    const label = connectedLabel ? `Around ${connectedLabel}` : (filterLabel ?? '');
    startBuilder({
      ids: visibleTree.nodes.map((node) => node.id),
      name: activeCustomTree ? `${activeCustomTree.name} (subset)` : label,
      origin: { kind: 'view', label },
    });
  }, [visibleTree, connectedLabel, filterLabel, activeCustomTree, startBuilder]);

  const editTreeNow = useCallback(
    (tree: CustomTree) =>
      startBuilder({
        ids: tree.nodeIds,
        name: tree.name,
        notes: tree.notes,
        editingId: tree.id,
        origin: tree.origin,
      }),
    [startBuilder],
  );

  // Editing a tree of another topic opens that topic first.
  const pendingEditRef = useRef<string | null>(null);
  const handleEditTree = useCallback(
    (tree: CustomTree) => {
      setIsMyTreesOpen(false);
      if (tree.topic !== topic) {
        pendingEditRef.current = tree.id;
        onOpenCustomTree?.(tree);
        return;
      }
      editTreeNow(tree);
    },
    [topic, onOpenCustomTree, editTreeNow],
  );
  useEffect(() => {
    const id = pendingEditRef.current;
    if (!id || !techTree) return;
    const tree = customTrees.find((candidate) => candidate.id === id);
    if (!tree) {
      pendingEditRef.current = null;
      return;
    }
    if (tree.topic !== topic) return;
    pendingEditRef.current = null;
    editTreeNow(tree);
  }, [techTree, topic, customTrees, editTreeNow]);

  const handleBuilderSave = useCallback(
    (asNew: boolean) => {
      if (!draft || draft.ids.size === 0) return;
      let saved: CustomTree | undefined;
      if (draft.editingId && !asNew) {
        customTreeStore.update(draft.editingId, {
          name: draft.name.trim() || undefined,
          notes: draft.notes,
          nodeIds: draft.ids,
        });
        saved = getCustomTrees().find((tree) => tree.id === draft.editingId);
      }
      if (!saved) {
        saved = customTreeStore.create({
          name: draft.name.trim() || draft.origin.label || 'My tree',
          topic,
          nodeIds: draft.ids,
          notes: draft.notes,
          origin: draft.origin,
        });
        // What was asked while building belongs to the tree now.
        if (!draft.editingId) moveThread(draftThreadKey(topic), customThreadKey(saved.id));
      }
      stopDraft();
      onOpenCustomTree?.(saved);
    },
    [draft, topic, stopDraft, onOpenCustomTree],
  );

  const handleBuilderCancel = useCallback(() => {
    if (isDraftDirty && !window.confirm('Stop building and discard the nodes you picked?')) {
      return;
    }
    if (!draft?.editingId) deleteThread(draftThreadKey(topic));
    stopDraft();
  }, [isDraftDirty, draft, topic, stopDraft]);

  const draftGrowth = useMemo(() => {
    if (!draft || !techTree) return null;
    return {
      prerequisites: ancestorsOf(techTree, draft.ids),
      dependents: descendantsOf(techTree, draft.ids),
      visible: (visibleTree?.nodes ?? [])
        .map((node) => node.id)
        .filter((id) => !draft.ids.has(id)),
      links: techTree.edges.filter(
        (edge) => draft.ids.has(edge.source) && draft.ids.has(edge.target),
      ).length,
    };
  }, [draft, techTree, visibleTree]);

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: UiNode) => {
      if (isBuilding && (!node.type || node.type === 'default')) toggleDraft(node.id);
    },
    [isBuilding, toggleDraft],
  );

  const builderActions = useMemo<TreeBuilderActions | null>(
    () =>
      draftIds
        ? {
            has: (id) => draftIds.has(id),
            countOf: (ids) =>
              ids.reduce((count, id) => count + (draftIds.has(id) ? 1 : 0), 0),
            toggle: toggleDraft,
            toggleGroup: toggleDraftGroup,
          }
        : null,
    [draftIds, toggleDraft, toggleDraftGroup],
  );

  const handleSavePathway = useCallback(() => {
    if (!pathwayMode) return;
    const { targetId, nodeIds } = pathwayMode.pathway;
    const label = cleanConceptLabel(nodeById.get(targetId)?.data.label ?? targetId);
    setSaveRequest({
      topic,
      nodeIds,
      defaultName: `Path to ${label}`,
      origin: { kind: 'pathway', label },
      what: `the pathway to ${label}`,
    });
  }, [pathwayMode, nodeById, topic]);

  const handleSaveConnected = useCallback(() => {
    if (!visibleTree || !connectedLabel) return;
    setSaveRequest({
      topic,
      nodeIds: visibleTree.nodes.map((node) => node.id),
      defaultName: `Around ${connectedLabel}`,
      origin: { kind: 'connected', label: connectedLabel },
      what: `${connectedLabel} and its direct connections`,
    });
  }, [visibleTree, connectedLabel, topic]);

  const handleSaveView = useCallback(() => {
    if (!visibleTree || !filterLabel) return;
    setSaveRequest({
      topic,
      nodeIds: visibleTree.nodes.map((node) => node.id),
      defaultName: activeCustomTree ? `${activeCustomTree.name} · ${filterLabel}` : filterLabel,
      origin: { kind: 'view', label: filterLabel },
      what: `this view (${filterLabel})`,
    });
  }, [visibleTree, filterLabel, activeCustomTree, topic]);

  const handleOpenTree = useCallback(
    (tree: CustomTree) => {
      setIsMyTreesOpen(false);
      onOpenCustomTree?.(tree);
    },
    [onOpenCustomTree],
  );

  const handleChatTree = useCallback(
    (tree: CustomTree) => {
      setIsMyTreesOpen(false);
      if (tree.id !== customTreeId) onOpenCustomTree?.(tree);
      openChatTab();
    },
    [customTreeId, onOpenCustomTree, openChatTab],
  );

  const [compareColumns, setCompareColumns] = useState<TreeRef[] | null>(null);
  const handleCompareTrees = useCallback(() => {
    setCompareColumns(null);
    setIsComparing(true);
  }, []);
  const handleCompareTree = useCallback((tree: CustomTree) => {
    setIsMyTreesOpen(false);
    setCompareColumns([
      { kind: 'custom', id: tree.id },
      { kind: 'topic', topic: tree.topic },
    ]);
    setIsComparing(true);
  }, []);

  const handleTreeDeleted = useCallback(
    (tree: CustomTree) => {
      if (tree.id === customTreeId) onCloseCustomTree?.();
    },
    [customTreeId, onCloseCustomTree],
  );

  // A `tree=` link to a tree this browser does not have.
  useEffect(() => {
    if (!isClient || !customTreeId) return;
    if (customTrees.some((tree) => tree.id === customTreeId)) return;
    setMissingTreeNotice(true);
    onCloseCustomTree?.();
  }, [isClient, customTreeId, customTrees, onCloseCustomTree]);
  useEffect(() => {
    if (!missingTreeNotice) return;
    const timer = window.setTimeout(() => setMissingTreeNotice(false), 8000);
    return () => window.clearTimeout(timer);
  }, [missingTreeNotice]);

  // What the assistant talks about: the most specific selection on screen.
  const chatScope = useMemo<ChatScope | null>(() => {
    if (!techTree) return null;
    const pathway = pathwayMode?.pathway ?? null;
    return resolveChatScope({
      topic,
      topicLabel,
      techTree,
      draft: draft
        ? {
            ids: draft.ids,
            name: draft.name,
            notes: draft.notes,
            editingId: draft.editingId,
          }
        : null,
      pathway: pathway
        ? {
            targetId: pathway.targetId,
            targetLabel: cleanConceptLabel(
              nodeById.get(pathway.targetId)?.data.label ?? pathway.targetId,
            ),
            tree: pathwayTree,
            stages: pathway.stages.map((stage) => ({
              title: stage.title,
              nodeIds: stage.nodeIds,
            })),
            bottleneck: pathway.bottleneck,
            currentStep: currentPathwayStep?.title ?? null,
            hiddenCount: pathway.hiddenCount,
          }
        : null,
      custom:
        activeCustomTree && resolvedCustomTree
          ? {
              id: activeCustomTree.id,
              name: activeCustomTree.name,
              notes: activeCustomTree.notes,
              tree: resolvedCustomTree.tree,
            }
          : null,
      view:
        visibleTree && (connectedLabel || filterLabel)
          ? { tree: visibleTree, connectedTo: connectedLabel, filterLabel }
          : null,
    });
  }, [
    techTree,
    topic,
    topicLabel,
    draft,
    pathwayMode,
    pathwayTree,
    currentPathwayStep,
    nodeById,
    activeCustomTree,
    resolvedCustomTree,
    visibleTree,
    connectedLabel,
    filterLabel,
  ]);

  const handleGroupingModeChange = useCallback(
    (mode: GroupingMode) => {
      setGroupingMode(mode);
      setSelectedNode(undefined);
      setShowingRelatedNodes(null);
      setShowOnlyConnected(false);
      setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
      onFocusChange?.(null);
    },
    [onFocusChange],
  );

  const handleReset = useCallback(() => {
    setSelectedNode(undefined);
    setShowingRelatedNodes(null);
    setShowOnlyConnected(false);
    setSearchInput('');
    setSearchTerm('');
    setSelectedCategory('All');
    setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
    onFocusChange?.(null);
  }, [onFocusChange]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchInput(value);
      setSelectedNode(undefined);
      setShowingRelatedNodes(null);
      setShowOnlyConnected(false);
      setHighlightedElements({ nodeIds: new Set(), edgeIds: new Set() });
      onFocusChange?.(null);
    },
    [onFocusChange],
  );

  // Apply each focus request (URL `focus` + request key) once, after the
  // layout that contains the node is ready, so later relayouts don't keep
  // re-selecting it or re-opening the panel.
  useEffect(() => {
    if (!requestedTechnologyId) {
      appliedFocusRef.current = null;
      return;
    }
    if (!isLayoutReady || pathwayActive) return;
    const focusKey = `${requestedTechnologyId}:${technologyFocusRequestKey ?? 0}`;
    if (appliedFocusRef.current === focusKey) return;
    const node = layoutedNodesRef.current.find(
      (candidate) => candidate.id === requestedTechnologyId,
    );
    if (!node) {
      // Drawn inside an aggregate or a folded branch: open that up once per
      // focus request, then the next layout contains the node.
      const projection = layoutInput?.projection;
      const drawnAs = projection?.representative.get(requestedTechnologyId);
      if (projection && drawnAs && drawnAs !== requestedTechnologyId) {
        const revealKey = `${focusKey}>${drawnAs}`;
        if (revealedHiddenFocusRef.current === revealKey) return;
        revealedHiddenFocusRef.current = revealKey;
        const groupKey = projection.groupKeyOf.get(requestedTechnologyId);
        if (groupKey && drawnAs === aggregateNodeId(groupKey)) {
          setExpandedGroups((current) => toggled(current, groupKey, true));
        } else {
          setFoldedNodeIds((current) => toggled(current, drawnAs, false));
        }
        return;
      }
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

    appliedFocusRef.current = focusKey;
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
    isLayoutReady,
    pathwayActive,
    findConnectedElements,
    techTree,
    minRelevance,
    layoutInput,
  ]);

  const nodeActions = useMemo<TechTreeNodeActions>(
    () => ({
      onShowDetails: handleShowDetails,
      onShowConnected: handleShowConnected,
      onShowCompanies: handleShowCompanies,
      isCompaniesExpanded: (id) => expandedCompanyNodeIds.has(id),
      literatureFor: (id) => enrichedNodes.get(id),
      onShowLiterature: handleShowLiterature,
      isLiteratureExpanded: (id) => expandedLiteratureNodeIds.has(id),
      onShowPaper: handleShowPaper,
      votesFor: (id) => litVotes.get(id),
      onLitVote: handleLitVote,
      onShowCompanyDetails: handleShowCompanyDetails,
      onShowMoreCompanies: handleShowMoreCompanies,
      onToggleFold: handleToggleFold,
      onExpandGroup: handleExpandGroup,
      onCollapseGroup: handleCollapseGroup,
      builder: builderActions,
    }),
    [
      builderActions,
      handleShowDetails,
      handleShowConnected,
      handleShowCompanies,
      expandedCompanyNodeIds,
      enrichedNodes,
      handleShowLiterature,
      expandedLiteratureNodeIds,
      handleShowPaper,
      litVotes,
      handleLitVote,
      handleShowCompanyDetails,
      handleShowMoreCompanies,
      handleToggleFold,
      handleExpandGroup,
      handleCollapseGroup,
    ],
  );

  // Stable arrays, so React Flow only re-diffs when something changed.
  const flowNodes = useMemo(
    () =>
      // Focused mode: show only the expanded node + its literature.
      litFocused
        ? [
            ...nodes.filter((n) => expandedLiteratureNodeIds.has(n.id)),
            ...literatureNodes,
          ]
        : [...nodes, ...companyNodes, ...literatureNodes],
    [litFocused, nodes, companyNodes, literatureNodes, expandedLiteratureNodeIds],
  );
  const flowEdges = useMemo(
    () =>
      (litFocused
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
      ),
    [
      litFocused,
      edges,
      companyEdges,
      literatureEdges,
      expandedLiteratureNodeIds,
      showLitEdgeLabels,
    ],
  );

  // The canvas mounts after the first layout, so track the element itself.
  const [canvasElement, setCanvasElement] = useState<HTMLDivElement | null>(null);
  const setGraphCanvas = useCallback((element: HTMLDivElement | null) => {
    graphCanvasRef.current = element;
    setCanvasElement(element);
  }, []);
  useCanvasWheel(canvasElement);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-100">
        <div className="rounded-lg bg-white p-8 text-center shadow-lg">
          <h2 className="mb-4 text-2xl font-bold text-red-600">
            Error Loading Data
          </h2>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={retryTechTree}
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
          pathwayActive={pathwayActive}
          onExitPathway={handleExitPathway}
          onChooseTechnology={onChooseTechnology}
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
          aggregationMode={aggregationMode}
          onAggregationModeChange={handleAggregationModeChange}
          groupCount={groupKeys.length}
          expandedGroupCount={
            groupKeys.filter((key) => expandedGroups.has(key)).length
          }
          onUnfoldAllGroups={handleUnfoldAllGroups}
          onFoldAllGroups={handleFoldAllGroups}
          foldedBranchCount={foldedBranchCount}
          onUnfoldAllBranches={handleUnfoldAllBranches}
          onCompareTrees={handleCompareTrees}
          onOpenMyTrees={() => setIsMyTreesOpen(true)}
          myTreeCount={customTrees.length}
          activeTree={
            activeCustomTree && resolvedCustomTree
              ? {
                  name: activeCustomTree.name,
                  nodeCount: resolvedCustomTree.tree.nodes.length,
                  missingCount: resolvedCustomTree.missingIds.length,
                }
              : null
          }
          onEditActiveTree={
            activeCustomTree ? () => editTreeNow(activeCustomTree) : undefined
          }
          onChatActiveTree={openChatTab}
          onCloseActiveTree={onCloseCustomTree}
          onSaveView={filterLabel && !showingRelatedNodes ? handleSaveView : undefined}
          onSaveConnected={connectedLabel ? handleSaveConnected : undefined}
          isBuilding={isBuilding}
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
        {isLoadingData || !hasLayout ? (
          <div className="flex-grow flex items-center justify-center h-full">
            <LoadingSpinner />
          </div>
        ) : (
          <div
            ref={setGraphCanvas}
            className="flex-grow relative overscroll-none"
            data-relayout={isLayoutReady ? undefined : 'pending'}
          >
            <TechTreeNodeActionsContext.Provider value={nodeActions}>
              <AnimatedReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                transition={transition}
                liveRectsRef={liveRectsRef}
                nodeTypes={TECH_TREE_NODE_TYPES}
                onNodesChange={undefined}
                onEdgesChange={undefined}
                onConnect={undefined}
                onEdgeClick={undefined}
                onNodeDragStop={undefined}
                draggable={false}
                nodesConnectable={false}
                colorMode={'light'}
                fitView={autoFit}
                fitViewOptions={fitViewOptions}
                minZoom={minZoom}
                onNodeClick={handleNodeClick}
                // Shift+drag picks an area, but only while building a tree.
                selectionKeyCode={isBuilding ? 'Shift' : null}
                className="h-full w-full"
              >
                <Background bgColor="white" variant={BackgroundVariant.Dots} />
                <BoxSelection
                  enabled={isBuilding}
                  onPreview={setBoxPreviewIds}
                  onCommit={addToDraft}
                />
                <Controls
                  showInteractive={false}
                  showZoom={true}
                  showFitView={true}
                  className="!left-4 !top-[180px] !bottom-auto md:!top-auto md:!bottom-4"
                />
                <ZoomDetailLevelSync />
              </AnimatedReactFlow>
            </TechTreeNodeActionsContext.Provider>
            
            {/* Knowledge Base Selector - Positioned above Legend. A pathway
                or the tree builder hides it and the legend so they don't
                cover nodes. */}
            {!pathwayActive && !isBuilding && (
              <KnowledgeBaseSelector
                topic={topic}
                onTopicChange={onTopicChange}
                customTrees={customTrees}
                activeCustomTreeId={activeCustomTree?.id ?? null}
                onOpenCustomTree={onOpenCustomTree}
              />
            )}

            {missingTreeNotice && (
              <div
                role="status"
                className="absolute left-1/2 top-4 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 shadow-md"
              >
                That tree isn&apos;t saved in this browser, so the whole tree is shown.
                <button
                  type="button"
                  onClick={() => setMissingTreeNotice(false)}
                  className="rounded p-0.5 text-amber-800 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            )}

            {activeCustomTree &&
              resolvedCustomTree &&
              !isBuilding &&
              resolvedCustomTree.tree.nodes.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
                  <div className="max-w-sm rounded-xl border border-gray-200 bg-white p-5 text-center shadow-lg">
                    <p className="text-sm font-semibold text-gray-900">
                      “{activeCustomTree.name}” has no nodes left
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      None of its nodes are in the current data. Add some, or
                      go back to the whole tree.
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button variant="outline" size="sm" onClick={onCloseCustomTree}>
                        Whole tree
                      </Button>
                      <Button size="sm" onClick={() => editTreeNow(activeCustomTree)}>
                        Edit nodes
                      </Button>
                    </div>
                  </div>
                </div>
              )}

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
            {!pathwayActive && !isBuilding && (
              <div className={`${showLegend ? 'block' : 'hidden'} md:block`}>
                <Legend
                  showAggregates={aggregationMode !== 'none' || foldedBranchCount > 0}
                />
              </div>
            )}

            {pathwayMode && onPathwayStepChange && (
              <PathwayGuide
                containerRef={pathwayGuideRef}
                topic={topic}
                pathway={pathwayMode.pathway}
                steps={pathwayMode.steps}
                stepIndex={pathwayMode.stepIndex}
                nodeById={nodeById}
                isIsolated={
                  !techTree?.edges.some(
                    (edge) =>
                      edge.source === pathwayMode.pathway.targetId ||
                      edge.target === pathwayMode.pathway.targetId,
                  )
                }
                onStepChange={onPathwayStepChange}
                onSelectNode={handleShowDetails}
                onExit={handleExitPathway}
                onChooseAnother={onChooseTechnology}
                onShowCompanies={handlePathwayShowCompanies}
                onAskAssistant={handlePathwayAskAssistant}
                onSaveAsTree={handleSavePathway}
              />
            )}

            {draft && draftGrowth && (
              <TreeBuilderPanel
                draft={draft}
                linkCount={draftGrowth.links}
                prerequisiteCount={draftGrowth.prerequisites.size}
                dependentCount={draftGrowth.dependents.size}
                visibleCount={draftGrowth.visible.length}
                onNameChange={setDraftName}
                onNotesChange={setDraftNotes}
                onAddPrerequisites={() => addToDraft(draftGrowth.prerequisites)}
                onAddDependents={() => addToDraft(draftGrowth.dependents)}
                onAddVisible={() => addToDraft(draftGrowth.visible)}
                onClear={clearDraft}
                onSave={() => handleBuilderSave(false)}
                onSaveAsNew={draft.editingId ? () => handleBuilderSave(true) : undefined}
                onAskAssistant={openChatTab}
                onCancel={handleBuilderCancel}
              />
            )}
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
            onShowChatRef={(fn) => { showChatTabRef.current = fn; }}
            onChooseTechnology={onChooseTechnology}
            panel={panel}
            onPanelChange={onPanelChange}
            chatScope={chatScope}
          />
        )}
      </div>
      <TreeComparison
        open={isComparing}
        onOpenChange={setIsComparing}
        currentTopic={topic}
        currentCustomTreeId={activeCustomTree?.id ?? null}
        initialColumns={compareColumns}
        initialMode={aggregationMode === 'none' ? 'category-role' : aggregationMode}
        onOpenTopic={handleOpenComparedTopic}
        onOpenCustomTree={handleOpenComparedTree}
      />
      <SaveTreeDialog
        request={saveRequest}
        onClose={() => setSaveRequest(null)}
        onOpenTree={handleOpenTree}
      />
      <MyTreesDialog
        open={isMyTreesOpen}
        onOpenChange={setIsMyTreesOpen}
        currentTopic={topic}
        activeTreeId={activeCustomTree?.id ?? null}
        viewNodeCount={visibleTree?.nodes.length ?? 0}
        onOpenTree={handleOpenTree}
        onEditTree={handleEditTree}
        onChatTree={handleChatTree}
        onCompareTree={handleCompareTree}
        onNewTree={handleNewTree}
        onNewFromView={handleNewTreeFromView}
        onTreeDeleted={handleTreeDeleted}
      />
    </div>
  );
};

export default TechTree;