'use client';

import { useEffect, useRef } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { AggregateNodeData } from '@/lib/elkjs';
import { UiNode } from '@/lib/types';

interface BoxSelectionProps {
  enabled: boolean;
  /** Drawn nodes under the box while dragging (empty when it ends). */
  onPreview: (drawnIds: ReadonlySet<string>) => void;
  /** Data nodes under the box when it is released. */
  onCommit: (nodeIds: string[]) => void;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Turns React Flow's Shift+drag selection box into a pick for the tree
 * builder. React Flow only reports the box itself (the tree's nodes are
 * controlled and never marked selected), so the nodes under it are looked
 * up here; aggregates count as all of their members.
 */
export function BoxSelection({ enabled, onPreview, onCommit }: BoxSelectionProps) {
  const rect = useStore((state) => state.userSelectionRect);
  const { getIntersectingNodes, getViewport } = useReactFlow<UiNode>();
  const pickedRef = useRef<{ drawn: Set<string>; data: string[] } | null>(null);

  useEffect(() => {
    if (!enabled) {
      pickedRef.current = null;
      return;
    }
    if (rect && rect.width > 2 && rect.height > 2) {
      const { x, y, zoom } = getViewport();
      const area = {
        x: (rect.x - x) / zoom,
        y: (rect.y - y) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      };
      const drawn = new Set<string>();
      const data = new Set<string>();
      for (const node of getIntersectingNodes(area, true)) {
        if (!node.type || node.type === 'default') {
          drawn.add(node.id);
          data.add(node.id);
        } else if (node.type === 'aggregate') {
          drawn.add(node.id);
          for (const id of (node.data as AggregateNodeData).aggregate.memberIds) {
            data.add(id);
          }
        }
      }
      pickedRef.current = { drawn, data: [...data] };
      onPreview(drawn);
      return;
    }
    if (!rect && pickedRef.current) {
      const { data } = pickedRef.current;
      pickedRef.current = null;
      onPreview(NONE);
      if (data.length) onCommit(data);
    }
  }, [rect, enabled, getIntersectingNodes, getViewport, onPreview, onCommit]);

  return null;
}
