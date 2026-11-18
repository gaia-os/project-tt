'use client';

import { useEffect } from 'react';

/** Share of the outstanding wheel delta applied per animation frame. */
const SMOOTHING = 0.3;
/**
 * Deltas at least this large come from a notched mouse wheel; trackpads and
 * pinches send a stream of small ones that are smooth already.
 */
const NOTCH_DELTA = 40;
/** Pixels per line for line-mode wheels (Firefox); React Flow's own rate. */
const LINE_HEIGHT = 25;

function pixelDeltaY(event: WheelEvent, pageHeight: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return event.deltaY * LINE_HEIGHT;
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return event.deltaY * pageHeight;
  }
  return event.deltaY;
}

function canScroll(element: Element, deltaX: number, deltaY: number) {
  const style = getComputedStyle(element);
  const scrollsY =
    /(auto|scroll|overlay)/.test(style.overflowY) &&
    element.scrollHeight > element.clientHeight + 1;
  if (scrollsY && deltaY !== 0) {
    const atTop = element.scrollTop <= 0;
    const atBottom =
      element.scrollTop + element.clientHeight >= element.scrollHeight - 1;
    if (deltaY < 0 ? !atTop : !atBottom) return true;
  }
  const scrollsX =
    /(auto|scroll|overlay)/.test(style.overflowX) &&
    element.scrollWidth > element.clientWidth + 1;
  if (scrollsX && deltaX !== 0) {
    const atStart = element.scrollLeft <= 0;
    const atEnd =
      element.scrollLeft + element.clientWidth >= element.scrollWidth - 1;
    if (deltaX < 0 ? !atStart : !atEnd) return true;
  }
  return false;
}

/** True when something between `target` and `boundary` should take the wheel. */
function wheelBelongsToContent(
  target: Element | null,
  boundary: Element,
  deltaX: number,
  deltaY: number,
): boolean {
  for (let el = target; el && el !== boundary; el = el.parentElement) {
    if (el.classList.contains('nowheel')) return true;
    if (canScroll(el, deltaX, deltaY)) return true;
  }
  return false;
}

/**
 * Makes wheel zoom on the tech tree continuous everywhere on the canvas.
 *
 * - Panels floating over the canvas (tree picker, legend, filters, zoom
 *   buttons, pathway guide) used to swallow the wheel, so zooming stalled
 *   whenever the pointer crossed one near the edge. Their wheel events are
 *   now handed to the graph unless the panel itself can scroll.
 * - A notched mouse wheel moves React Flow in ~15% jumps; those notches are
 *   spread over a few frames so zooming glides instead of stepping.
 *
 * Forwarded events are synthetic wheel events on the React Flow pane, so
 * React Flow keeps doing the actual zooming (limits, cursor anchoring).
 */
export function useCanvasWheel(container: HTMLElement | null) {
  useEffect(() => {
    if (!container) return;

    let pending = 0;
    let clientX = 0;
    let clientY = 0;
    let frame = 0;

    const dispatch = (deltaY: number, ctrlKey: boolean) => {
      const pane = container.querySelector('.react-flow__pane');
      pane?.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY,
          deltaMode: WheelEvent.DOM_DELTA_PIXEL,
          clientX,
          clientY,
          ctrlKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    const step = () => {
      frame = 0;
      const delta = Math.abs(pending) <= 1 ? pending : pending * SMOOTHING;
      pending -= delta;
      dispatch(delta, false);
      if (pending !== 0) frame = requestAnimationFrame(step);
    };

    const onWheel = (event: WheelEvent) => {
      // Our own forwarded events: let React Flow handle them.
      if (!event.isTrusted) return;
      const target = event.target instanceof Element ? event.target : null;
      const overGraph = !!target?.closest('.react-flow__renderer');
      if (
        overGraph
          ? !!target?.closest('.nowheel')
          : wheelBelongsToContent(target, container, event.deltaX, event.deltaY)
      ) {
        return;
      }

      const deltaY = pixelDeltaY(event, container.clientHeight);
      const notched =
        !event.ctrlKey &&
        (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
          Math.abs(deltaY) >= NOTCH_DELTA);
      // Trackpad scrolls and pinches over the graph are already continuous.
      if (overGraph && !notched) return;

      // Also stops page zoom (ctrl+wheel) and history swipes over panels.
      event.preventDefault();
      event.stopPropagation();
      clientX = event.clientX;
      clientY = event.clientY;

      if (!notched) {
        if (deltaY !== 0) dispatch(deltaY, event.ctrlKey);
        return;
      }
      // Reversing direction drops the rest of the previous glide.
      if (Math.sign(deltaY) !== Math.sign(pending)) pending = 0;
      pending += deltaY;
      if (!frame) frame = requestAnimationFrame(step);
    };

    container.addEventListener('wheel', onWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      container.removeEventListener('wheel', onWheel, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [container]);
}
