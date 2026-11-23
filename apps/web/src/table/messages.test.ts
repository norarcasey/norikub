import { describe, expect, it } from 'vitest';

import { ts } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import { summarizeTurn } from '@norikub/core/summary';

import { turnText } from './messages.ts';

const say = (before: string[][], after: string[][]) =>
  turnText(
    'Tatum',
    summarizeTurn(
      before.map((set) => ts(...set)),
      after.map((set) => ts(...set)),
    ),
  );

const ORANGE = ['orange-10-a', 'orange-11-a', 'orange-12-a'];

describe('another player’s turn in words', () => {
  it('is a draw when nothing was played', () => {
    expect(say([ORANGE], [ORANGE])).toBe('Tatum drew a tile.');
  });

  it('says a set laid down before tiles added, whatever order they are on the table', () => {
    expect(
      say(
        [ORANGE],
        [
          [...ORANGE, 'orange-9-a'],
          ['red-4-a', 'red-5-a', 'red-6-a'],
        ],
      ),
    ).toBe('Tatum laid down red 4–6 and added the orange 9 to orange 9–12.');
  });

  it('names a rework by its result, not its moves', () => {
    const red = ['red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a'];
    expect(say([red], [red.slice(0, 4), ['red-7-a', 'black-7-a', 'orange-7-a']])).toBe(
      'Tatum reworked 1 set and added the black 7 and orange 7 to the 7s.',
    );
  });

  it('counts more than three tiles added to one set', () => {
    expect(
      say([ORANGE], [['orange-6-a', 'orange-7-a', 'orange-8-a', 'orange-9-a', ...ORANGE]]),
    ).toBe('Tatum added 4 tiles to orange 6–12.');
  });

  it('lays down a group by how many it holds', () => {
    expect(say([], [['blue-8-a', 'red-8-a', 'black-8-a', 'orange-8-a']])).toBe(
      'Tatum laid down four 8s.',
    );
    expect(say([], [['blue-8-a', 'red-8-a', 'joker-a']])).toBe('Tatum laid down three 8s.');
  });

  it('counts the tiles when they went into more than two sets', () => {
    const blue = ['blue-1-a', 'blue-2-a', 'blue-3-a'];
    const black = ['black-9-a', 'black-10-a', 'black-11-a'];
    expect(
      say(
        [blue, black],
        [
          [...blue, 'blue-4-a'],
          ['red-9-a', 'red-10-a', 'red-11-a'],
          [...black.slice(0, 2), 'joker-a'],
          ['black-11-a', 'red-11-b', 'orange-11-a'],
        ],
      ),
    ).toBe('Tatum reworked 1 set and played 7 tiles into 4 sets.');
  });
});
