import { useEffect, useState } from 'react';

import type { Frame } from './replay.ts';

// How long each frame stays up, by what it shows. 500 ms a tile is the middle of the 400–600
// ms the ticket started from: slow enough to see where each tile lands, quick enough that a
// bot laying down a dozen tiles takes about six seconds. The end of a turn and a pass hold
// longer, because nothing moves in them and the caption is the thing to read. The end of a
// play holds longest: its caption is the whole turn's result (KUB-51), a sentence to
// read rather than a word to glance at, and a one-tile play would otherwise show it for 1.3 s. A draw is the flight
// (`drawing`, which FLIGHT_MS fills) and a moment with the tile landed (`drew`).
export const FLIGHT_MS = 600;
const HOLD: Record<Frame['step']['kind'], number> = {
  placed: 500,
  drawing: FLIGHT_MS,
  drew: 400,
  passed: 900,
  done: 1800,
};

export type Playback = {
  /** The frame on screen, or null once the playback has run out or been skipped. */
  readonly frame: Frame | null;
  /** The place of `frame` in the list, so two frames that look alike are told apart. */
  readonly index: number;
  readonly skip: () => void;
};

/**
 * Steps through a list of frames, one at a time. A new list (a new reference) starts over
 * from its first frame; the same list keeps its place, so the session changing for any other
 * reason does not restart a playback.
 */
export function usePlayback(frames: readonly Frame[]): Playback {
  const [at, setAt] = useState({ frames, index: 0 });
  // The derived-state pattern rather than an effect: a new list must never paint one frame of
  // the table it replaced.
  const current = at.frames === frames ? at : { frames, index: 0 };
  if (current !== at) setAt(current);
  const frame = frames[current.index] ?? null;

  useEffect(() => {
    if (frame === null) return;
    const timer = setTimeout(() => {
      setAt((was) => (was.frames === frames ? { frames, index: was.index + 1 } : was));
    }, HOLD[frame.step.kind]);
    return () => clearTimeout(timer);
  }, [frame, frames]);

  return { frame, index: current.index, skip: () => setAt({ frames, index: frames.length }) };
}
