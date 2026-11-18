export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zoom-out limit for trees that already fit; the old fixed minimum. */
export const DEFAULT_MIN_ZOOM = 0.3;
/** Never zoom out further than this, however large the tree. */
export const MIN_ZOOM_FLOOR = 0.02;
/** At the limit the whole tree spans this share of the canvas. */
const ZOOMED_OUT_FILL = 0.5;

/**
 * How far the canvas may zoom out: until the whole tree fills half the
 * canvas, so every tree can be seen at once with room around it.
 */
export function minZoomForBounds(
  bounds: Bounds | null,
  width: number,
  height: number,
): number {
  if (
    !bounds ||
    width <= 0 ||
    height <= 0 ||
    bounds.width <= 0 ||
    bounds.height <= 0
  ) {
    return DEFAULT_MIN_ZOOM;
  }
  const fit = Math.min(width / bounds.width, height / bounds.height);
  return Math.min(
    DEFAULT_MIN_ZOOM,
    Math.max(MIN_ZOOM_FLOOR, fit * ZOOMED_OUT_FILL),
  );
}

export function boundsOf(rects: Iterable<Bounds>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : null;
}

/**
 * How much of each node to draw at a zoom level. Below `mid` the node
 * buttons are too small to hit; below `far` labels are smaller than a pixel
 * row, so nodes become coloured blocks that keep the tree's shape readable.
 */
export type ZoomDetailLevel = 'near' | 'mid' | 'far';

export function zoomDetailLevel(zoom: number): ZoomDetailLevel {
  if (zoom < 0.2) return 'far';
  if (zoom < DEFAULT_MIN_ZOOM) return 'mid';
  return 'near';
}
