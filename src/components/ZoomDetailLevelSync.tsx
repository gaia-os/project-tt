'use client';

import { useEffect } from 'react';
import { useStore } from '@xyflow/react';
import { zoomDetailLevel } from '@/lib/canvasZoom';

/**
 * Mirrors the zoom's detail level onto the React Flow root as `data-lod`, so
 * CSS can simplify nodes when zoomed out without re-rendering any of them.
 * Must be rendered inside `<ReactFlow>`.
 */
export function ZoomDetailLevelSync() {
  const level = useStore((state) => zoomDetailLevel(state.transform[2]));
  const domNode = useStore((state) => state.domNode);
  useEffect(() => {
    if (domNode) domNode.dataset.lod = level;
  }, [domNode, level]);
  return null;
}
