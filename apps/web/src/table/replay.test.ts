import { describe, expect, it } from 'vitest';

import { takeBotTurn } from '@norikub/core/bot';
import type { Bot } from '@norikub/core/bot';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import { framesOf } from './replay.ts';
import { drawTile, fromGame, newSession } from './session.ts';

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
    const frames = framesOf(before, result);
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
    const [drawing, drew, ...rest] = framesOf(before, result);
    expect(rest).toEqual([]);
    expect(drawing?.step).toEqual({ kind: 'drawing', pick: before.pool.length - 1, face: null });
    expect(drawing?.counts[2]).toBe(1);
    expect(drawing?.pool).toBe(before.pool.length);
    expect(drew?.step).toEqual({ kind: 'drew', face: null });
    expect(drew?.counts[2]).toBe(2);
    expect(drew?.pool).toBe(before.pool.length - 1);
  });

  it('never names the tile a bot drew', () => {
    const before = { ...botsFirst(), current: 2 };
    const result = takeBotTurn(before);
    const drawn = result.game.players[2]?.rack.at(-1);
    if (drawn === undefined) throw new Error('the bot drew nothing');
    expect(JSON.stringify(framesOf(before, result))).not.toContain(drawn.id);
  });

  it('shows a pass, with the pool empty, as a pass and nothing travelling', () => {
    const before = { ...botsFirst(), current: 2, pool: [] };
    const frames = framesOf(before, takeBotTurn(before));
    expect(frames.map((f) => f.step)).toEqual([{ kind: 'passed' }]);
  });

  it('shows a proposal the engine refused as the draw it became', () => {
    const before = botsFirst();
    const broken: Bot = () => ({
      kind: 'play',
      moves: [{ kind: 'to-new-set', tileId: 'blue-1-b' }],
    });
    const frames = framesOf(before, takeBotTurn(before, broken));
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
