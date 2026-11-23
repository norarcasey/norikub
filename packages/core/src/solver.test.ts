import { describe, expect, it } from 'vitest';

import { ts } from './fixtures.test-helpers.ts';
import { judgeSet } from './sets.ts';
import { solveTable } from './solver.ts';
import type { Worth } from './solver.ts';
import type { Tile } from './tiles.ts';

const tiles: Worth = () => 1;
const points: Worth = (tile) => tile.value;

function ids(sets: readonly (readonly Tile[])[] | null): string[][] {
  return (sets ?? []).map((set) => set.map((tile) => tile.id).sort()).sort();
}

function allValid(sets: readonly (readonly Tile[])[] | null): boolean {
  return sets !== null && sets.every((set) => judgeSet(set).valid);
}

describe('the best table', () => {
  it('keeps a table it cannot add to as it is', () => {
    const table = ts('red-4-a', 'red-5-a', 'red-6-a');
    const sets = solveTable(table, ts('blue-9-a'), tiles);
    expect(ids(sets)).toEqual([['red-4-a', 'red-5-a', 'red-6-a']]);
  });

  it('splits a run to fit a tile in the middle', () => {
    const table = ts('red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a');
    const sets = solveTable(table, ts('red-5-b'), tiles);
    expect(allValid(sets)).toBe(true);
    expect(sets?.flat()).toHaveLength(6);
  });

  it('takes a joker back by replacing it, and plays it again', () => {
    const table = ts('red-4-a', 'joker-a', 'red-6-a');
    const sets = solveTable(table, ts('red-5-a', 'blue-9-a', 'black-9-a'), tiles);
    expect(ids(sets)).toEqual([
      ['black-9-a', 'blue-9-a', 'joker-a'],
      ['red-4-a', 'red-5-a', 'red-6-a'],
    ]);
  });

  it('breaks two groups into runs to use the rack', () => {
    // 4s and 5s in three colours: only runs take the 6s, and with the black 6 missing the
    // black 4-5 would be left short, so the red and blue 6s alone go nowhere.
    const table = ts('red-4-a', 'blue-4-a', 'black-4-a', 'red-5-a', 'blue-5-a', 'black-5-a');
    expect(solveTable(table, ts('red-6-a', 'blue-6-a'), tiles)?.flat()).toHaveLength(6);
    const sets = solveTable(table, ts('red-6-a', 'blue-6-a', 'black-6-a'), tiles);
    expect(allValid(sets)).toBe(true);
    expect(sets?.flat()).toHaveLength(9);
  });

  it('makes two groups of one number when a colour has both copies', () => {
    const rack = ts('red-8-a', 'red-8-b', 'blue-8-a', 'blue-8-b', 'black-8-a', 'orange-8-a');
    const sets = solveTable([], rack, tiles);
    expect(allValid(sets)).toBe(true);
    expect(sets).toHaveLength(2);
  });

  it('lays two runs of one colour through the same numbers', () => {
    const rack = ts('red-5-a', 'red-5-b', 'red-6-a', 'red-6-b', 'red-7-a', 'red-7-b');
    expect(ids(solveTable([], rack, tiles))).toEqual([
      ['red-5-a', 'red-6-a', 'red-7-a'],
      ['red-5-b', 'red-6-b', 'red-7-b'],
    ]);
  });

  it('weighs what is laid down by the worth it is given', () => {
    // One joker, two uses: three 13s (39 points) or 1-2-joker-4-5 (five tiles).
    const rack = ts('red-1-a', 'red-2-a', 'red-4-a', 'red-5-a', 'joker-a', 'red-13-a', 'blue-13-a');
    expect(ids(solveTable([], rack, points))).toEqual([['blue-13-a', 'joker-a', 'red-13-a']]);
    expect(ids(solveTable([], rack, tiles))).toEqual([
      ['joker-a', 'red-1-a', 'red-2-a', 'red-4-a', 'red-5-a'],
    ]);
  });

  it('keeps the table joker in a set and lays the rack joker beside it', () => {
    const table = ts('red-10-a', 'red-11-a', 'joker-a');
    expect(ids(solveTable(table, ts('joker-b', 'blue-2-a'), tiles))).toEqual([
      ['joker-a', 'joker-b', 'red-10-a', 'red-11-a'],
    ]);
  });

  it('reads nothing into a table that is not sets', () => {
    expect(solveTable(ts('red-1-a', 'blue-5-a', 'black-9-a'), [], tiles)).toBeNull();
  });

  it('finds nothing to lay down in a rack of strays', () => {
    expect(solveTable([], ts('red-1-a', 'blue-5-a', 'black-9-a'), tiles)).toEqual([]);
  });
});
