import { arrangeSet, judgeSet } from './sets.ts';
import { isNumber } from './tiles.ts';
import type { Colour, Tile } from './tiles.ts';

/**
 * A set as a person would name it: blue 4 to 7, three 9s. Jokers are read
 * the way `judgeSet` counts them. `other` is a set that is neither, which an accepted table
 * never holds; it is here so the summary of any two tables is total.
 */
export type SetShape =
  | { readonly kind: 'run'; readonly colour: Colour; readonly low: number; readonly high: number }
  | { readonly kind: 'group'; readonly value: number; readonly size: number }
  | { readonly kind: 'other' };

/**
 * Tiles from the rack and the set they ended the turn in. `fresh` is a set made of rack tiles
 * only: laid down, rather than added to.
 */
export type Placement = {
  readonly tiles: readonly Tile[];
  readonly into: SetShape;
  readonly fresh: boolean;
};

/**
 * What a turn did to the table, as its result rather than its moves (KUB-51): a bot that
 * reworks the board makes a dozen moves whose order means nothing to the person watching.
 * `reworked` is how many of the sets the turn began with did not survive whole: split, robbed
 * of a tile or a joker, or joined to another set. A set that only had rack tiles added kept
 * its shape, so it is not counted. No placements means nothing was played.
 */
export type TurnSummary = {
  readonly placements: readonly Placement[];
  readonly reworked: number;
};

type Table = readonly (readonly Tile[])[];

/**
 * The summary of a turn from the table it began with and the table it ended with. A tile on
 * the table afterwards that was not on it before came from the mover's rack: this needs
 * neither rack, so it works from what every seat can see.
 */
export function summarizeTurn(before: Table, after: Table): TurnSummary {
  const was = new Map<string, number>();
  before.forEach((set, i) => {
    for (const tile of set) was.set(tile.id, i);
  });
  const now = new Map<string, number>();
  after.forEach((set, i) => {
    for (const tile of set) now.set(tile.id, i);
  });

  const placements = after.flatMap((set): Placement[] => {
    const fromRack = set.filter((tile) => !was.has(tile.id));
    if (fromRack.length === 0) return [];
    return [{ tiles: fromRack, into: shapeOf(set), fresh: fromRack.length === set.length }];
  });

  const reworked = before.filter((set, i) => {
    const homes = new Set(set.map((tile) => now.get(tile.id)));
    const [home, ...others] = homes;
    if (home === undefined || others.length > 0) return true;
    // Whole, in one set: kept, unless that set also holds tiles from another set of before.
    return (after[home] ?? []).some((tile) => {
      const from = was.get(tile.id);
      return from !== undefined && from !== i;
    });
  }).length;

  return { placements, reworked };
}

export function shapeOf(tiles: readonly Tile[]): SetShape {
  const verdict = judgeSet(tiles);
  if (!verdict.valid) return { kind: 'other' };
  const arranged = arrangeSet(tiles);
  const at = arranged.findIndex(isNumber);
  const first = arranged[at];
  if (first === undefined || !isNumber(first)) return { kind: 'other' };
  if (verdict.kind === 'group') return { kind: 'group', value: first.value, size: tiles.length };
  const low = first.value - at;
  return { kind: 'run', colour: first.colour, low, high: low + arranged.length - 1 };
}
