'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import {
  ChatMention,
  CompanySummary,
  ExplorerSelection,
  ExplorerViewMode,
  UiNode,
} from '@/lib/types';
import { TopicKey, TopicSummary } from '@/lib/topicConfig';
import { ExplorerPanel } from '@/lib/explorerUrlState';
import {
  OnboardingState,
  readOnboardingState,
  writeOnboardingState,
} from '@/lib/onboardingStorage';
import { isReactorNode } from '@/lib/reactorEntities';
import { PathwayFilters } from '@/lib/smrFilters';
import { useTechTree } from '@/hooks/useTechTree';
import { useTopics } from '@/hooks/useTopics';
import { useCompanyView } from '@/hooks/useCompanyView';
import { useExplorerUrlState } from '@/hooks/useExplorerUrlState';
import { useCustomTrees } from '@/hooks/useCustomTrees';
import { CustomTree } from '@/lib/customTrees';
import TechTree from './TechTree';
import { CompanyExplorer } from './CompanyExplorer';
import { WorldExplorer } from './WorldExplorer';
import { ViewModeSelector } from './ViewModeSelector';
import { KnowledgeBaseSelector } from './KnowledgeBaseSelector';
import { LoadingSpinner } from './LoadingSpinner';
import {
  MOBILE_WARNING_DISMISSED_EVENT,
  isMobileWarningPending,
} from './MobileWarning';
import { WelcomeFlow, WelcomeStep } from './onboarding/WelcomeFlow';

/**
 * Reads persisted preferences before mounting the workspace so a returning
 * visitor's last topic is fetched directly instead of the default first.
 */
export function ExplorerWorkspace() {
  const [storedState, setStoredState] = useState<OnboardingState | null>(null);
  const { topics, isLoading, error } = useTopics();

  useEffect(() => {
    setStoredState(readOnboardingState());
  }, []);

  if (!storedState || isLoading) {
    return (
      <div className="h-full w-full bg-gray-100">
        <LoadingSpinner />
      </div>
    );
  }

  if (error || topics.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-600">
        {error ??
          'No tech tree datasets found — run scripts/seed-dataset.ts first.'}
      </div>
    );
  }

  return (
    <ExplorerWorkspaceContent initialOnboarding={storedState} topics={topics} />
  );
}

interface ExplorerWorkspaceContentProps {
  initialOnboarding: OnboardingState;
  topics: TopicSummary[];
}

function ExplorerWorkspaceContent({
  initialOnboarding,
  topics,
}: ExplorerWorkspaceContentProps) {
  const { urlState, updateUrl } = useExplorerUrlState();
  const customTrees = useCustomTrees();
  // A custom tree belongs to one topic, which wins over the URL's.
  const customTree = urlState.tree
    ? customTrees.find((tree) => tree.id === urlState.tree)
    : undefined;
  // Stored or shared ids may name a dataset that no longer exists.
  const knownTopic = (id: TopicKey | null | undefined) =>
    id && topics.some((entry) => entry.id === id) ? id : null;
  const topic: TopicKey =
    customTree?.topic ??
    knownTopic(urlState.topic) ??
    knownTopic(initialOnboarding.lastTopic) ??
    topics.find((entry) => entry.id === 'smr')?.id ??
    topics[0].id;
  const viewMode = urlState.view;

  const [companyDataRequested, setCompanyDataRequested] = useState(
    viewMode === 'company' || viewMode === 'world',
  );
  const { techTree } = useTechTree(topic);
  const companyView = useCompanyView(topic, {
    enabled:
      companyDataRequested || viewMode === 'company' || viewMode === 'world',
  });
  // Lifted so ChatView can route a past answer's mentions to the tree panel.
  const [chatMentions, setChatMentions] = useState<ChatMention[]>([]);
  // Lifted so the technology picker's step counts follow the same relation
  // filters (detail slider, source-backed toggle) as the pathway it opens.
  // Detail slider defaults to "all" (no relevance filtering).
  const [minRelevance, setMinRelevance] = useState(0);
  const [sourceBackedOnly, setSourceBackedOnly] = useState(true);
  const pathwayFilters = useMemo<PathwayFilters>(
    () => ({ minRelevance, sourceBackedOnly }),
    [minRelevance, sourceBackedOnly],
  );
  const [selection, setSelection] = useState<ExplorerSelection>();
  const [companyFocusNodeId, setCompanyFocusNodeId] = useState<string | null>(
    null,
  );
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [lastTechnologyId, setLastTechnologyId] = useState(
    initialOnboarding.lastTechnologyId,
  );
  // First bare visit only: shared links (focus, pathway, other views) open
  // directly on what was shared.
  const [welcomeStep, setWelcomeStep] = useState<WelcomeStep | null>(() =>
    !initialOnboarding.completedAt &&
    !urlState.pathway &&
    !urlState.focus &&
    urlState.view === 'technology'
      ? 'sector'
      : null,
  );
  const [welcomeSession, setWelcomeSession] = useState(0);
  // A modal dialog would block the mobile overlay's dismiss button.
  const [mobileWarningPending, setMobileWarningPending] = useState(
    isMobileWarningPending,
  );

  useEffect(() => {
    if (viewMode === 'company' || viewMode === 'world') {
      setCompanyDataRequested(true);
    }
  }, [viewMode]);

  useEffect(() => {
    writeOnboardingState({ lastTopic: topic });
  }, [topic]);

  // Deep-link: ?view=world&tech=smr:… opens the reactor entity panel.
  useEffect(() => {
    if (viewMode !== 'world' || !urlState.tech || !techTree) return;
    if (selection?.kind === 'reactor' && selection.nodeId === urlState.tech) {
      return;
    }
    const node = techTree.nodes.find((entry) => entry.id === urlState.tech);
    if (!node || !isReactorNode(node)) return;
    setSelection({
      kind: 'reactor',
      nodeId: node.id,
      label: node.data.label,
    });
  }, [viewMode, urlState.tech, techTree, selection]);

  useEffect(() => {
    const handleDismissed = () => setMobileWarningPending(false);
    window.addEventListener(MOBILE_WARNING_DISMISSED_EVENT, handleDismissed);
    return () =>
      window.removeEventListener(MOBILE_WARNING_DISMISSED_EVENT, handleDismissed);
  }, []);

  const openWelcome = useCallback((step: WelcomeStep) => {
    setWelcomeStep(step);
    setWelcomeSession((current) => current + 1);
  }, []);

  const openTechnologyPicker = useCallback(
    () => openWelcome('technology'),
    [openWelcome],
  );

  const handleWelcomeSkip = () => {
    writeOnboardingState({ completedAt: Date.now() });
    setWelcomeStep(null);
  };

  const handleChooseTechnology = (nextTopic: TopicKey, technologyId: string) => {
    writeOnboardingState({
      completedAt: Date.now(),
      lastTopic: nextTopic,
      lastTechnologyId: technologyId,
    });
    setLastTechnologyId(technologyId);
    setSelection(undefined);
    setCompanyFocusNodeId(null);
    setWelcomeStep(null);
    updateUrl({
      topic: nextTopic,
      view: 'technology',
      focus: null,
      pathway: technologyId,
      step: 0,
      tree: null,
    });
  };

  const handleOpenCustomTree = useCallback(
    (tree: CustomTree) => {
      setSelection(undefined);
      updateUrl({
        topic: tree.topic,
        view: 'technology',
        tree: tree.id,
        focus: null,
        pathway: null,
        step: null,
      });
    },
    [updateUrl],
  );

  const handleCloseCustomTree = useCallback(
    () => updateUrl({ tree: null }),
    [updateUrl],
  );

  const handlePathwayStepChange = useCallback(
    (step: number) => updateUrl({ step }),
    [updateUrl],
  );

  const handleExitPathway = useCallback(
    (focusNodeId?: string) => {
      setFocusRequestKey((current) => current + 1);
      updateUrl({ pathway: null, step: null, focus: focusNodeId ?? null });
    },
    [updateUrl],
  );

  const selectedEntityId = useMemo(() => {
    if (selection?.kind === 'company') return `company:${selection.company.id}`;
    if (selection?.kind === 'technology') {
      return `technology:${selection.node.id}`;
    }
    return undefined;
  }, [selection]);

  const handleTopicChange = (nextTopic: TopicKey) => {
    setSelection(undefined);
    setCompanyFocusNodeId(null);
    updateUrl({ topic: nextTopic, focus: null, pathway: null, step: null, tree: null });
  };

  const handleViewModeChange = (nextView: ExplorerViewMode) => {
    updateUrl({ view: nextView });
  };

  const handlePanelChange = useCallback(
    (nextPanel: ExplorerPanel) => updateUrl({ panel: nextPanel }),
    [updateUrl],
  );

  const handleRequestChatView = useCallback(
    () => updateUrl({ view: 'chat' }),
    [updateUrl],
  );

  const handleFocusChange = useCallback(
    (nodeId: string | null) => updateUrl({ focus: nodeId }),
    [updateUrl],
  );

  const showTechnology = (nodeId: string) => {
    const dataNode = techTree?.nodes.find((node) => node.id === nodeId);
    if (!dataNode) return;
    const node: UiNode = { ...dataNode, position: { x: 0, y: 0 } };
    setSelection({ kind: 'technology', node });
    setFocusRequestKey((current) => current + 1);
    // A custom tree may not hold the node; show it in the whole tree.
    updateUrl({ view: 'technology', focus: nodeId, pathway: null, step: null, tree: null });
  };

  const showCompany = (company: CompanySummary) => {
    setSelection({ kind: 'company', company });
    setCompanyFocusNodeId(`company:${company.id}`);
    updateUrl({ view: 'company', tech: null });
  };

  const showReactor = (nodeId: string, label: string) => {
    const fromCountry =
      selection?.kind === 'country'
        ? selection
        : selection?.kind === 'reactor' && selection.fromCountryIso
          ? {
              countryIso: selection.fromCountryIso,
              countryName: selection.fromCountryName ?? selection.fromCountryIso,
              layer: selection.fromLayer ?? ('headquarters' as const),
              companies: selection.fromCompanies ?? [],
            }
          : null;
    setSelection({
      kind: 'reactor',
      nodeId,
      label,
      ...(fromCountry
        ? {
            fromCountryIso: fromCountry.countryIso,
            fromCountryName: fromCountry.countryName,
            fromLayer: fromCountry.layer,
            fromCompanies: fromCountry.companies,
          }
        : {}),
    });
    updateUrl({ view: 'world', tech: nodeId });
  };

  const clearReactor = () => {
    if (selection?.kind !== 'reactor') return;
    setSelection(undefined);
    updateUrl({ tech: null });
  };

  const backFromReactor = () => {
    if (selection?.kind !== 'reactor' || !selection.fromCountryIso) {
      clearReactor();
      return;
    }
    setSelection({
      kind: 'country',
      countryIso: selection.fromCountryIso,
      countryName: selection.fromCountryName ?? selection.fromCountryIso,
      layer: selection.fromLayer ?? 'headquarters',
      companies: selection.fromCompanies ?? [],
    });
    updateUrl({ tech: null });
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-gray-100">
      <div
        className={`absolute bottom-4 z-[70] ${
          viewMode === 'technology' || viewMode === 'chat'
            ? 'left-1/4 -translate-x-1/2'
            : 'right-4'
        }`}
      >
        <ViewModeSelector value={viewMode} onChange={handleViewModeChange} />
      </div>

      {viewMode !== 'technology' && viewMode !== 'chat' && (
        <div className="absolute top-6 left-4 z-10">
          <KnowledgeBaseSelector
            topic={topic}
            onTopicChange={handleTopicChange}
          />
        </div>
      )}

      {/* ChatView keeps this mounted: the same chat stays on the right and
          the canvas swaps to the answer's mention graph. */}
      <div
        hidden={viewMode !== 'technology' && viewMode !== 'chat'}
        inert={viewMode !== 'technology' && viewMode !== 'chat'}
        aria-hidden={viewMode !== 'technology' && viewMode !== 'chat'}
        className="h-full w-full"
      >
        <ReactFlowProvider>
          <TechTree
            topic={topic}
            onTopicChange={handleTopicChange}
            requestedTechnologyId={urlState.focus ?? undefined}
            technologyFocusRequestKey={focusRequestKey}
            onFocusChange={handleFocusChange}
            pathwayTargetId={urlState.pathway}
            pathwayStep={urlState.step}
            onPathwayStepChange={handlePathwayStepChange}
            onExitPathway={handleExitPathway}
            onChooseTechnology={openTechnologyPicker}
            panel={urlState.panel}
            onPanelChange={handlePanelChange}
            onRequestChatView={handleRequestChatView}
            chatViewActive={viewMode === 'chat'}
            chatMentions={chatMentions}
            onChatMentionsChange={setChatMentions}
            customTreeId={urlState.tree}
            onOpenCustomTree={handleOpenCustomTree}
            onCloseCustomTree={handleCloseCustomTree}
            minRelevance={minRelevance}
            onMinRelevanceChange={setMinRelevance}
            sourceBackedOnly={sourceBackedOnly}
            onSourceBackedOnlyChange={setSourceBackedOnly}
          />
        </ReactFlowProvider>
      </div>

      <div
        hidden={viewMode !== 'company'}
        inert={viewMode !== 'company'}
        aria-hidden={viewMode !== 'company'}
        className="h-full w-full"
      >
        <ReactFlowProvider>
          <CompanyExplorer
            topic={topic}
            isActive={viewMode === 'company'}
            data={companyView.data}
            techTree={techTree}
            isLoading={companyView.isLoading}
            error={companyView.error}
            selectedEntityId={selectedEntityId}
            requestedFocusNodeId={companyFocusNodeId}
            onSelectTechnology={(node) => showTechnology(node.id)}
            onSelectCompany={(company) => {
              setSelection({ kind: 'company', company });
              setCompanyFocusNodeId(null);
            }}
          />
        </ReactFlowProvider>
      </div>

      <div
        hidden={viewMode !== 'world'}
        inert={viewMode !== 'world'}
        aria-hidden={viewMode !== 'world'}
        className="h-full w-full"
      >
        <WorldExplorer
          data={companyView.data}
          techTree={techTree}
          topic={topic}
          isLoading={companyView.isLoading}
          error={companyView.error}
          selectedCountryIso={
            selection?.kind === 'country'
              ? selection.countryIso
              : selection?.kind === 'reactor'
                ? selection.fromCountryIso
                : undefined
          }
          selectedReactor={
            selection?.kind === 'reactor'
              ? {
                  nodeId: selection.nodeId,
                  label: selection.label,
                  fromCountryName: selection.fromCountryName,
                }
              : null
          }
          onSelectCountry={(countryIso, countryName, layer, companies) => {
            setSelection({
              kind: 'country',
              countryIso,
              countryName,
              layer,
              companies,
            });
            updateUrl({ tech: null });
          }}
          onClearCountry={() => {
            if (
              selection?.kind === 'country' ||
              selection?.kind === 'reactor'
            ) {
              setSelection(undefined);
              updateUrl({ tech: null });
            }
          }}
          onShowReactor={showReactor}
          onClearReactor={clearReactor}
          onBackFromReactor={
            selection?.kind === 'reactor' && selection.fromCountryIso
              ? backFromReactor
              : undefined
          }
          onShowCompany={showCompany}
          onShowTechnology={showTechnology}
        />
      </div>

      {welcomeStep && !mobileWarningPending && (
        <WelcomeFlow
          key={welcomeSession}
          initialStep={welcomeStep}
          initialTopic={topic}
          topics={topics}
          lastTechnologyId={lastTechnologyId}
          onSkip={handleWelcomeSkip}
          onChooseTechnology={handleChooseTechnology}
          pathwayFilters={pathwayFilters}
        />
      )}
    </div>
  );
}
