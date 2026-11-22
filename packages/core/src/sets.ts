import { isNumber } from './tiles.ts';
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
