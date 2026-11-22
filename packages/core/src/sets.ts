import { COLOURS, isNumber } from './tiles.ts';
import type { NumberTile, Tile } from './tiles.ts';

export type SetVerdict =
  | { readonly valid: true; readonly kind: 'run' | 'group'; readonly points: number }
  | { readonly valid: false; readonly reason: 'too-short' | 'not-a-set' };

/**
 * A set on the table is judged as a collection, not a sequence: which tiles are in it, not
 * the order they were dropped in. Order is the screen's business — it can lay a run out
 * ascending — and judging order would make a legal table illegal because a tile landed on the
 * wrong end of its row.
 *
 * Where a joker could stand for more than one tile (the joker in 5-6-joker is a 4 or a 7) the
 * set counts its highest reading, which is the one a player meaning to meet 30 would choose.
 */
export function judgeSet(tiles: readonly Tile[]): SetVerdict {
  if (tiles.length < 3) return { valid: false, reason: 'too-short' };
  const numbers = tiles.filter(isNumber);
  const jokers = tiles.length - numbers.length;
  const run = runPoints(numbers, jokers);
  const group = groupPoints(numbers, jokers);
  if (run !== null && (group === null || run >= group)) {
    return { valid: true, kind: 'run', points: run };
  }
  if (group !== null) return { valid: true, kind: 'group', points: group };
  return { valid: false, reason: 'not-a-set' };
}

/** Three or more consecutive numbers of one colour; 13 does not wrap to 1. */
function runPoints(numbers: readonly NumberTile[], jokers: number): number | null {
  const first = numbers[0];
  if (first === undefined) return null;
  if (numbers.some((tile) => tile.colour !== first.colour)) return null;
  const values = numbers.map((tile) => tile.value);
  if (new Set(values).size !== values.length) return null;
  const length = numbers.length + jokers;
  if (length > 13) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const gaps = max - min + 1 - numbers.length;
  if (gaps > jokers) return null;
  // Jokers left over after filling the gaps extend the run, upwards first for the points.
  // length <= 13 guarantees what does not fit above fits below.
  const spare = jokers - gaps;
  const up = Math.min(spare, 13 - max);
  const low = min - (spare - up);
  const high = max + up;
  return ((low + high) * (high - low + 1)) / 2;
}

/** Three or four of one number, every colour different. */
function groupPoints(numbers: readonly NumberTile[], jokers: number): number | null {
  const first = numbers[0];
  if (first === undefined) return null;
  if (numbers.some((tile) => tile.value !== first.value)) return null;
  if (new Set(numbers.map((tile) => tile.colour)).size !== numbers.length) return null;
  const length = numbers.length + jokers;
  if (length > 4) return null;
  return first.value * length;
}

/**
 * A set in the order it is read: a valid run low to high with each joker where the number it
 * stands for would be, and a valid group by colour with its jokers last. Spare jokers at the
 * ends go upward first, the reading `judgeSet` scores, so the screen never shows a joker as a
 * number it was not counted as. A set that is not valid yet keeps its drop order: while the
 * board is being reworked, tiles should stay where the player put them.
 */
export function arrangeSet(tiles: readonly Tile[]): readonly Tile[] {
  const verdict = judgeSet(tiles);
  if (!verdict.valid) return tiles;
  const numbers = tiles.filter(isNumber);
  const jokers = tiles.filter((tile) => tile.kind === 'joker');
  if (verdict.kind === 'group') {
    const byColour = [...numbers].sort(
      (a, b) => COLOURS.indexOf(a.colour) - COLOURS.indexOf(b.colour),
    );
    return [...byColour, ...jokers];
  }
  const byValue = new Map(numbers.map((tile) => [tile.value, tile]));
  const values = numbers.map((tile) => tile.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spare = jokers.length - (max - min + 1 - numbers.length);
  const up = Math.min(spare, 13 - max);
  const out: Tile[] = [];
  let joker = 0;
  for (let value = min - (spare - up); value <= max + up; value++) {
    const tile = byValue.get(value) ?? jokers[joker++];
    if (tile !== undefined) out.push(tile);
  }
  return out;
}

/** A run split in two for a tile, as the two sets it becomes and where it was cut. */
export type Split = {
  /** How many tiles of the run, in `arrangeSet` order, stay in the left half. */
  readonly at: number;
  readonly left: readonly Tile[];
  readonly right: readonly Tile[];
};

/**
 * Where a valid run can be cut so that `tile` fits on the end of one half and both halves are
 * sets: a red 5 into red 3-4-5-6-7 makes 3-4-5 and 5-6-7. Null when the tile extends the run
 * whole (that is not a split), when the set is not a valid run, or when no cut leaves two
 * valid sets.
 *
 * The tile always ends the left half. Starting the right half instead never finds a cut this
 * misses: a tile that could start `right` duplicates the last of `left`, so the cut one tile
 * further left, with the tile ending that half, leaves the same two sets read the other way.
 */
export function splitFor(run: readonly Tile[], tile: Tile): Split | null {
  const verdict = judgeSet(run);
  if (!verdict.valid || verdict.kind !== 'run') return null;
  if (judgeSet([...run, tile]).valid) return null;
  const order = arrangeSet(run);
  for (let at = 1; at < order.length; at++) {
    const left = [...order.slice(0, at), tile];
    const right = order.slice(at);
    if (judgeSet(left).valid && judgeSet(right).valid) return { at, left, right };
  }
  return null;
}
