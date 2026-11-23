import { describe, expect, it } from 'vitest';

import { layout, ts } from './fixtures.test-helpers.ts';
import { seatView } from './game.ts';
import { parse } from './parse.ts';
import { move, startTurn } from './turn.ts';
import type { Turn } from './turn.ts';
import { moveInView, turnView, turnViewSchema } from './view.ts';

describe('a seat’s view of a turn in progress', () => {
  const game = layout(
    [
      { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'], hasMelded: true },
      { rack: ['black-5-a', 'black-6-a'] },
      { rack: ['orange-7-a'] },
    ],
    [['blue-1-a', 'blue-2-a', 'blue-3-a']],
  );
  const moved = move(startTurn(game), { kind: 'to-new-set', tileId: 'red-1-a' });
  if (!moved.ok) throw new Error('refused');
  const turn: Turn = moved.turn;

  it('with no turn open is the seat view exactly', () => {
    for (const seat of [0, 1, 2]) {
      expect(turnView(game, null, seat)).toEqual({ ...seatView(game, seat), turn: null });
    }
  });

  it('shows the mover the working rack and table', () => {
    const view = turnView(game, turn, 0);
    expect(view.rack).toEqual(ts('red-2-a', 'red-3-a', 'blue-9-a'));
    expect(view.table).toEqual([ts('blue-1-a', 'blue-2-a', 'blue-3-a'), ts('red-1-a')]);
    expect(view.turn).toEqual({ seat: 0, began: game.table });
  });

  it('shows everyone else the working table and the mover’s count, and their own rack', () => {
    const view = turnView(game, turn, 1);
    expect(view.rack).toEqual(ts('black-5-a', 'black-6-a'));
    expect(view.table).toEqual(turn.table);
    expect(view.opponents.find((o) => o.seat === 0)?.tileCount).toBe(3);
    expect(view.opponents.find((o) => o.seat === 2)?.tileCount).toBe(1);
  });

  it('is what the page parses, and refuses a turn of another game', () => {
    expect(parse(turnViewSchema, turnView(game, turn, 2)).ok).toBe(true);
    expect(() => turnView(layout([{ rack: [] }, { rack: [] }]), turn, 0)).toThrow(RangeError);
  });
});

describe('a move made on the mover’s own view', () => {
  const game = layout(
    [
      { rack: ['red-1-a', 'red-2-a', 'red-3-a'], hasMelded: true },
      { rack: ['black-5-a', 'black-6-a'] },
    ],
    [['blue-1-a', 'blue-2-a', 'blue-3-a']],
  );
  const steps = [
    { kind: 'to-new-set', tileId: 'red-1-a' },
    { kind: 'to-set', tileId: 'red-2-a', set: 1 },
    { kind: 'to-new-set', tileId: 'blue-3-a' },
    { kind: 'to-rack', tileId: 'red-2-a' },
  ] as const;

  it('is the view the host would send after the same moves', () => {
    let turn = startTurn(game);
    let view = turnView(game, null, 0);
    for (const m of steps) {
      const host = move(turn, m);
      const page = moveInView(view, m);
      if (!host.ok || !page.ok) throw new Error('refused');
      turn = host.turn;
      view = page.view;
      expect(view).toEqual(turnView(game, turn, 0));
    }
  });

  it('refuses what the engine refuses, from the table the turn began with', () => {
    const moved = moveInView(turnView(game, null, 0), { kind: 'to-new-set', tileId: 'blue-1-a' });
    if (!moved.ok) throw new Error('refused');
    expect(moveInView(moved.view, { kind: 'to-rack', tileId: 'blue-1-a' })).toEqual({
      ok: false,
      refusal: { kind: 'table-tile-to-rack', tileId: 'blue-1-a' },
    });
  });

  it('refuses every move from a seat whose turn it is not', () => {
    expect(
      moveInView(turnView(game, null, 1), { kind: 'to-new-set', tileId: 'black-5-a' }),
    ).toEqual({ ok: false, refusal: { kind: 'no-such-tile', tileId: 'black-5-a' } });
  });
});
