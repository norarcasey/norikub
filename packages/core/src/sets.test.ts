import { describe, expect, it } from 'vitest';

import { ts } from './fixtures.test-helpers.ts';
import { arrangeSet, judgeSet, splitFor } from './sets.ts';

describe('a run', () => {
  it('is three or more consecutive numbers of one colour', () => {
    expect(judgeSet(ts('red-3-a', 'red-4-a', 'red-5-a'))).toEqual({
      valid: true,
      kind: 'run',
      points: 12,
    });
    expect(judgeSet(ts('blue-1-a', 'blue-2-b', 'blue-3-a', 'blue-4-a', 'blue-5-a'))).toMatchObject({
      valid: true,
      points: 15,
    });
  });

  it('may run the whole way from 1 to 13', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `black-${i + 1}-a`);
    expect(judgeSet(ts(...ids))).toEqual({ valid: true, kind: 'run', points: 91 });
  });

  it('is judged by its tiles, not the order they were laid down in', () => {
    expect(judgeSet(ts('red-5-a', 'red-3-a', 'red-4-b'))).toMatchObject({ valid: true });
  });

  it('does not wrap from 13 to 1', () => {
    expect(judgeSet(ts('orange-12-a', 'orange-13-a', 'orange-1-a'))).toEqual({
      valid: false,
      reason: 'not-a-set',
    });
  });

  it('is refused with a gap, a second colour or a repeated number', () => {
    expect(judgeSet(ts('red-3-a', 'red-4-a', 'red-6-a')).valid).toBe(false);
    expect(judgeSet(ts('red-3-a', 'red-4-a', 'blue-5-a')).valid).toBe(false);
    expect(judgeSet(ts('red-3-a', 'red-4-a', 'red-4-b', 'red-5-a')).valid).toBe(false);
  });

  it('is refused under three tiles', () => {
    expect(judgeSet(ts('red-3-a', 'red-4-a'))).toEqual({ valid: false, reason: 'too-short' });
    expect(judgeSet([])).toEqual({ valid: false, reason: 'too-short' });
  });

  it('takes a joker for the tile in a gap', () => {
    expect(judgeSet(ts('red-3-a', 'joker-a', 'red-5-a'))).toEqual({
      valid: true,
      kind: 'run',
      points: 12,
    });
  });

  it('takes two jokers for a gap of two', () => {
    expect(judgeSet(ts('red-3-a', 'joker-a', 'joker-b', 'red-6-a'))).toMatchObject({
      valid: true,
      points: 18,
    });
    expect(judgeSet(ts('red-3-a', 'joker-a', 'red-7-a')).valid).toBe(false);
  });

  it('counts an end joker as the higher tile when it could be either', () => {
    // 5-6-joker is 5-6-7 (18), not 4-5-6 (15).
    expect(judgeSet(ts('red-5-a', 'red-6-a', 'joker-a'))).toMatchObject({ points: 18 });
  });

  it('counts an end joker below when there is no room above', () => {
    // joker-12-13 can only be 11-12-13.
    expect(judgeSet(ts('joker-a', 'red-12-a', 'red-13-a'))).toMatchObject({ points: 36 });
    // joker-joker-12-13: both spare jokers go below, as 10 and 11.
    expect(judgeSet(ts('joker-a', 'joker-b', 'red-12-a', 'red-13-a'))).toMatchObject({
      valid: true,
      kind: 'run',
      points: 10 + 11 + 12 + 13,
    });
  });

  it('is refused at fourteen tiles, even with jokers', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `black-${i + 1}-a`);
    expect(judgeSet(ts(...ids, 'joker-a')).valid).toBe(false);
  });
});

describe('a group', () => {
  it('is three or four of one number in different colours', () => {
    expect(judgeSet(ts('red-7-a', 'blue-7-a', 'black-7-b'))).toEqual({
      valid: true,
      kind: 'group',
      points: 21,
    });
    expect(judgeSet(ts('red-7-a', 'blue-7-a', 'black-7-b', 'orange-7-a'))).toMatchObject({
      valid: true,
      kind: 'group',
      points: 28,
    });
  });

  it('is refused with a repeated colour, a second number or a fifth tile', () => {
    expect(judgeSet(ts('red-7-a', 'red-7-b', 'blue-7-a')).valid).toBe(false);
    expect(judgeSet(ts('red-7-a', 'blue-7-a', 'black-8-a')).valid).toBe(false);
    expect(judgeSet(ts('red-7-a', 'blue-7-a', 'black-7-a', 'orange-7-a', 'joker-a')).valid).toBe(
      false,
    );
  });

  it('takes a joker for a missing colour', () => {
    expect(judgeSet(ts('red-13-a', 'blue-13-a', 'joker-a'))).toEqual({
      valid: true,
      kind: 'group',
      points: 39,
    });
    expect(judgeSet(ts('red-13-a', 'blue-13-a', 'black-13-a', 'joker-a'))).toMatchObject({
      kind: 'group',
      points: 52,
    });
  });

  it('is read as a run when that scores more, and as a group when the group does', () => {
    // joker-joker-5: a 5-6-7 run (18) beats three 5s (15).
    expect(judgeSet(ts('joker-a', 'joker-b', 'red-5-a'))).toMatchObject({
      kind: 'run',
      points: 18,
    });
    // joker-joker-13: 11-12-13 (36) loses to three 13s (39).
    expect(judgeSet(ts('joker-a', 'joker-b', 'blue-13-a'))).toMatchObject({
      kind: 'group',
      points: 39,
    });
  });
});

describe('the order a set is read in', () => {
  const ids = (tiles: readonly { id: string }[]) => tiles.map((tile) => tile.id);

  it('lays a run out low to high, whatever order it was dropped in', () => {
    expect(ids(arrangeSet(ts('red-7-a', 'red-5-a', 'red-6-b')))).toEqual([
      'red-5-a',
      'red-6-b',
      'red-7-a',
    ]);
  });

  it('puts a joker in the gap it fills', () => {
    expect(ids(arrangeSet(ts('joker-a', 'blue-9-a', 'blue-7-a')))).toEqual([
      'blue-7-a',
      'joker-a',
      'blue-9-a',
    ]);
  });

  it('puts a spare joker above the run, as it is scored', () => {
    expect(ids(arrangeSet(ts('joker-b', 'black-4-a', 'black-5-a')))).toEqual([
      'black-4-a',
      'black-5-a',
      'joker-b',
    ]);
  });

  it('puts a spare joker below a run that ends at 13', () => {
    expect(ids(arrangeSet(ts('orange-13-a', 'joker-a', 'orange-12-a')))).toEqual([
      'joker-a',
      'orange-12-a',
      'orange-13-a',
    ]);
  });

  it('lays a group out by colour, jokers last', () => {
    expect(ids(arrangeSet(ts('joker-a', 'black-8-a', 'red-8-a', 'blue-8-b')))).toEqual([
      'red-8-a',
      'blue-8-b',
      'black-8-a',
      'joker-a',
    ]);
  });

  it('leaves a set that is not valid yet in the order it was dropped', () => {
    const dropped = ts('red-9-a', 'red-3-a', 'blue-1-a');
    expect(arrangeSet(dropped)).toBe(dropped);
  });
});

describe('splitting a run for a tile', () => {
  const run = ts('red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a');
  const [red5] = ts('red-5-b');

  it('cuts where the tile ends one half and both halves are sets', () => {
    if (red5 === undefined) throw new Error('no tile');
    expect(splitFor(run, red5)).toEqual({
      at: 2,
      left: ts('red-3-a', 'red-4-a', 'red-5-b'),
      right: ts('red-5-a', 'red-6-a', 'red-7-a'),
    });
  });

  it('splits a run with a joker in it, the joker staying where it stands', () => {
    // 2-3-★-5-6-7 with the joker as the 4; a second 5 ends 2-3-★ and leaves 5-6-7.
    const withJoker = ts('red-2-a', 'red-3-a', 'joker-a', 'red-5-a', 'red-6-a', 'red-7-a');
    if (red5 === undefined) throw new Error('no tile');
    expect(splitFor(withJoker, red5)).toEqual({
      at: 3,
      left: ts('red-2-a', 'red-3-a', 'joker-a', 'red-5-b'),
      right: ts('red-5-a', 'red-6-a', 'red-7-a'),
    });
  });

  it('finds the cut whatever order the run’s tiles were laid in', () => {
    const laid = ts('red-7-a', 'red-3-a', 'red-6-a', 'red-4-a', 'red-5-a');
    if (red5 === undefined) throw new Error('no tile');
    expect(splitFor(laid, red5)?.right).toEqual(ts('red-5-a', 'red-6-a', 'red-7-a'));
  });

  it('does not split for a tile that extends the run whole', () => {
    const [red8] = ts('red-8-a');
    if (red8 === undefined) throw new Error('no tile');
    expect(splitFor(run, red8)).toBeNull();
  });

  it('does not split when no cut leaves two sets', () => {
    const short = ts('red-3-a', 'red-4-a', 'red-5-a', 'red-6-a');
    const [blue5] = ts('blue-5-a');
    if (red5 === undefined || blue5 === undefined) throw new Error('no tile');
    expect(splitFor(short, red5)).toBeNull();
    expect(splitFor(run, blue5)).toBeNull();
  });

  it('splits only runs', () => {
    const group = ts('red-5-a', 'blue-5-a', 'black-5-a');
    if (red5 === undefined) throw new Error('no tile');
    expect(splitFor(group, red5)).toBeNull();
    expect(splitFor(ts('red-3-a', 'red-9-a'), red5)).toBeNull();
  });
});
