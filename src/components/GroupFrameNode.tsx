'use client';

import React from 'react';
import { NodeProps } from '@xyflow/react';
import { Minimize2 } from 'lucide-react';
import { GroupFrameNodeData } from '@/lib/elkjs';
import { useTechTreeNodeActions } from './techTreeNodeActions';

/**
 * An unfolded group: a labelled frame around its members, with a control to
 * fold it back into one aggregate node.
 */
export function GroupFrameNode({ id, data }: NodeProps) {
  const { frame } = data as GroupFrameNodeData;
  const actions = useTechTreeNodeActions();
  const shown = frame.visibleIds.length;
  const name = frame.subtitle ? `${frame.title} · ${frame.subtitle}` : frame.title;

  return (
    <div
      className="h-full w-full rounded-2xl border-2 border-dashed"
      style={{
        borderColor: 'color-mix(in srgb, var(--tt-role) 45%, transparent)',
        background: 'color-mix(in srgb, var(--tt-role) 5%, transparent)',
      }}
    >
      <div className="flex h-12 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: 'var(--tt-role)' }}
            aria-hidden
          />
          <span className="truncate text-sm font-semibold text-gray-800">
            {name}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-gray-500">
            {shown === frame.memberCount
              ? `${shown} node${shown === 1 ? '' : 's'}`
              : `${shown} of ${frame.memberCount} shown`}
          </span>
        </div>
        {actions && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              actions.onCollapseGroup(frame.key, id);
            }}
            className="nodrag inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label={`Fold ${name} into one node`}
          >
            <Minimize2 className="h-3.5 w-3.5" aria-hidden />
            Fold
          </button>
        )}
      </div>
    </div>
  );
}
