import { describe, expect, it } from 'vitest';

import { ts } from './fixtures.test-helpers.ts';
import { shapeOf, summarizeTurn } from './summary.ts';

describe('the shape of a set', () => {
  it('names a run by its colour and its ends', () => {
    expect(shapeOf(ts('blue-6-a', 'blue-4-a', 'blue-5-b'))).toEqual({
      kind: 'run',
      colour: 'blue',
      low: 4,
      high: 6,
    });
  });

  it('reads a joker in a run where judgeSet counts it, upward first', () => {
    expect(shapeOf(ts('joker-a', 'red-5-a', 'red-6-a'))).toEqual({
      kind: 'run',
      colour: 'red',
      low: 5,
      high: 7,
    });
    expect(shapeOf(ts('joker-a', 'red-12-a', 'red-13-a'))).toEqual({
      kind: 'run',
      colour: 'red',
      low: 11,
      high: 13,
    });
  });

  it('names a group by its number', () => {
    expect(shapeOf(ts('red-9-a', 'joker-b', 'black-9-a'))).toEqual({
      kind: 'group',
      value: 9,
      size: 3,
    });
  });

  it('calls anything else other', () => {
    expect(shapeOf(ts('red-9-a', 'blue-3-a'))).toEqual({ kind: 'other' });
  });
});

describe('the summary of a turn', () => {
  it('is nothing played for a table that did not change', () => {
    const table = [ts('red-1-a', 'red-2-a', 'red-3-a')];
    expect(summarizeTurn(table, table)).toEqual({ placements: [], reworked: 0 });
  });

  it('tells a set laid down from tiles added to one already there', () => {
    const before = [ts('orange-10-a', 'orange-11-a', 'orange-12-a')];
    const after = [
      ts('orange-10-a', 'orange-11-a', 'orange-12-a', 'orange-9-a'),
      ts('red-4-a', 'red-5-a', 'red-6-a'),
    ];
    expect(summarizeTurn(before, after)).toEqual({
      placements: [
        {
          tiles: ts('orange-9-a'),
          into: { kind: 'run', colour: 'orange', low: 9, high: 12 },
          fresh: false,
        },
        {
          tiles: ts('red-4-a', 'red-5-a', 'red-6-a'),
          into: { kind: 'run', colour: 'red', low: 4, high: 6 },
          fresh: true,
        },
      ],
      reworked: 0,
    });
  });

  it('counts a set split, or robbed of a tile, as reworked, and its result as where the tile went', () => {
    // A run of red 3 to 7 gives up its 7 to a group of 7s made with two from the rack; the
    // blue run is untouched.
    const before = [
      ts('red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a'),
      ts('blue-1-a', 'blue-2-a', 'blue-3-a'),
    ];
    const after = [
      ts('red-3-a', 'red-4-a', 'red-5-a', 'red-6-a'),
      ts('blue-1-a', 'blue-2-a', 'blue-3-a'),
      ts('red-7-a', 'black-7-a', 'orange-7-a'),
    ];
    expect(summarizeTurn(before, after)).toEqual({
      placements: [
        {
          tiles: ts('black-7-a', 'orange-7-a'),
          into: { kind: 'group', value: 7, size: 3 },
          fresh: false,
        },
      ],
      reworked: 1,
    });
  });

  it('counts two sets joined into one as both reworked', () => {
    const before = [ts('red-1-a', 'red-2-a', 'red-3-a'), ts('red-5-a', 'red-6-a', 'red-7-a')];
    const after = [ts('red-1-a', 'red-2-a', 'red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a')];
    expect(summarizeTurn(before, after).reworked).toBe(2);
  });
});
