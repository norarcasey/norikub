import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import type { Move } from '@norikub/core/turn';

/**
 * Where a tile can be let go. The screen marks each with `data-drop`, and the point under the
 * finger is read back through `elementFromPoint`, so a drop target is whatever is drawn there
 * and not a list of rectangles kept beside the layout that can drift from it.
 */
export type DropTarget =
  | { readonly kind: 'set'; readonly set: number }
  | { readonly kind: 'new-set' }
  | { readonly kind: 'rack'; readonly row: number; readonly col: number };

/** The target as `data-drop` names it: a set, the new-set zone, or one slot of the rack. */
export function dropAttribute(target: DropTarget): string {
  if (target.kind === 'set') return `set-${target.set}`;
  if (target.kind === 'rack') return `rack-${target.row}-${target.col}`;
  return target.kind;
}

export function toMove(tileId: string, target: DropTarget): Move {
  // A person's drop on a set may split a run (KUB-23); the engine decides whether it does.
  if (target.kind === 'set') return { kind: 'onto-set', tileId, set: target.set };
  if (target.kind === 'new-set') return { kind: 'to-new-set', tileId };
  return { kind: 'to-rack', tileId };
}

export function parseDropAttribute(value: string | null | undefined): DropTarget | null {
  if (value === 'new-set') return { kind: 'new-set' };
  const set = /^set-(\d+)$/.exec(value ?? '');
  if (set?.[1] !== undefined) return { kind: 'set', set: Number(set[1]) };
  const slot = /^rack-(\d+)-(\d+)$/.exec(value ?? '');
  if (slot?.[1] === undefined || slot[2] === undefined) return null;
  return { kind: 'rack', row: Number(slot[1]), col: Number(slot[2]) };
}

export function targetAt(x: number, y: number): DropTarget | null {
  const zone = document.elementFromPoint(x, y)?.closest('[data-drop]');
  return parseDropAttribute(zone?.getAttribute('data-drop'));
}

/**
 * A tile in flight: where the pointer was when this was last rendered, where it grabbed the
 * tile, and what is under it. Between renders the ghost is moved directly (`ghostRef`), so
 * `x` and `y` here are only as fresh as the last change of target.
 */
export type Drag = {
  readonly tileId: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly grabX: number;
  readonly grabY: number;
  readonly width: number;
  readonly height: number;
  readonly target: DropTarget | null;
};

// Below this a press is a tap, not a drag. A finger wobbles a few pixels on a tap; picked by
// hand, not yet measured on the phone (KUB-2).
const DRAG_THRESHOLD = 6;

// How near the edge of a scrolling area a held tile starts it scrolling, and how fast at most,
// in px per frame. The dwell keeps a tile carried up from the rack, across the table's bottom
// edge, from scrolling the table on its way past. Picked by hand, not measured (KUB-2).
const EDGE = 56;
const MAX_SPEED = 16;
const DWELL_MS = 120;

type Handlers = {
  readonly onDrop: (tileId: string, target: DropTarget) => void;
};

type Rect = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

/**
 * How far to scroll an area this frame for a pointer at `x`, `y`: up near its top edge or
 * anywhere above it, down near its bottom edge but inside it, and only over its own columns.
 * Above counts and below does not because the rack is below the table: a tile held over the
 * rack is going to the rack.
 */
export function edgeSpeed(rect: Rect, x: number, y: number): number {
  if (x < rect.left || x > rect.right) return 0;
  const edge = Math.min(EDGE, (rect.bottom - rect.top) / 3);
  if (edge <= 0) return 0;
  if (y < rect.top + edge) return -MAX_SPEED * Math.min(1, (rect.top + edge - y) / edge);
  if (y > rect.bottom - edge && y <= rect.bottom) {
    return MAX_SPEED * ((y - (rect.bottom - edge)) / edge);
  }
  return 0;
}

/**
 * Dragging with plain pointer events, one hook for mouse, trackpad and touch. KUB-2 kept them
 * rather than bring in a drag library (22 Nov 2026): the drop target is found by what is drawn
 * under the finger and the engine is asked about it, which is the part a library does not do.
 * What a library would have added, autoscroll and a ghost that moves without a render, is
 * here instead.
 *
 * The pointer is captured on the tile pressed, so the drag keeps its events when the finger
 * leaves the tile, and the page does not scroll under it (`touch-action: none` on the tile).
 * The ghost follows the pointer by its own style: the screen renders when the target under the
 * pointer changes, not on every move, which re-rendered the whole table at the pointer's rate.
 *
 * Held near the edge of an area marked `data-autoscroll`, the area scrolls, so a tile can reach
 * a set scrolled out of sight (Nora, 22 Nov 2026).
 */
export function useDrag({ onDrop }: Handlers) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const pressed = useRef<{ tileId: string; pointerId: number; x: number; y: number } | null>(null);
  // The drag as the handlers last saw it, the pointer's latest position included.
  const inFlight = useRef<Drag | null>(null);
  // A drag that ends over its own tile would also fire a click; this swallows that one click.
  const dragged = useRef(false);
  const ghost = useRef<HTMLElement | null>(null);
  const frame = useRef<number | null>(null);
  // When the pointer came to each area's edge, for the dwell.
  const dwell = useRef(new Map<Element, number>());

  const moveGhost = useCallback(() => {
    const current = inFlight.current;
    if (current !== null && ghost.current !== null) {
      ghost.current.style.transform = ghostTransform(current);
    }
  }, []);

  /** The pointer is at `x`, `y`: the ghost moves, and the screen renders if the target changed. */
  const track = useCallback(
    (x: number, y: number) => {
      const current = inFlight.current;
      if (current === null) return;
      const next: Drag = { ...current, x, y, target: targetAt(x, y) };
      inFlight.current = next;
      moveGhost();
      if (!sameDrop(current.target, next.target)) setDrag(next);
    },
    [moveGhost],
  );

  /** Runs a frame at a time while the pointer is held at an edge with room to scroll. */
  const keepScrolling = useCallback(() => {
    if (frame.current !== null || typeof requestAnimationFrame !== 'function') return;
    const step = (now: number) => {
      frame.current = null;
      const current = inFlight.current;
      if (current === null) return;
      let scrolled = false;
      for (const area of document.querySelectorAll('[data-autoscroll]')) {
        const speed = edgeSpeed(area.getBoundingClientRect(), current.x, current.y);
        const room =
          speed < 0 ? area.scrollTop : area.scrollHeight - area.clientHeight - area.scrollTop;
        if (speed === 0 || room <= 0) {
          dwell.current.delete(area);
          continue;
        }
        const since = dwell.current.get(area) ?? now;
        dwell.current.set(area, since);
        if (now - since < DWELL_MS) continue;
        area.scrollTop += speed;
        scrolled = true;
      }
      // What is under a still finger changes as the table scrolls beneath it.
      if (scrolled) track(current.x, current.y);
      if (dwell.current.size > 0) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [track]);

  const end = useCallback(() => {
    pressed.current = null;
    inFlight.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    dwell.current.clear();
    setDrag(null);
  }, []);

  const onPointerDown = useCallback((tileId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    dragged.current = false;
    pressed.current = { tileId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressed.current;
      if (press === null || press.pointerId !== event.pointerId) return;
      const { clientX: x, clientY: y } = event;
      if (inFlight.current !== null) {
        track(x, y);
      } else {
        if (Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const next: Drag = {
          tileId: press.tileId,
          pointerId: press.pointerId,
          x,
          y,
          grabX: press.x - rect.left,
          grabY: press.y - rect.top,
          width: rect.width,
          height: rect.height,
          target: targetAt(x, y),
        };
        inFlight.current = next;
        setDrag(next);
      }
      keepScrolling();
    },
    [track, keepScrolling],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressed.current;
      if (press === null || press.pointerId !== event.pointerId) return;
      const current = inFlight.current;
      end();
      if (current === null) return;
      dragged.current = true;
      const target = targetAt(event.clientX, event.clientY);
      if (target !== null) onDrop(current.tileId, target);
    },
    [onDrop, end],
  );

  /** True once for the click that follows a drag, which is not a tap. */
  const swallowClick = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  /** The ghost's ref, so a move between renders can reach it. */
  const ghostRef = useCallback(
    (element: HTMLElement | null) => {
      ghost.current = element;
      moveGhost();
    },
    [moveGhost],
  );

  return {
    drag,
    ghostRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: end,
    swallowClick,
  };
}

export function ghostTransform(drag: Drag): string {
  return `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px)`;
}

function sameDrop(a: DropTarget | null, b: DropTarget | null): boolean {
  return (a === null ? null : dropAttribute(a)) === (b === null ? null : dropAttribute(b));
}
