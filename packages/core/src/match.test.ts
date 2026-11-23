import { describe, expect, it } from 'vitest';

import type { Status } from './game.ts';
import { SINGLE, matchFits, matchSchema, newMatch, nextGameOf, standing } from './match.ts';
import type { Match } from './match.ts';
import { parse } from './parse.ts';

const playing: Status = { kind: 'playing' };

function over(scores: readonly number[]): Status {
  const top = Math.max(...scores);
  return { kind: 'over', reason: 'rack-emptied', winner: scores.indexOf(top), scores };
}

describe('one game', () => {
  it('is not over while it is played, and over when it ends', () => {
    const match = newMatch(SINGLE);
    expect(standing(match, playing, 3)).toEqual({
      over: false,
      game: 1,
      totals: [0, 0, 0],
      leaders: [0, 1, 2],
    });
    expect(standing(match, over([30, -10, -20]), 3)).toMatchObject({
      over: true,
      totals: [30, -10, -20],
      leaders: [0],
    });
  });

  it('has no next game', () => {
    expect(nextGameOf(newMatch(SINGLE), over([30, -10, -20]), 3)).toBeNull();
  });
});

describe('a number of games', () => {
  const three = newMatch({ kind: 'games', games: 3 });

  it('counts the finished game once, before and after the next deal', () => {
    const ended = over([30, -10, -20]);
    const before = standing(three, ended, 3);
    const next = nextGameOf(three, ended, 3);
    expect(next).not.toBeNull();
    if (next === null) return;
    const after = standing(next, playing, 3);
    expect(before.totals).toEqual([30, -10, -20]);
    expect(after.totals).toEqual(before.totals);
    expect(before.game).toBe(1);
    expect(after.game).toBe(2);
  });

  it('ends after the last game, on the highest total', () => {
    let match: Match = three;
    for (const scores of [
      [30, -10, -20],
      [-5, 25, -20],
    ]) {
      const next = nextGameOf(match, over(scores), 3);
      if (next === null) throw new Error('the match ended early');
      match = next;
    }
    expect(standing(match, playing, 3).over).toBe(false);
    const last = standing(match, over([-4, 40, -36]), 3);
    expect(last).toMatchObject({ over: true, game: 3, totals: [21, 55, -76], leaders: [1] });
    expect(nextGameOf(match, over([-4, 40, -36]), 3)).toBeNull();
  });

  it('is shared when it ends level', () => {
    const match: Match = { format: { kind: 'games', games: 2 }, played: [[20, -20]] };
    expect(standing(match, over([-20, 20]), 2).leaders).toEqual([0, 1]);
  });

  it('never deals a next game while this one is played', () => {
    expect(nextGameOf(three, playing, 3)).toBeNull();
  });
});

describe('first to a score', () => {
  const to100 = newMatch({ kind: 'points', target: 100 });

  it('goes on until a total reaches the target', () => {
    const next = nextGameOf(to100, over([60, -60]), 2);
    expect(next).not.toBeNull();
    if (next === null) return;
    expect(standing(next, over([39, -39]), 2).over).toBe(false);
    expect(standing(next, over([40, -40]), 2)).toMatchObject({ over: true, leaders: [0] });
  });

  it('is won by the highest total, not by whoever crossed', () => {
    const match: Match = { format: { kind: 'points', target: 100 }, played: [[90, 95, -185]] };
    expect(standing(match, over([12, 30, -42]), 3)).toMatchObject({
      over: true,
      totals: [102, 125, -227],
      leaders: [1],
    });
  });
});

describe('a saved match', () => {
  it('fits only the seats its games were scored for', () => {
    const match: Match = { format: SINGLE, played: [[10, -10]] };
    expect(matchFits(match, 2)).toBe(true);
    expect(matchFits(match, 3)).toBe(false);
  });

  it('refuses a format outside the bounds', () => {
    expect(parse(matchSchema, { format: { kind: 'games', games: 1 }, played: [] }).ok).toBe(false);
    expect(parse(matchSchema, { format: { kind: 'points', target: 0 }, played: [] }).ok).toBe(
      false,
    );
    expect(parse(matchSchema, { format: { kind: 'points', target: 200 }, played: [] }).ok).toBe(
      true,
    );
  });
});
