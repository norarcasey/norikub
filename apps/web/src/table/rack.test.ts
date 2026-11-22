import { describe, expect, it } from 'vitest';

import { ts } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import { dealRows, placeOnRack, reconcileRows } from './rack.ts';

describe('the rack', () => {
  it('lays a first deal out sorted across three rows', () => {
    const rows = dealRows(ts('joker-a', 'blue-2-a', 'red-9-a', 'red-1-a', 'black-5-a'));
    expect(rows).toEqual([['red-1-a', 'red-9-a'], ['blue-2-a', 'black-5-a'], ['joker-a']]);
  });

  it('moves a tile to any row, before the tile at the place given', () => {
    const rows = [['a', 'b', 'c'], ['d'], []];
    expect(placeOnRack(rows, 'c', 0, 0)).toEqual([['c', 'a', 'b'], ['d'], []]);
    expect(placeOnRack(rows, 'a', 2, 0)).toEqual([['b', 'c'], ['d'], ['a']]);
    expect(placeOnRack(rows, 'a', 1, 99)).toEqual([['b', 'c'], ['d', 'a'], []]);
  });

  it('drops tiles that left the rack and puts a new one on the shortest row', () => {
    const rows = [['red-1-a', 'red-2-a'], ['blue-1-a'], ['black-1-a', 'black-2-a']];
    const rack = ts('red-1-a', 'blue-1-a', 'black-1-a', 'black-2-a', 'joker-a');
    // Rows 1 and 2 are both one tile long once red 2 has gone; the first of them takes it.
    expect(reconcileRows(rows, rack)).toEqual([
      ['red-1-a', 'joker-a'],
      ['blue-1-a'],
      ['black-1-a', 'black-2-a'],
    ]);
  });

  it('puts a taken-back tile where it was', () => {
    const start = [['red-1-a', 'red-2-a', 'red-3-a'], [], []];
    const played = [['red-1-a', 'red-3-a'], [], []];
    expect(reconcileRows(played, ts('red-1-a', 'red-2-a', 'red-3-a'), start)).toEqual(start);
  });
});
