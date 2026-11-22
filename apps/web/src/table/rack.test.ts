import { describe, expect, it } from 'vitest';

import { ts } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import { dealRows, placeOnRack, reconcileRows } from './rack.ts';
import type { RackRows } from './rack.ts';

const _ = null;

/** Rows written short and padded with empty slots to `cols`, to keep the cases readable. */
function grid(cols: number, ...rows: (string | null)[][]): RackRows {
  return rows.map((row) => [...row, ...Array.from({ length: cols - row.length }, () => null)]);
}

describe('the rack', () => {
  it('lays a first deal out sorted from the left of three rows of ten slots', () => {
    const rows = dealRows(ts('joker-a', 'blue-2-a', 'red-9-a', 'red-1-a', 'black-5-a'));
    expect(rows).toEqual(grid(10, ['red-1-a', 'red-9-a'], ['blue-2-a', 'black-5-a'], ['joker-a']));
  });

  it('puts a tile in any slot, so tiles line up in a column', () => {
    const rows = grid(4, ['a', 'b'], ['c'], []);
    expect(placeOnRack(rows, 'b', 2, 0)).toEqual(grid(4, ['a'], ['c'], ['b']));
    expect(placeOnRack(rows, 'a', 1, 3)).toEqual(grid(4, [_, 'b'], ['c', _, _, 'a'], []));
  });

  it('pushes the tiles in a taken slot right, as far as the next gap', () => {
    const rows = grid(5, ['a', 'b', _, 'c'], ['d'], []);
    expect(placeOnRack(rows, 'd', 0, 0)).toEqual(grid(5, ['d', 'a', 'b', 'c'], [], []));
  });

  it('adds a column to every row when a full row is pushed', () => {
    const rows = grid(2, ['a', 'b'], ['c'], []);
    expect(placeOnRack(rows, 'c', 0, 0)).toEqual(grid(3, ['c', 'a', 'b'], [], []));
  });

  it('grows to reach a slot past the last column', () => {
    expect(placeOnRack(grid(2, ['a'], [], []), 'a', 1, 3)).toEqual(grid(4, [], [_, _, _, 'a'], []));
  });

  it('puts a tile back in its own slot when it is dropped there', () => {
    const rows = grid(3, ['a', 'b'], [], []);
    expect(placeOnRack(rows, 'b', 0, 1)).toEqual(rows);
  });

  it('empties the slots of tiles that left, and puts a new one after the emptiest row', () => {
    const rows = grid(4, ['red-1-a', 'red-2-a'], [_, 'blue-1-a'], ['black-1-a', 'black-2-a']);
    const rack = ts('red-1-a', 'blue-1-a', 'black-1-a', 'black-2-a', 'joker-a');
    // Rows 1 and 2 hold one tile each once red 2 has gone; the first of them takes it.
    expect(reconcileRows(rows, rack)).toEqual(
      grid(4, ['red-1-a', 'joker-a'], [_, 'blue-1-a'], ['black-1-a', 'black-2-a']),
    );
  });

  it('puts a taken-back tile in its slot when the slot is still free', () => {
    const start = grid(3, ['red-1-a', 'red-2-a', 'red-3-a'], [], []);
    const played = grid(3, ['red-1-a', _, 'red-3-a'], [], []);
    expect(reconcileRows(played, ts('red-1-a', 'red-2-a', 'red-3-a'), start)).toEqual(start);
  });
});
