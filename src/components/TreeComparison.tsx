'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  Background,
  BackgroundVariant,
  Controls,
  Edge,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import { ArrowLeftToLine, ArrowRight, Plus, X } from 'lucide-react';
import { labelForTopic, TopicKey } from '@/lib/topicConfig';
import { NODE_LABELS, TechTree, UiNode } from '@/lib/types';
import { loadTechTree, peekTechTree } from '@/hooks/useTechTree';
import { useCustomTrees } from '@/hooks/useCustomTrees';
import { useTopics } from '@/hooks/useTopics';
import {
  AGGREGATION_MODE_LABELS,
  AggregationMode,
  TreeSummary,
  projectTree,
  summarizeTree,
} from '@/lib/treeProjection';
import { CustomTree, resolveCustomTree, treeOverlap } from '@/lib/customTrees';
import { layoutProjection, roleColor } from '@/lib/elkjs';
import { nodeRolePluralLabel } from '@/lib/nodeRoles';
import {
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { TECH_TREE_NODE_TYPES } from './techTreeNodeTypes';
import { TechTreeNodeActionsContext } from './techTreeNodeActions';

export type ComparisonMode = Exclude<AggregationMode, 'none'>;

export const COMPARISON_MODES: ComparisonMode[] = [
  'category-role',
  'category',
  'role',
];

/** A tree that can be a comparison column: a topic or a custom tree. */
export type TreeRef =
  | { kind: 'topic'; topic: TopicKey }
  | { kind: 'custom'; id: string };

/** Wider tables stop being readable side by side. */
const MAX_COLUMNS = 4;
/** One neutral hue: the TRL bars measure readiness, not a node role. */
const TRL_BAR_COLOR = '#64748b';
/** Tallest bar's share of the plot height; the rest is room for its label. */
const TRL_PLOT_FILL = 0.82;

const refKey = (ref: TreeRef) =>
  ref.kind === 'topic' ? `topic:${ref.topic}` : `custom:${ref.id}`;

type TreeState =
  | { status: 'loading' }
  | { status: 'ready'; tree: TechTree }
  | { status: 'error' };

/** Loads the topic trees the columns need, once each. */
function useTopicTrees(
  topics: TopicKey[],
  allTopics: TopicKey[],
  enabled: boolean,
): Partial<Record<TopicKey, TreeState>> {
  const [states, setStates] = useState<Partial<Record<TopicKey, TreeState>>>(() =>
    Object.fromEntries(
      allTopics.flatMap((topic) => {
        const tree = peekTechTree(topic);
        return tree ? [[topic, { status: 'ready', tree }]] : [];
      }),
    ),
  );
  const wanted = topics.join(',');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    for (const topic of wanted.split(',').filter(Boolean) as TopicKey[]) {
      loadTechTree(topic).then(
        (tree) => {
          if (cancelled) return;
          setStates((current) => {
            const state = current[topic];
            return state?.status === 'ready' && state.tree === tree
              ? current
              : { ...current, [topic]: { status: 'ready', tree } };
          });
        },
        () => {
          if (!cancelled) {
            setStates((current) => ({ ...current, [topic]: { status: 'error' } }));
          }
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [wanted, enabled]);

  return states;
}

interface Column {
  ref: TreeRef;
  key: string;
  label: string;
  /** "My tree · Nuclear Energy" for custom trees. */
  detail: string | null;
  topic: TopicKey;
  state: TreeState;
  custom: CustomTree | null;
  isCurrent: boolean;
}

function defaultColumns(
  currentTopic: TopicKey,
  currentCustomTreeId: string | null,
  allTopics: TopicKey[],
): TreeRef[] {
  const topics = allTopics.map((topic): TreeRef => ({ kind: 'topic', topic }));
  if (currentCustomTreeId) {
    const current: TreeRef = { kind: 'custom', id: currentCustomTreeId };
    return [current, ...topics].slice(0, MAX_COLUMNS);
  }
  return [
    { kind: 'topic', topic: currentTopic },
    ...topics.filter((ref) => ref.kind === 'topic' && ref.topic !== currentTopic),
  ];
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

interface TreeComparisonProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTopic: TopicKey;
  /** The custom tree on the canvas, if any. */
  currentCustomTreeId?: string | null;
  /** Columns to start with; null picks the current tree plus the topics. */
  initialColumns?: TreeRef[] | null;
  initialMode: ComparisonMode;
  /** Opens a tree in the main view, aggregated the same way. */
  onOpenTopic: (topic: TopicKey, mode: ComparisonMode) => void;
  onOpenCustomTree?: (tree: CustomTree, mode: ComparisonMode) => void;
}

/**
 * Tech trees and custom trees side by side, scaled down to aggregates:
 * headline figures, overlap with a baseline, role mix and readiness on
 * shared scales, then each tree's aggregated structure.
 */
export function TreeComparison({
  open,
  onOpenChange,
  currentTopic,
  currentCustomTreeId = null,
  initialColumns = null,
  initialMode,
  onOpenTopic,
  onOpenCustomTree,
}: TreeComparisonProps) {
  const customTrees = useCustomTrees();
  const { topics: topicSummaries } = useTopics();
  const allTopicIds = useMemo(
    () => topicSummaries.map((entry) => entry.id),
    [topicSummaries],
  );
  const [mode, setMode] = useState<ComparisonMode>(initialMode);
  const [refs, setRefs] = useState<TreeRef[]>(
    () =>
      initialColumns ??
      defaultColumns(currentTopic, currentCustomTreeId, allTopicIds),
  );
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setRefs(
      initialColumns ??
        defaultColumns(currentTopic, currentCustomTreeId, allTopicIds),
    );
  }, [
    open,
    initialMode,
    initialColumns,
    currentTopic,
    currentCustomTreeId,
    allTopicIds,
  ]);

  const customById = useMemo(
    () => new Map(customTrees.map((tree) => [tree.id, tree])),
    [customTrees],
  );
  // A deleted custom tree drops out of the comparison.
  const liveRefs = useMemo(
    () => refs.filter((ref) => ref.kind === 'topic' || customById.has(ref.id)),
    [refs, customById],
  );
  const topicOf = (ref: TreeRef): TopicKey =>
    ref.kind === 'topic' ? ref.topic : customById.get(ref.id)!.topic;
  const neededTopics = [...new Set(liveRefs.map(topicOf))];
  const states = useTopicTrees(neededTopics, allTopicIds, open);

  const columns = useMemo<Column[]>(
    () =>
      liveRefs.map((ref) => {
        const custom = ref.kind === 'custom' ? customById.get(ref.id)! : null;
        const topic = custom ? custom.topic : (ref as { topic: TopicKey }).topic;
        const topicState = states[topic] ?? { status: 'loading' };
        const state: TreeState =
          custom && topicState.status === 'ready'
            ? { status: 'ready', tree: resolveCustomTree(topicState.tree, custom).tree }
            : topicState;
        return {
          ref,
          key: refKey(ref),
          label: custom ? custom.name : labelForTopic(topicSummaries, topic),
          detail: custom
            ? `My tree · ${labelForTopic(topicSummaries, topic)}`
            : null,
          topic,
          state,
          custom,
          isCurrent: custom
            ? custom.id === currentCustomTreeId
            : !currentCustomTreeId && topic === currentTopic,
        };
      }),
    [liveRefs, customById, states, currentCustomTreeId, currentTopic, topicSummaries],
  );

  const summaries = useMemo(
    () =>
      new Map(
        columns.map((column) => [
          column.key,
          column.state.status === 'ready' && column.state.tree.nodes.length
            ? summarizeTree(column.state.tree)
            : null,
        ]),
      ),
    [columns],
  );
  // One y-scale for every TRL chart, so bar heights compare across trees.
  const maxTrlShare = Math.max(
    0.01,
    ...columns.flatMap((column) => {
      const summary = summaries.get(column.key);
      const rated = summary ? summary.nodeCount - summary.unratedCount : 0;
      return summary && rated
        ? summary.trlHistogram.map((count) => count / rated)
        : [];
    }),
  );

  const available = useMemo(() => {
    const used = new Set(liveRefs.map(refKey));
    return {
      topics: allTopicIds.filter((topic) => !used.has(`topic:${topic}`)),
      custom: customTrees.filter((tree) => !used.has(`custom:${tree.id}`)),
    };
  }, [liveRefs, customTrees, allTopicIds]);

  const addColumn = (value: string) => {
    const ref: TreeRef = value.startsWith('custom:')
      ? { kind: 'custom', id: value.slice('custom:'.length) }
      : { kind: 'topic', topic: value.slice('topic:'.length) as TopicKey };
    setRefs([...liveRefs, ref].slice(0, MAX_COLUMNS));
  };
  const removeColumn = (key: string) =>
    setRefs(liveRefs.filter((ref) => refKey(ref) !== key));
  const makeBaseline = (key: string) =>
    setRefs([
      ...liveRefs.filter((ref) => refKey(ref) === key),
      ...liveRefs.filter((ref) => refKey(ref) !== key),
    ]);

  const openColumn = (column: Column) => {
    if (column.custom) onOpenCustomTree?.(column.custom, mode);
    else onOpenTopic(column.topic, mode);
  };

  const baseline = columns[0];
  const tableMinWidth = 240 + columns.length * 220;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className="z-[80]" />
        <DialogPrimitive.Content className="fixed inset-2 z-[81] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl focus:outline-none md:inset-6">
          {/* Comparison previews are static: no tree actions inside. */}
          <TechTreeNodeActionsContext.Provider value={null}>
            <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
              <div className="space-y-1">
                <DialogTitle className="text-lg font-semibold text-gray-900">
                  Compare trees
                </DialogTitle>
                <DialogDescription className="max-w-2xl text-sm text-gray-600">
                  Tech trees and your own trees side by side, scaled down to
                  aggregate nodes. The first column is the baseline the others
                  are measured against. Figures cover each full tree, before
                  any filters.
                </DialogDescription>
              </div>
              <div className="flex items-center gap-3">
                <div
                  className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5"
                  role="radiogroup"
                  aria-label="Aggregate by"
                >
                  {COMPARISON_MODES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={mode === option}
                      onClick={() => setMode(option)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        mode === option
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      }`}
                    >
                      {AGGREGATION_MODE_LABELS[option]}
                    </button>
                  ))}
                </div>
                <DialogPrimitive.Close
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  aria-label="Close comparison"
                >
                  <X className="h-5 w-5" aria-hidden />
                </DialogPrimitive.Close>
              </div>
            </header>

            <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-3">
              <span className="text-xs font-medium text-gray-600">Comparing</span>
              {columns.map((column, index) => (
                <span
                  key={column.key}
                  className={`inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-medium ${
                    index === 0
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 bg-white text-gray-800'
                  }`}
                >
                  {index === 0 && <span className="text-[10px] uppercase tracking-wider opacity-80">Baseline ·</span>}
                  <span className="max-w-[12rem] truncate">{column.label}</span>
                  {columns.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeColumn(column.key)}
                      className={`rounded-full p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        index === 0 ? 'hover:bg-white/20' : 'hover:bg-gray-100'
                      }`}
                      aria-label={`Stop comparing ${column.label}`}
                    >
                      <X className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </span>
              ))}
              {(available.topics.length > 0 || available.custom.length > 0) && (
                <Select value="" onValueChange={addColumn} disabled={columns.length >= MAX_COLUMNS}>
                  <SelectTrigger
                    className="h-7 w-auto gap-1 rounded-full border-dashed px-2.5 text-xs"
                    aria-label="Add a tree to compare"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    <SelectValue
                      placeholder={columns.length >= MAX_COLUMNS ? `Up to ${MAX_COLUMNS} trees` : 'Add tree'}
                    />
                  </SelectTrigger>
                  <SelectContent className="z-[90]">
                    {available.topics.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Tech trees</SelectLabel>
                        {available.topics.map((topic) => (
                          <SelectItem key={topic} value={`topic:${topic}`}>
                            {labelForTopic(topicSummaries, topic)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {available.topics.length > 0 && available.custom.length > 0 && (
                      <SelectSeparator />
                    )}
                    {available.custom.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>My trees</SelectLabel>
                        {available.custom.map((tree) => (
                          <SelectItem key={tree.id} value={`custom:${tree.id}`}>
                            {tree.name}
                            <span className="ml-1.5 text-xs text-gray-500">
                              · {labelForTopic(topicSummaries, tree.topic)}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="overflow-x-auto">
                <table
                  className="w-full table-fixed border-collapse text-sm"
                  style={{ minWidth: tableMinWidth }}
                >
                  <caption className="sr-only">
                    Headline figures for each compared tree
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="w-48" />
                      {columns.map((column, index) => (
                        <th
                          key={column.key}
                          scope="col"
                          className="px-4 pb-3 text-left align-bottom font-normal"
                        >
                          {column.detail && (
                            <span className="block text-[11px] font-medium uppercase tracking-wider text-blue-700">
                              {column.detail}
                            </span>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-semibold text-gray-900">
                              {column.label}
                            </span>
                            {index === 0 && columns.length > 1 && (
                              <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-medium text-white">
                                Baseline
                              </span>
                            )}
                            {column.isCurrent && (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600">
                                Current
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3">
                            <Button
                              variant="link"
                              size="sm"
                              className="h-auto px-0 py-1 text-xs"
                              disabled={!summaries.get(column.key)}
                              onClick={() => openColumn(column)}
                            >
                              Open aggregated
                              <ArrowRight aria-hidden />
                            </Button>
                            {index > 0 && (
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto px-0 py-1 text-xs text-gray-600"
                                onClick={() => makeBaseline(column.key)}
                              >
                                <ArrowLeftToLine aria-hidden />
                                Make baseline
                              </Button>
                            )}
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    <MetricRow
                      first
                      label="Nodes"
                      columns={columns}
                      summaries={summaries}
                      value={(s) => s.nodeCount.toLocaleString()}
                    />
                    {columns.length > 1 && baseline && (
                      <OverlapRow columns={columns} baseline={baseline} />
                    )}
                    <MetricRow
                      label="Links"
                      columns={columns}
                      summaries={summaries}
                      value={(s) => s.edgeCount.toLocaleString()}
                    />
                    <MetricRow
                      label="Categories"
                      columns={columns}
                      summaries={summaries}
                      value={(s) => String(s.categoryCount)}
                    />
                    <MetricRow
                      label="Longest prerequisite chain"
                      hint="Nodes on the longest path from a foundation to the node it unlocks"
                      columns={columns}
                      summaries={summaries}
                      value={(s) =>
                        `${s.longestChain} node${s.longestChain === 1 ? '' : 's'}`
                      }
                    />
                    <MetricRow
                      label="Median TRL"
                      columns={columns}
                      summaries={summaries}
                      value={(s) =>
                        s.medianTrl === null ? '—' : String(s.medianTrl)
                      }
                    />
                    <MetricRow
                      label="Mature (TRL 7–9)"
                      hint="Share of rated nodes demonstrated as a system or better"
                      columns={columns}
                      summaries={summaries}
                      value={(s) =>
                        s.matureShare === null ? '—' : percent(s.matureShare)
                      }
                    />
                    <tr className="border-t border-gray-100 align-top">
                      <th
                        scope="row"
                        className="py-3 pr-4 text-left font-medium text-gray-600"
                      >
                        Role mix
                      </th>
                      {columns.map((column) => {
                        const summary = summaries.get(column.key);
                        return (
                          <td key={column.key} className="px-4 py-3">
                            {summary ? (
                              <RoleMix summary={summary} />
                            ) : (
                              <EmptyCell state={column.state} compact />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    <tr className="border-t border-gray-100 align-top">
                      <th
                        scope="row"
                        className="py-3 pr-4 text-left font-medium text-gray-600"
                      >
                        Readiness
                        <span className="block text-xs font-normal text-gray-500">
                          Share of rated nodes at each TRL, same scale for
                          every tree
                        </span>
                      </th>
                      {columns.map((column) => {
                        const summary = summaries.get(column.key);
                        return (
                          <td key={column.key} className="px-4 py-3">
                            {summary ? (
                              <TrlDistribution summary={summary} maxShare={maxTrlShare} />
                            ) : (
                              <EmptyCell state={column.state} compact />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
              </div>

              <h3 className="mt-8 text-sm font-semibold text-gray-900">
                Aggregated structure
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                Grouped by {AGGREGATION_MODE_LABELS[mode].toLowerCase()}. Edge
                labels count the links each arrow stands for.
              </p>
              <div
                className={`mt-3 grid gap-4 ${
                  columns.length >= 4
                    ? 'lg:grid-cols-4'
                    : columns.length === 3
                      ? 'lg:grid-cols-3'
                      : columns.length === 2
                        ? 'lg:grid-cols-2'
                        : ''
                }`}
              >
                {columns.map((column) => (
                  <section
                    key={column.key}
                    aria-label={`${column.label}, aggregated`}
                    className="overflow-hidden rounded-xl border border-gray-200"
                  >
                    <div className="border-b border-gray-100 px-4 py-2 text-sm font-medium text-gray-800">
                      {column.label}
                      {column.detail && (
                        <span className="ml-1.5 text-xs font-normal text-gray-500">
                          {column.detail}
                        </span>
                      )}
                    </div>
                    <div className="h-[380px]">
                      {column.state.status === 'ready' && column.state.tree.nodes.length ? (
                        <AggregatedPreview tree={column.state.tree} mode={mode} />
                      ) : (
                        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
                          <EmptyCell state={column.state} />
                        </div>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </TechTreeNodeActionsContext.Provider>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}

function EmptyCell({
  state,
  compact = false,
}: {
  state: TreeState;
  /** Rows after the first say it once: a dash instead of the reason. */
  compact?: boolean;
}) {
  if (compact && state.status !== 'loading') {
    return <span className="text-sm font-normal text-gray-300">—</span>;
  }
  return (
    <span className="text-sm font-normal text-gray-400">
      {state.status === 'loading'
        ? 'Loading…'
        : state.status === 'error'
          ? 'Could not load this tree'
          : 'No nodes in this tree'}
    </span>
  );
}

function MetricRow({
  label,
  hint,
  columns,
  summaries,
  value,
  first = false,
}: {
  label: string;
  hint?: string;
  first?: boolean;
  columns: Column[];
  summaries: Map<string, TreeSummary | null>;
  value: (summary: TreeSummary) => string;
}) {
  return (
    <tr className="border-t border-gray-100">
      <th
        scope="row"
        className="py-2.5 pr-4 text-left font-medium text-gray-600"
        title={hint}
      >
        {label}
      </th>
      {columns.map((column) => {
        const summary = summaries.get(column.key);
        return (
          <td key={column.key} className="px-4 py-2.5 font-semibold text-gray-900">
            {summary ? value(summary) : <EmptyCell state={column.state} compact={!first} />}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * How much of each tree the baseline already covers. Only trees drawn from
 * the same topic share node ids, so other topics are marked as such.
 */
function OverlapRow({ columns, baseline }: { columns: Column[]; baseline: Column }) {
  const baselineIds =
    baseline.state.status === 'ready'
      ? baseline.state.tree.nodes.map((node) => node.id)
      : null;
  return (
    <tr className="border-t border-gray-100 align-top">
      <th
        scope="row"
        className="py-2.5 pr-4 text-left font-medium text-gray-600"
        title="Nodes this tree shares with the baseline, and nodes only it has"
      >
        Overlap with baseline
      </th>
      {columns.map((column, index) => {
        if (index === 0) {
          return (
            <td key={column.key} className="px-4 py-2.5 text-sm text-gray-500">
              Baseline
            </td>
          );
        }
        if (column.topic !== baseline.topic) {
          return (
            <td key={column.key} className="px-4 py-2.5 text-sm text-gray-500">
              Different topic, no shared nodes
            </td>
          );
        }
        if (column.state.status !== 'ready' || !baselineIds) {
          return (
            <td key={column.key} className="px-4 py-2.5">
              <EmptyCell state={column.state} compact />
            </td>
          );
        }
        const tree = column.state.tree;
        const overlap = treeOverlap(baselineIds, tree.nodes.map((node) => node.id));
        const total = Math.max(tree.nodes.length, 1);
        const labelOf = new Map(tree.nodes.map((node) => [node.id, node.data.label]));
        return (
          <td key={column.key} className="px-4 py-2.5">
            <p className="font-semibold text-gray-900">
              {overlap.shared.length} shared{' '}
              <span className="font-normal text-gray-500">
                ({percent(overlap.shared.length / total)})
              </span>
            </p>
            <p className="text-xs text-gray-600">
              {overlap.onlyB.length} only here · {overlap.onlyA.length} only in baseline
            </p>
            {overlap.onlyB.length > 0 && (
              <details className="mt-1 text-xs text-gray-600">
                <summary className="cursor-pointer select-none font-medium text-gray-700 hover:text-gray-900">
                  Nodes only here
                </summary>
                <ul className="mt-1 max-h-40 space-y-0.5 overflow-y-auto pl-3">
                  {overlap.onlyB.map((id) => (
                    <li key={id} className="list-disc">
                      {labelOf.get(id) ?? id}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Thin segmented bar plus one row per role. The rows carry names and
 * figures (and act as the legend), so identity never rests on colour alone.
 */
function RoleMix({ summary }: { summary: TreeSummary }) {
  const total = Math.max(summary.nodeCount, 1);
  const roles = NODE_LABELS.filter((role) => summary.roleCounts[role] > 0);
  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {roles.map((role) => (
          <span
            key={role}
            style={{
              width: `${(summary.roleCounts[role] / total) * 100}%`,
              background: roleColor(role),
            }}
          />
        ))}
      </div>
      <ul className="space-y-1 text-xs">
        {NODE_LABELS.map((role) => (
          <li key={role} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-sm"
              style={{ background: roleColor(role) }}
              aria-hidden
            />
            <span className="flex-1 text-gray-700">
              {nodeRolePluralLabel(role)}
            </span>
            <span className="font-semibold text-gray-900">
              {summary.roleCounts[role]}
            </span>
            <span className="w-9 text-right text-gray-500">
              {percent(summary.roleCounts[role] / total)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Columns for TRL 1–9 on a y-scale shared by every tree. */
function TrlDistribution({
  summary,
  maxShare,
}: {
  summary: TreeSummary;
  maxShare: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const rated = summary.nodeCount - summary.unratedCount;
  const shares = summary.trlHistogram.map((count) =>
    rated ? count / rated : 0,
  );
  const peak = shares.indexOf(Math.max(...shares));

  if (!rated) {
    return <span className="text-sm text-gray-400">No TRL ratings</span>;
  }

  return (
    <figure className="space-y-1">
      <div
        className="relative flex h-20 items-end gap-0.5 border-b border-gray-200"
        onMouseLeave={() => setActive(null)}
      >
        {shares.map((share, index) => {
          const count = summary.trlHistogram[index];
          const isActive = active === index;
          return (
            <div
              key={index}
              tabIndex={0}
              role="img"
              aria-label={`TRL ${index + 1}: ${count} node${
                count === 1 ? '' : 's'
              }, ${percent(share)} of rated`}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="relative flex h-full flex-1 items-end justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {(isActive || (active === null && index === peak)) &&
                count > 0 && (
                  <span
                    className={`pointer-events-none absolute z-10 whitespace-nowrap text-[10px] font-semibold ${
                      isActive
                        ? 'rounded bg-gray-900 px-1.5 py-0.5 text-white shadow'
                        : 'text-gray-700'
                    }`}
                    style={{
                      bottom: `calc(${(share / maxShare) * TRL_PLOT_FILL * 100}% + 2px)`,
                    }}
                  >
                    {isActive
                      ? `TRL ${index + 1} · ${count} · ${percent(share)}`
                      : percent(share)}
                  </span>
                )}
              <span
                className="w-full max-w-6 rounded-t"
                style={{
                  height: count
                    ? `${Math.max((share / maxShare) * TRL_PLOT_FILL * 100, 2)}%`
                    : 0,
                  background: TRL_BAR_COLOR,
                  opacity: active === null || isActive ? 1 : 0.55,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 text-[10px] text-gray-500" aria-hidden>
        {shares.map((_, index) => (
          <span key={index} className="flex-1 text-center">
            {index + 1}
          </span>
        ))}
      </div>
      <figcaption className="text-[11px] text-gray-500">
        TRL · {rated} rated
        {summary.unratedCount ? `, ${summary.unratedCount} unrated` : ''}
      </figcaption>
      <table className="sr-only">
        <caption>Nodes per TRL</caption>
        <tbody>
          {summary.trlHistogram.map((count, index) => (
            <tr key={index}>
              <th scope="row">TRL {index + 1}</th>
              <td>{count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A tree's aggregate graph, laid out like the main view but static. */
function AggregatedPreview({
  tree,
  mode,
}: {
  tree: TechTree;
  mode: ComparisonMode;
}) {
  const [layout, setLayout] = useState<{
    nodes: UiNode[];
    edges: Edge[];
    key: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    layoutProjection(projectTree(tree, { mode })).then((result) => {
      if (cancelled) return;
      setLayout({
        nodes: result.layoutedNodes,
        edges: result.layoutedEdges,
        key: `${mode}:${result.layoutedNodes.length}`,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [tree, mode]);

  if (!layout) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Laying out…
      </div>
    );
  }

  return (
    // A fresh provider per layout: this sits inside the main tree's provider
    // and must not share its viewport; remounting also refits the view.
    <ReactFlowProvider key={layout.key}>
      <ReactFlow
        nodes={layout.nodes}
        edges={layout.edges}
        nodeTypes={TECH_TREE_NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.05}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        // Let the dialog scroll; zoom with pinch or the controls.
        zoomOnScroll={false}
        preventScrolling={false}
        colorMode="light"
      >
        <Background bgColor="white" variant={BackgroundVariant.Dots} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </ReactFlowProvider>
  );
}
