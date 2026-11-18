'use client';

import { type Ref, useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  Building2,
  ChevronDown,
  ChevronUp,
  Compass,
  Map as MapIcon,
  MessageSquare,
  TriangleAlert,
  X,
} from 'lucide-react';
import { DataNode, LABEL_COLORS_VARIABLES, NodeLabel } from '@/lib/types';
import {
  Pathway,
  PathwayStep,
  cleanConceptLabel,
  parseTrl,
} from '@/lib/pathway';
import { NODE_ROLE_LABELS } from '@/lib/nodeRoles';
import { TopicKey } from '@/lib/topicConfig';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface PathwayGuideProps {
  /** Lets the graph keep framed nodes clear of the guide. */
  containerRef?: Ref<HTMLElement>;
  topic: TopicKey;
  pathway: Pathway;
  steps: PathwayStep[];
  stepIndex: number;
  nodeById: Map<string, DataNode>;
  /** The target has no edges at all, so there is nothing to fall back to. */
  isIsolated?: boolean;
  onStepChange: (step: number) => void;
  onSelectNode: (nodeId: string) => void;
  onExit: () => void;
  onChooseAnother?: () => void;
  onShowCompanies: () => void;
  /** Opens the chat, which is about this pathway while it is open. */
  onAskAssistant: () => void;
  /** Keeps the pathway's nodes as a custom tree. */
  onSaveAsTree?: () => void;
}

const ROLE_LABELS = NODE_ROLE_LABELS;

// Keys inside these keep their own arrow/Escape behaviour.
const KEYBOARD_OWNERS =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="tablist"], [role="slider"], [role="listbox"], [role="menu"]';

/** Floating step-by-step guide through a technology's prerequisite pathway. */
export function PathwayGuide({
  containerRef,
  topic,
  pathway,
  steps,
  stepIndex,
  nodeById,
  isIsolated = false,
  onStepChange,
  onSelectNode,
  onExit,
  onChooseAnother,
  onShowCompanies,
  onAskAssistant,
  onSaveAsTree,
}: PathwayGuideProps) {
  const [collapsed, setCollapsed] = useState(false);
  const step = steps[stepIndex];
  const isLast = stepIndex === steps.length - 1;
  const target = nodeById.get(pathway.targetId);
  const targetLabel = cleanConceptLabel(target?.data.label ?? pathway.targetId);
  const companyCount = useCompanyCount(
    topic,
    pathway.targetId,
    step.kind === 'finale' || step.kind === 'empty',
  );

  const goTo = (index: number) => {
    if (index >= 0 && index < steps.length) onStepChange(index);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const origin = event.target instanceof Element ? event.target : null;
      if (origin?.closest(KEYBOARD_OWNERS)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      if (event.key === 'ArrowRight' && stepIndex < steps.length - 1) {
        event.preventDefault();
        onStepChange(stepIndex + 1);
      } else if (event.key === 'ArrowLeft' && stepIndex > 0) {
        event.preventDefault();
        onStepChange(stepIndex - 1);
      } else if (event.key === 'Escape') {
        onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stepIndex, steps.length, onStepChange, onExit]);

  const stageSteps = steps.filter((candidate) => candidate.kind === 'stage');
  const stepLabel =
    step.kind === 'overview'
      ? 'Overview'
      : step.kind === 'stage'
        ? `Step ${stageSteps.indexOf(step) + 1} of ${stageSteps.length}`
        : step.kind === 'finale'
          ? 'Destination'
          : 'Direct connections';

  const navigation = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => goTo(stepIndex - 1)}
        disabled={stepIndex === 0}
        aria-keyshortcuts="ArrowLeft"
        title="Previous step (←)"
      >
        <ArrowLeft aria-hidden />
        Back
      </Button>
      {isLast ? (
        <Button size="sm" onClick={onExit} aria-keyshortcuts="Escape" title="Exit (Esc)">
          <MapIcon aria-hidden />
          Explore the full map
        </Button>
      ) : (
        <Button
          size="sm"
          onClick={() => goTo(stepIndex + 1)}
          aria-keyshortcuts="ArrowRight"
          title="Next step (→)"
        >
          Next
          <ArrowRight aria-hidden />
        </Button>
      )}
    </div>
  );

  if (collapsed) {
    return (
      <section
        ref={containerRef}
        aria-label={`Guided pathway to ${targetLabel}`}
        className="absolute bottom-16 left-1/2 z-20 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white/95 px-3 py-2 shadow-xl backdrop-blur"
      >
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="flex min-w-0 items-center gap-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label="Expand pathway guide"
        >
          <ChevronUp className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
          <span className="truncate">
            <span className="text-gray-500">{stepLabel} · </span>
            <span className="font-medium text-gray-900">{step.title}</span>
          </span>
        </button>
        {navigation}
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      aria-label={`Guided pathway to ${targetLabel}`}
      className="absolute bottom-16 left-1/2 z-20 flex max-h-[45%] w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-col rounded-xl border border-gray-200 bg-white/95 shadow-xl backdrop-blur"
    >
      <header className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-blue-700">
            <Compass className="h-3.5 w-3.5" aria-hidden />
            Guided pathway
          </p>
          <h2 className="truncate text-sm font-semibold text-gray-900" title={targetLabel}>
            Path to {targetLabel}
          </h2>
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onAskAssistant}
            aria-label="Ask the assistant about this pathway"
            title="Ask the assistant about this pathway"
          >
            <MessageSquare aria-hidden />
          </Button>
          {onSaveAsTree && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onSaveAsTree}
              aria-label="Save this pathway as my tree"
              title="Save this pathway as my tree"
            >
              <BookmarkPlus aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setCollapsed(true)}
            aria-label="Collapse pathway guide"
          >
            <ChevronDown aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onExit}
            aria-label="Exit pathway"
          >
            <X aria-hidden />
          </Button>
        </div>
      </header>

      {steps.length > 1 && (
        <ol className="mt-2 flex gap-1 px-4" aria-label="Pathway steps">
          {steps.map((candidate, index) => (
            <li key={index} className="flex-1">
              <button
                type="button"
                onClick={() => goTo(index)}
                aria-label={`Go to ${candidate.title}`}
                aria-current={index === stepIndex ? 'step' : undefined}
                className={cn(
                  'block h-1.5 w-full rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  index <= stepIndex ? 'bg-blue-600' : 'bg-gray-200 hover:bg-gray-300',
                )}
              />
            </li>
          ))}
        </ol>
      )}

      <div className="min-h-0 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
        <p className="text-xs text-gray-500">{stepLabel}</p>
        <h3 className="text-base font-semibold text-gray-900">{step.title}</h3>
        <p className="text-sm text-gray-600">
          {step.kind === 'empty' && isIsolated
            ? 'This dataset records no prerequisites or dependents for this concept yet.'
            : step.description}
        </p>

        {step.kind === 'overview' && (
          <OverviewBody
            pathway={pathway}
            steps={steps}
            nodeById={nodeById}
            onSelectNode={onSelectNode}
            onJump={goTo}
          />
        )}

        {step.kind === 'stage' && step.stage && (
          <ul className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pt-1">
            {step.stage.nodeIds.map((nodeId) => {
              const node = nodeById.get(nodeId);
              return node ? (
                <li key={nodeId} className="max-w-full">
                  <NodeChip
                    node={node}
                    isBottleneck={pathway.bottleneck?.nodeId === nodeId}
                    onSelect={onSelectNode}
                  />
                </li>
              ) : null;
            })}
          </ul>
        )}

        {(step.kind === 'finale' || step.kind === 'empty') && (
          <div className="flex flex-wrap gap-2 pt-1">
            {companyCount !== null && companyCount > 0 && (
              <Button variant="outline" size="sm" onClick={onShowCompanies}>
                <Building2 aria-hidden />
                See {companyCount} compan{companyCount === 1 ? 'y' : 'ies'}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onAskAssistant}>
              <MessageSquare aria-hidden />
              Ask the assistant
            </Button>
            {onSaveAsTree && (
              <Button variant="outline" size="sm" onClick={onSaveAsTree}>
                <BookmarkPlus aria-hidden />
                Save as my tree
              </Button>
            )}
            {onChooseAnother && (
              <Button variant="outline" size="sm" onClick={onChooseAnother}>
                <Compass aria-hidden />
                Pick another technology
              </Button>
            )}
          </div>
        )}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-gray-100 px-4 py-2">
        <ul className="hidden items-center gap-3 text-xs text-gray-500 sm:flex" aria-label="Node colours">
          {(Object.keys(ROLE_LABELS) as NodeLabel[]).map((role) => (
            <li key={role} className="flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: LABEL_COLORS_VARIABLES[role] }}
                aria-hidden
              />
              {ROLE_LABELS[role]}
            </li>
          ))}
        </ul>
        <div className="ml-auto">{navigation}</div>
      </footer>
    </section>
  );
}

interface OverviewBodyProps {
  pathway: Pathway;
  steps: PathwayStep[];
  nodeById: Map<string, DataNode>;
  onSelectNode: (nodeId: string) => void;
  onJump: (index: number) => void;
}

function OverviewBody({ pathway, steps, nodeById, onSelectNode, onJump }: OverviewBodyProps) {
  const bottleneckNode = pathway.bottleneck
    ? nodeById.get(pathway.bottleneck.nodeId)
    : undefined;

  return (
    <div className="space-y-3 pt-1">
      {bottleneckNode && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span>Lowest readiness on the path:</span>
          <NodeChip node={bottleneckNode} onSelect={onSelectNode} />
        </div>
      )}
      {pathway.hiddenCount > 0 && (
        <p className="text-xs text-gray-500">
          Showing the {pathway.prerequisiteCount} closest prerequisites;{' '}
          {pathway.hiddenCount} more are left out to keep the path readable.
        </p>
      )}
      <ol className="text-sm">
        {steps.map((candidate, index) =>
          candidate.kind === 'stage' && candidate.stage ? (
            <li key={index}>
              <button
                type="button"
                onClick={() => onJump(index)}
                className="flex w-full items-center justify-between rounded-md px-2 py-0.5 text-left text-gray-700 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span>
                  <span className="mr-2 tabular-nums text-gray-400">{index}.</span>
                  {candidate.title}
                </span>
                <span className="text-xs text-gray-500">
                  {candidate.stage.nodeIds.length}
                </span>
              </button>
            </li>
          ) : null,
        )}
      </ol>
    </div>
  );
}

interface NodeChipProps {
  node: DataNode;
  isBottleneck?: boolean;
  onSelect: (nodeId: string) => void;
}

function NodeChip({ node, isBottleneck = false, onSelect }: NodeChipProps) {
  const role = node.data.nodeLabel;
  const label = cleanConceptLabel(node.data.label);
  const trl = parseTrl(node.data.trl_current);

  return (
    <button
      type="button"
      onClick={() => onSelect(node.id)}
      title={`${label} (${ROLE_LABELS[role] ?? role})`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-left text-xs text-gray-800 transition hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: LABEL_COLORS_VARIABLES[role] }}
        aria-hidden
      />
      <span className="truncate">{label}</span>
      {trl !== null && (
        <span className="shrink-0 text-gray-500">TRL {node.data.trl_current}</span>
      )}
      {isBottleneck && (
        <span className="shrink-0 rounded bg-amber-100 px-1 text-amber-800">
          lowest
        </span>
      )}
    </button>
  );
}

/** Companies mapped to the target, fetched only on the closing step. */
function useCompanyCount(
  topic: TopicKey,
  nodeId: string,
  enabled: boolean,
): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setCount(null);
    fetch(
      `/investment-tech-tree/api/companies?nodeId=${encodeURIComponent(nodeId)}&topic=${topic}`,
      { signal: controller.signal },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { companies?: unknown[] } | null) =>
        setCount(Array.isArray(data?.companies) ? data.companies.length : 0),
      )
      .catch(() => {
        if (!controller.signal.aborted) setCount(0);
      });
    return () => controller.abort();
  }, [topic, nodeId, enabled]);

  return count;
}
