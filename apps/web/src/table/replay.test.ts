import { describe, expect, it } from 'vitest';

import { takeBotTurn } from '@norikub/core/bot';
import type { Bot, BotTurn } from '@norikub/core/bot';
import type { Game } from '@norikub/core/game';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import { dealPile, fitPile, pileSpot, takeFromPile } from './pile.ts';
import { framesOf } from './replay.ts';
import { drawTile, finishTurn, fromGame, moveTile, newSession } from './session.ts';

const watch = (before: Game, result: BotTurn) =>
  framesOf(before, result, dealPile(before.pool.length));

describe('the pile', () => {
  it('keeps every other tile’s spot when one is taken', () => {
    expect(takeFromPile(dealPile(6), 2)).toEqual([0, 1, 3, 4, 5]);
  });

  it('is dealt afresh only when it does not fit the pool', () => {
    const pile = [4, 9, 2];
    expect(fitPile(pile, 3)).toBe(pile);
    expect(fitPile(pile, 2)).toEqual([0, 1]);
    expect(fitPile(undefined, 2)).toEqual([0, 1]);
  });

  it('puts a spot in the same place every time, inside the pile, turned no more than 40°', () => {
    expect(pileSpot(17)).toEqual(pileSpot(17));
    for (let spot = 0; spot < 106; spot++) {
      const { x, y, turn } = pileSpot(spot);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(1);
      expect(Math.abs(turn)).toBeLessThanOrEqual(40);
    }
    expect(pileSpot(1)).not.toEqual(pileSpot(2));
  });
});

describe('the pile through a game', () => {
  it('loses the person’s pick and each bot’s last tile, and nothing else moves', () => {
    const s = fromGame(
      layout([{ rack: ['black-2-a'] }, { rack: ['red-1-b'] }, { rack: ['blue-1-b'] }]),
      [],
    );
    const dealt = s.pile;
    expect(dealt).toEqual(dealPile(s.game.pool.length));
    const next = drawTile(s, 5);
    // Spot 5 for the person, then the two bots' draws take the last two.
    expect(next.pile).toEqual(takeFromPile(dealt, 5).slice(0, -2));
    expect(next.pile).toHaveLength(next.game.pool.length);
    expect(next.replay[0]?.step).toMatchObject({ kind: 'drawing', pick: 5 });
    expect(next.replay[0]?.pile).toBe(dealt);
  });

  it('is kept when a turn ends without drawing', () => {
    const s = fromGame(
      layout([
        { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'black-9-a'], hasMelded: true },
        { rack: ['red-1-b'] },
        { rack: ['blue-1-b'] },
      ]),
      [],
    );
    let played = moveTile(s, { kind: 'to-new-set', tileId: 'red-1-a' });
    played = moveTile(played, { kind: 'to-set', tileId: 'red-2-a', set: 0 });
    played = moveTile(played, { kind: 'to-set', tileId: 'red-3-a', set: 0 });
    const next = finishTurn(played);
    // The person drew nothing; the two bots, who have not melded, each took the last tile.
    expect(next.game.table).toHaveLength(1);
    expect(next.pile).toEqual(s.pile.slice(0, -2));
  });
});

// Seat 1 has melded and can lay a red 4-5-6 and add the orange 9 to the run on the table; seat
// 2 has not melded and draws.
function botsFirst() {
  return {
    ...layout(
      [
        { rack: ['black-2-a', 'black-3-a'] },
        { rack: ['red-4-a', 'red-5-a', 'red-6-a', 'orange-9-a', 'blue-1-b'], hasMelded: true },
        { rack: ['blue-2-b'] },
      ],
      [['orange-10-a', 'orange-11-a', 'orange-12-a']],
    ),
    current: 1,
  };
}

describe('the frames of a bot turn', () => {
  it('shows each tile the bot plays, in its order, then the table the engine accepted', () => {
    const before = botsFirst();
    const result = takeBotTurn(before);
    const frames = watch(before, result);
    expect(frames.map((f) => (f.step.kind === 'placed' ? f.step.tile.id : f.step.kind))).toEqual([
      'red-4-a',
      'red-5-a',
      'red-6-a',
      'orange-9-a',
      'done',
    ]);
    expect(frames.map((f) => f.counts[1])).toEqual([4, 3, 2, 1, 1]);
    expect(frames.at(-1)?.table).toBe(result.game.table);
    expect(frames.at(-1)?.step).toEqual({ kind: 'done', played: 4 });
    expect(frames.every((f) => f.name === 'P1' && f.seat === 1)).toBe(true);
  });

  it('shows a bot’s draw leaving the last tile in the pool, face down, then landed', () => {
    const before = { ...botsFirst(), current: 2 };
    const result = takeBotTurn(before);
    const [drawing, drew, ...rest] = watch(before, result);
    expect(rest).toEqual([]);
    expect(drawing?.step).toEqual({ kind: 'drawing', pick: before.pool.length - 1, face: null });
    expect(drawing?.counts[2]).toBe(1);
    expect(drawing?.pile).toHaveLength(before.pool.length);
    expect(drew?.step).toEqual({ kind: 'drew', face: null });
    expect(drew?.counts[2]).toBe(2);
    // The last spot is gone and every other tile lies where it lay.
    expect(drew?.pile).toEqual(drawing?.pile.slice(0, -1));
  });

  it('never names the tile a bot drew', () => {
    const before = { ...botsFirst(), current: 2 };
    const result = takeBotTurn(before);
    const drawn = result.game.players[2]?.rack.at(-1);
    if (drawn === undefined) throw new Error('the bot drew nothing');
    expect(JSON.stringify(watch(before, result))).not.toContain(drawn.id);
  });

  it('shows a pass, with the pool empty, as a pass and nothing travelling', () => {
    const before = { ...botsFirst(), current: 2, pool: [] };
    const frames = watch(before, takeBotTurn(before));
    expect(frames.map((f) => f.step)).toEqual([{ kind: 'passed' }]);
  });

  it('shows a proposal the engine refused as the draw it became', () => {
    const before = botsFirst();
    const broken: Bot = () => ({
      kind: 'play',
      moves: [{ kind: 'to-new-set', tileId: 'blue-1-b' }],
    });
    const frames = watch(before, takeBotTurn(before, broken));
    expect(frames.map((f) => f.step.kind)).toEqual(['drawing', 'drew']);
  });
});

describe('the person’s draw', () => {
  it('plays first, face up, from the tile they picked, then the bots', () => {
    const s = fromGame(
      layout([{ rack: ['black-2-a'] }, { rack: ['red-1-b'] }, { rack: ['blue-1-b'] }]),
      [],
    );
    const picked = s.game.pool[5];
    const next = drawTile(s, 5);
    const steps = next.replay.map((f) => f.step);
    expect(steps.slice(0, 2)).toEqual([
      { kind: 'drawing', pick: 5, face: picked },
      { kind: 'drew', face: picked },
    ]);
    expect(next.replay[0]?.seat).toBe(0);
    expect(steps.slice(2).map((step) => step.kind)).toEqual(['drawing', 'drew', 'drawing', 'drew']);
  });

  it('has nothing to watch for a pass of their own', () => {
    const s = fromGame(
      {
        ...layout([{ rack: ['black-2-a'] }, { rack: ['red-1-b'] }, { rack: ['blue-1-b'] }]),
        pool: [],
      },
      [],
    );
    const next = drawTile(s);
    expect(next.replay.map((f) => f.step.kind)).toEqual(['passed', 'passed']);
  });
});

describe('a session after bot turns', () => {
  it('holds the game the bots left, with their turns as frames to watch', () => {
    const s = fromGame(botsFirst(), []);
    expect(s.game.current).toBe(0);
    expect(s.game.players[1]?.rack).toHaveLength(1);
    expect(s.replay.map((f) => f.step.kind)).toEqual([
      'placed',
      'placed',
      'placed',
      'placed',
      'done',
      'drawing',
      'drew',
    ]);
  });

  it('has nothing to watch at the start of a game', () => {
    expect(newSession(7).replay).toEqual([]);
  });
});
