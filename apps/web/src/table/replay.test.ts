import { describe, expect, it } from 'vitest';

import { takeBotTurn } from '@norikub/core/bot';
import type { Bot } from '@norikub/core/bot';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import { framesOf } from './replay.ts';
import { fromGame, newSession } from './session.ts';

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

  it('shows a draw as a draw, with the counts after it', () => {
    const before = { ...botsFirst(), current: 2 };
    const result = takeBotTurn(before);
    const frames = framesOf(before, result);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.step).toEqual({ kind: 'drew' });
    expect(frames[0]?.counts[2]).toBe(2);
    expect(frames[0]?.pool).toBe(before.pool.length - 1);
  });

  it('shows a proposal the engine refused as the draw it became', () => {
    const before = botsFirst();
    const broken: Bot = () => ({
      kind: 'play',
      moves: [{ kind: 'to-new-set', tileId: 'blue-1-b' }],
    });
    const frames = framesOf(before, takeBotTurn(before, broken));
    expect(frames.map((f) => f.step.kind)).toEqual(['drew']);
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
      'drew',
    ]);
  });

  it('has nothing to watch at the start of a game', () => {
    expect(newSession(7).replay).toEqual([]);
  });
});
