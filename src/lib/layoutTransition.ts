import type { CSSProperties } from 'react';
import { Edge } from '@xyflow/react';
import { UiNode } from '@/lib/types';
import { Bounds, boundsOf } from '@/lib/canvasZoom';
import {
  AggregateSummary,
  GroupFrame,
  TreeProjection,
  aggregateNodeId,
  groupFrameId,
} from '@/lib/treeProjection';

/*
 * Animated relayouts. Between two layouts of the same tree every node glides
 * from where it is to where it will be, and edges follow because React Flow
 * draws them from node positions.
 *
 * - Nodes in both layouts move between their boxes.
 * - Nodes that appear grow out of whatever drew them before: unfolded
 *   prerequisites slide out of their node, members out of their aggregate,
 *   and a frame grows from the aggregate it replaces.
 * - Nodes that disappear glide into whatever draws them now and fade out.
 */

/** Long enough to follow a node, short enough not to wait for it. */
export const LAYOUT_TRANSITION_MS = 450;
/** Above this many animated nodes a relayout jumps instead (very large trees). */
export const MAX_ANIMATED_NODES = 500;

export type TrackRole = 'persist' | 'enter' | 'exit';

export interface NodeTrack {
  role: TrackRole;
  from: Bounds;
  to: Bounds;
  /** Frames change size as they unfold; other nodes keep theirs. */
  resize: boolean;
}

export interface LayoutTransitionPlan {
  tracks: Map<string, NodeTrack>;
  /** Nodes that leave, drawn (fading) until the animation ends. */
  exitingNodes: UiNode[];
  /** Edges that leave, likewise. */
  exitingEdges: Edge[];
  /** Edges that are new in the next layout; they fade in. */
  enteringEdgeIds: Set<string>;
}

/** One side of a transition: what is (or will be) drawn, and why. */
export interface LayoutSnapshot {
  nodes: UiNode[];
  edges: Edge[];
  /** Absolute box of every node in `nodes`. */
  rects: Map<string, Bounds>;
  projection: TreeProjection;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function lerpBounds(from: Bounds, to: Bounds, t: number): Bounds {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  };
}

/** A box of `size` sharing `target`'s centre. */
function centredOn(target: Bounds, size: Bounds): Bounds {
  return {
    x: target.x + target.width / 2 - size.width / 2,
    y: target.y + target.height / 2 - size.height / 2,
    width: size.width,
    height: size.height,
  };
}

function aggregateOf(node: UiNode): AggregateSummary | null {
  return node.type === 'aggregate'
    ? ((node.data as { aggregate?: AggregateSummary }).aggregate ?? null)
    : null;
}

function frameOf(node: UiNode): GroupFrame | null {
  return node.type === 'groupFrame'
    ? ((node.data as { frame?: GroupFrame }).frame ?? null)
    : null;
}

/** Data nodes a drawn node stands for on its own side. */
function membersOf(node: UiNode, side: LayoutSnapshot): string[] {
  const aggregate = aggregateOf(node);
  if (aggregate) return aggregate.memberIds;
  const frame = frameOf(node);
  if (frame) {
    const members: string[] = [];
    for (const [id, key] of side.projection.groupKeyOf) {
      if (key === frame.key) members.push(id);
    }
    return members;
  }
  return [node.id];
}

/** Where `members` are drawn on `side`: the box around their representatives. */
function membersBox(members: string[], side: LayoutSnapshot): Bounds | null {
  const boxes: Bounds[] = [];
  const seen = new Set<string>();
  for (const member of members) {
    const drawnAs = side.projection.representative.get(member);
    if (!drawnAs || seen.has(drawnAs)) continue;
    seen.add(drawnAs);
    const rect = side.rects.get(drawnAs);
    if (rect) boxes.push(rect);
  }
  return boundsOf(boxes);
}

/**
 * The box a node that exists on only one side morphs from (entering) or into
 * (exiting), found on the `other` side; null means it fades in place.
 */
function counterpart(
  node: UiNode,
  own: Bounds,
  side: LayoutSnapshot,
  other: LayoutSnapshot,
): { rect: Bounds; resize: boolean } | null {
  const frame = frameOf(node);
  if (frame) {
    const aggregate = other.rects.get(aggregateNodeId(frame.key));
    if (aggregate) return { rect: aggregate, resize: true };
    const box = membersBox(membersOf(node, side), other);
    return box ? { rect: box, resize: true } : null;
  }
  const aggregate = aggregateOf(node);
  if (aggregate) {
    const frameRect = other.rects.get(groupFrameId(aggregate.key));
    // Cross-fades with the frame that takes its place.
    if (frameRect) return { rect: own, resize: false };
  }
  const drawnAs =
    aggregate === null
      ? other.projection.representative.get(node.id)
      : undefined;
  if (drawnAs && drawnAs !== node.id) {
    const rect = other.rects.get(drawnAs);
    if (rect) return { rect: centredOn(rect, own), resize: false };
  }
  const box = membersBox(membersOf(node, side), other);
  return box ? { rect: centredOn(box, own), resize: false } : null;
}

/** Plans how `previous` morphs into `next`; see the module notes. */
export function planLayoutTransition(
  previous: LayoutSnapshot,
  next: LayoutSnapshot,
): LayoutTransitionPlan {
  const tracks = new Map<string, NodeTrack>();
  const nextIds = new Set(next.nodes.map((node) => node.id));

  for (const node of next.nodes) {
    const to = next.rects.get(node.id);
    if (!to) continue;
    const from = previous.rects.get(node.id);
    if (from) {
      tracks.set(node.id, {
        role: 'persist',
        from,
        to,
        resize: from.width !== to.width || from.height !== to.height,
      });
      continue;
    }
    const origin = counterpart(node, to, next, previous);
    tracks.set(node.id, {
      role: 'enter',
      from: origin?.rect ?? to,
      to,
      resize: origin?.resize ?? false,
    });
  }

  const exitingNodes: UiNode[] = [];
  for (const node of previous.nodes) {
    if (nextIds.has(node.id)) continue;
    const from = previous.rects.get(node.id);
    if (!from) continue;
    const target = counterpart(node, from, previous, next);
    tracks.set(node.id, {
      role: 'exit',
      from,
      to: target?.rect ?? from,
      resize: target?.resize ?? false,
    });
    exitingNodes.push(node);
  }

  const previousEdgeIds = new Set(previous.edges.map((edge) => edge.id));
  const nextEdgeIds = new Set(next.edges.map((edge) => edge.id));
  return {
    tracks,
    exitingNodes,
    exitingEdges: previous.edges.filter(
      (edge) =>
        !nextEdgeIds.has(edge.id) &&
        tracks.has(edge.source) &&
        tracks.has(edge.target),
    ),
    enteringEdgeIds: new Set(
      next.edges
        .map((edge) => edge.id)
        .filter((id) => !previousEdgeIds.has(id)),
    ),
  };
}

function opacityOf(style: CSSProperties | undefined): number {
  const value = Number(style?.opacity ?? 1);
  return Number.isFinite(value) ? value : 1;
}

function trackOpacity(role: TrackRole, t: number): number {
  if (role === 'enter') return t;
  if (role === 'exit') return 1 - t;
  return 1;
}

/** Box of every tracked node at eased progress `t`. */
export function rectsAt(
  plan: LayoutTransitionPlan,
  t: number,
): Map<string, Bounds> {
  const rects = new Map<string, Bounds>();
  for (const [id, track] of plan.tracks) {
    if (track.role !== 'exit') rects.set(id, lerpBounds(track.from, track.to, t));
  }
  return rects;
}

function nodeAt(node: UiNode, track: NodeTrack, t: number): UiNode {
  const rect = lerpBounds(track.from, track.to, t);
  const own = track.resize
    ? rect
    : { ...rect, width: track.to.width, height: track.to.height };
  const style = node.style as CSSProperties | undefined;
  const isFrame = node.type === 'groupFrame';
  const opacity = opacityOf(style) * trackOpacity(track.role, t);
  return {
    ...node,
    parentId: undefined,
    extent: undefined,
    position: { x: own.x, y: own.y },
    ...(track.resize || isFrame ? { width: own.width, height: own.height } : {}),
    style: {
      ...style,
      ...(track.resize || isFrame ? { width: own.width, height: own.height } : {}),
      opacity,
      transition: 'none',
      ...(track.role === 'exit' ? { pointerEvents: 'none' } : {}),
    } as CSSProperties,
  };
}

function edgeAt(edge: Edge, opacity: number): Edge {
  const style = edge.style as CSSProperties | undefined;
  const base = opacityOf(style);
  return {
    ...edge,
    style: { ...style, opacity: base * opacity, transition: 'none' },
    ...(edge.label
      ? {
          labelStyle: { ...edge.labelStyle, opacity },
          labelBgStyle: {
            ...edge.labelBgStyle,
            fillOpacity: Number(edge.labelBgStyle?.fillOpacity ?? 1) * opacity,
          },
        }
      : {}),
  };
}

/**
 * The graph to draw at eased progress `t` (0 = previous layout, 1 = next).
 * Tracked nodes are drawn flat at absolute positions, frames first so they
 * stay underneath; untracked nodes (overlays) pass through unchanged.
 */
export function interpolateTransition(
  plan: LayoutTransitionPlan,
  t: number,
  nodes: UiNode[],
  edges: Edge[],
): { nodes: UiNode[]; edges: Edge[] } {
  const frames: UiNode[] = [];
  const others: UiNode[] = [];
  const place = (node: UiNode) => {
    const track = plan.tracks.get(node.id);
    const drawn = track ? nodeAt(node, track, t) : node;
    (node.type === 'groupFrame' ? frames : others).push(drawn);
  };
  plan.exitingNodes
    .filter((node) => node.type === 'groupFrame')
    .forEach(place);
  nodes.forEach(place);
  plan.exitingNodes
    .filter((node) => node.type !== 'groupFrame')
    .forEach(place);

  return {
    nodes: [...frames, ...others],
    edges: [
      ...edges.map((edge) =>
        plan.enteringEdgeIds.has(edge.id) ? edgeAt(edge, t) : edge,
      ),
      ...plan.exitingEdges.map((edge) => edgeAt(edge, 1 - t)),
    ],
  };
}
