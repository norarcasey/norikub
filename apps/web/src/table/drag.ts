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

/** A tile in flight: where the pointer is, where it grabbed the tile, and what is under it. */
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

type Handlers = {
  readonly onDrop: (tileId: string, target: DropTarget) => void;
};

/**
 * Dragging with plain pointer events, one hook for mouse, trackpad and touch. KUB-2, the spike
 * that measures dragging on the real phone and Mac, had not run when this was written (21 Nov
 * 2026); whatever it picks replaces this file and nothing else, because the screen only sees
 * `drag` and the `onDrop` it is called back with.
 *
 * The pointer is captured on the tile pressed, so the drag keeps its events when the finger
 * leaves the tile, and the page does not scroll under it (`touch-action: none` on the tile).
 */
export function useDrag({ onDrop }: Handlers) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const pressed = useRef<{ tileId: string; pointerId: number; x: number; y: number } | null>(null);
  // The drag as the handlers last saw it; `drag` is the same, as of the last render.
  const inFlight = useRef<Drag | null>(null);
  // A drag that ends over its own tile would also fire a click; this swallows that one click.
  const dragged = useRef(false);

  const onPointerDown = useCallback((tileId: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    dragged.current = false;
    pressed.current = { tileId, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    const element = event.currentTarget;
    if (typeof element.setPointerCapture === 'function') {
      element.setPointerCapture(event.pointerId);
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const press = pressed.current;
    if (press === null || press.pointerId !== event.pointerId) return;
    const { clientX: x, clientY: y } = event;
    const current = inFlight.current;
    if (current === null && Math.hypot(x - press.x, y - press.y) < DRAG_THRESHOLD) return;
    let next: Drag;
    if (current === null) {
      const rect = event.currentTarget.getBoundingClientRect();
      next = {
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
    } else {
      next = { ...current, x, y, target: targetAt(x, y) };
    }
    inFlight.current = next;
    setDrag(next);
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const press = pressed.current;
      if (press === null || press.pointerId !== event.pointerId) return;
      const current = inFlight.current;
      pressed.current = null;
      inFlight.current = null;
      setDrag(null);
      if (current === null) return;
      dragged.current = true;
      const target = targetAt(event.clientX, event.clientY);
      if (target !== null) onDrop(current.tileId, target);
    },
    [onDrop],
  );

  const onPointerCancel = useCallback(() => {
    pressed.current = null;
    inFlight.current = null;
    setDrag(null);
  }, []);

  /** True once for the click that follows a drag, which is not a tap. */
  const swallowClick = useCallback(() => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  }, []);

  return { drag, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, swallowClick };
}
