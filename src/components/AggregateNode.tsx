'use client';

import React from 'react';
import { Handle, NodeProps, Position } from '@xyflow/react';
import { Maximize2 } from 'lucide-react';
import { NODE_LABELS } from '@/lib/types';
import { AggregateNodeData, roleColor } from '@/lib/elkjs';
import { TrlSummary } from '@/lib/treeProjection';
import { nodeRolePluralLabel } from '@/lib/nodeRoles';
import { useTechTreeNodeActions } from './techTreeNodeActions';

export function formatTrlRange(trl: TrlSummary): string {
  if (trl.min === null || trl.max === null) return 'TRL not rated';
  return trl.min === trl.max ? `TRL ${trl.min}` : `TRL ${trl.min}–${trl.max}`;
}

/**
 * A whole group of nodes drawn as one. Inside the main tree it unfolds into
 * a frame of its members; in comparison previews it is static.
 */
export function AggregateNode({ id, data }: NodeProps) {
  const { aggregate } = data as AggregateNodeData;
  const actions = useTechTreeNodeActions();
  const count = aggregate.memberIds.length;
  const eyebrow = aggregate.subtitle
    ? aggregate.title
    : aggregate.role
      ? 'Role'
      : 'Category';
  const heading = aggregate.subtitle ?? aggregate.title;
  const unfold = actions
    ? () => actions.onExpandGroup(aggregate.key, id)
    : undefined;
  const unfoldLabel = `Unfold ${heading}${
    aggregate.subtitle ? ` in ${aggregate.title}` : ''
  } (${count} node${count === 1 ? '' : 's'})`;
  // Building a tree: the body adds or removes the whole group instead.
  const builder = actions?.builder ?? null;
  const inTree = builder ? builder.countOf(aggregate.memberIds) : 0;
  const onBodyClick = builder
    ? (event: React.MouseEvent) => {
        event.stopPropagation();
        builder.toggleGroup(aggregate.memberIds);
      }
    : unfold;

  return (
    <div
      className={`relative flex h-full w-full flex-col gap-1.5 px-3 py-2.5 text-left ${
        onBodyClick ? 'cursor-pointer' : ''
      }`}
      onClick={onBodyClick}
      onDoubleClick={(event) => event.stopPropagation()}
      title={
        builder
          ? inTree === count
            ? 'Click to remove the whole group from your tree'
            : 'Click to add the whole group to your tree'
          : unfold
            ? unfoldLabel
            : undefined
      }
    >
      {builder && (
        <span
          className={`absolute -bottom-2.5 -right-2.5 z-10 rounded-full border-2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shadow-sm ${
            inTree === count
              ? 'border-blue-600 bg-blue-600 text-white'
              : inTree > 0
                ? 'border-blue-600 bg-white text-blue-700'
                : 'border-gray-300 bg-white text-gray-500'
          }`}
        >
          {inTree} of {count} in tree
        </span>
      )}
      <Handle type="target" position={Position.Left} className="opacity-0" />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {eyebrow}
          </p>
          <p className="truncate text-[15px] font-semibold leading-tight text-gray-900">
            {heading}
          </p>
        </div>
        {unfold && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              unfold();
            }}
            className="tt-node-actions nodrag -mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={unfoldLabel}
          >
            <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </div>

      <p className="text-xs tabular-nums text-gray-600">
        <span className="font-semibold text-gray-900">{count}</span> node
        {count === 1 ? '' : 's'} · {formatTrlRange(aggregate.trl)}
      </p>

      <RoleMixBar roleCounts={aggregate.roleCounts} total={count} />

      {aggregate.sampleLabels.length > 0 && (
        <p className="truncate text-[11px] text-gray-500">
          {aggregate.sampleLabels.join(' · ')}
          {count > aggregate.sampleLabels.length ? ' …' : ''}
        </p>
      )}

      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

/** Share of each node role in a group, as one segmented bar. */
export function RoleMixBar({
  roleCounts,
  total,
  className = 'h-1.5',
}: {
  roleCounts: Record<string, number>;
  total: number;
  className?: string;
}) {
  const parts = NODE_LABELS.filter((role) => roleCounts[role] > 0);
  return (
    <div
      className={`flex w-full gap-px overflow-hidden rounded-full bg-gray-100 ${className}`}
      role="img"
      aria-label={parts
        .map((role) => `${roleCounts[role]} ${nodeRolePluralLabel(role)}`)
        .join(', ')}
    >
      {parts.map((role) => (
        <span
          key={role}
          className="h-full"
          style={{
            width: `${(roleCounts[role] / Math.max(total, 1)) * 100}%`,
            background: roleColor(role),
          }}
        />
      ))}
    </div>
  );
}
