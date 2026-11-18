'use client';

import React, { MutableRefObject, useEffect, useMemo, useState } from 'react';
import { Edge, ReactFlow, ReactFlowProps } from '@xyflow/react';
import { UiNode } from '@/lib/types';
import { Bounds } from '@/lib/canvasZoom';
import {
  LAYOUT_TRANSITION_MS,
  LayoutTransitionPlan,
  easeInOutCubic,
  interpolateTransition,
  rectsAt,
} from '@/lib/layoutTransition';

export interface FlowTransition {
  /** New id = new animation; the same plan object is never replayed. */
  id: number;
  plan: LayoutTransitionPlan;
}

interface AnimatedReactFlowProps extends ReactFlowProps<UiNode, Edge> {
  nodes: UiNode[];
  edges: Edge[];
  /** Morph from the previous layout into `nodes`; null draws them as is. */
  transition: FlowTransition | null;
  /**
   * Boxes of the animated nodes on screen right now, or null when idle, so
   * a relayout that interrupts an animation starts from where things are.
   */
  liveRectsRef?: MutableRefObject<Map<string, Bounds> | null>;
  durationMs?: number;
}

/**
 * React Flow plus layout morphing. Only this component re-renders on each
 * animation frame; its children are elements created by the parent, so
 * React reuses them untouched.
 */
export function AnimatedReactFlow({
  nodes,
  edges,
  transition,
  liveRectsRef,
  durationMs = LAYOUT_TRANSITION_MS,
  ...flowProps
}: AnimatedReactFlowProps) {
  const [frame, setFrame] = useState<{ id: number; t: number } | null>(null);
  // A transition that has not ticked yet is drawn at its start, in the same
  // commit as the new nodes, so the final layout never flashes first.
  const t = transition ? (frame?.id === transition.id ? frame.t : 0) : 1;
  const animating = transition !== null && t < 1;

  useEffect(() => {
    if (!transition) {
      if (liveRectsRef) liveRectsRef.current = null;
      return;
    }
    if (liveRectsRef) liveRectsRef.current = rectsAt(transition.plan, 0);
    const start = performance.now();
    let handle = 0;
    const tick = (now: number) => {
      const linear = Math.min(1, (now - start) / durationMs);
      const eased = easeInOutCubic(linear);
      if (liveRectsRef) {
        liveRectsRef.current = linear < 1 ? rectsAt(transition.plan, eased) : null;
      }
      setFrame({ id: transition.id, t: eased });
      if (linear < 1) handle = requestAnimationFrame(tick);
    };
    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [transition, durationMs, liveRectsRef]);

  const drawn = useMemo(
    () =>
      animating && transition
        ? interpolateTransition(transition.plan, t, nodes, edges)
        : { nodes, edges },
    [animating, transition, t, nodes, edges],
  );

  return (
    <ReactFlow<UiNode, Edge>
      {...flowProps}
      nodes={drawn.nodes}
      edges={drawn.edges}
      data-transition={animating ? 'running' : undefined}
    />
  );
}
