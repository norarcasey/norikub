import { describe, expect, it } from 'vitest';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import {
  drawTile,
  finishTurn,
  fromGame,
  moveTile,
  newSession,
  probe,
  undoTurn,
} from './session.ts';
import type { Session } from './session.ts';

// Seat 0 has melded and holds a 13 group's makings; the table has a long orange run and a
// joker in a run, so both of the engine's refusals can be tried.
function session(): Session {
  return fromGame(
    layout(
      [
        { rack: ['red-13-a', 'blue-13-a', 'black-13-a', 'black-2-a'], hasMelded: true },
        { rack: ['red-1-b', 'red-5-b'] },
        { rack: ['blue-1-b', 'blue-5-b'] },
      ],
      [
        ['orange-10-a', 'orange-11-a', 'orange-12-a', 'orange-13-a'],
        ['red-1-a', 'joker-a', 'red-3-a'],
      ],
    ),
    [],
  );
}

describe('a session', () => {
  it('starts at the person’s turn with a full rack', () => {
    const s = newSession(7);
    expect(s.game.current).toBe(0);
    expect(s.turn?.rack).toHaveLength(14);
    expect(s.game.players).toHaveLength(3);
  });

  it('refuses a table tile to the rack and leaves the turn as it was', () => {
    const s = session();
    const next = moveTile(s, { kind: 'to-rack', tileId: 'orange-13-a' });
    expect(next.turn).toBe(s.turn);
    expect(next.notes).toEqual([
      { kind: 'refused', refusal: { kind: 'table-tile-to-rack', tileId: 'orange-13-a' } },
    ]);
  });

  it('names the joker apart when one is sent to the rack', () => {
    expect(probe(session(), { kind: 'to-rack', tileId: 'joker-a' })).toEqual({
      kind: 'table-joker-to-rack',
      tileId: 'joker-a',
    });
    expect(probe(session(), { kind: 'to-new-set', tileId: 'joker-a' })).toBeNull();
  });

  it('keeps the turn open with the engine’s faults when the table is not legal', () => {
    const s = moveTile(session(), { kind: 'to-new-set', tileId: 'red-13-a' });
    const next = finishTurn(s);
    expect(next.turn).toBe(s.turn);
    expect(next.notes).toEqual([{ kind: 'fault', fault: { kind: 'invalid-set', set: 2 } }]);
    expect(finishTurn(session()).notes).toEqual([
      { kind: 'fault', fault: { kind: 'nothing-played' } },
    ]);
  });

  it('ends a legal turn, lets both bots play, and comes back to the person', () => {
    let s = session();
    s = moveTile(s, { kind: 'to-new-set', tileId: 'red-13-a' });
    s = moveTile(s, { kind: 'to-set', tileId: 'blue-13-a', set: 2 });
    s = moveTile(s, { kind: 'to-set', tileId: 'black-13-a', set: 2 });
    const next = finishTurn(s);
    expect(next.game.current).toBe(0);
    expect(next.turn?.rack.map((tile) => tile.id)).toEqual(['black-2-a']);
    // Neither bot can play from these racks, so each draws: played 0, never -1.
    expect(next.notes).toEqual([
      { kind: 'bot', name: 'P1', played: 0 },
      { kind: 'bot', name: 'P2', played: 0 },
    ]);
  });

  it('takes back to the turn’s start', () => {
    const s = session();
    const moved = moveTile(s, { kind: 'to-set', tileId: 'orange-13-a', set: 1 });
    expect(undoTurn(moved).turn).toEqual(s.turn);
  });

  it('draws from the table the turn began with', () => {
    const s = session();
    const moved = moveTile(s, { kind: 'to-new-set', tileId: 'red-13-a' });
    const next = drawTile(moved);
    expect(next.game.table).toEqual(s.game.table);
    expect(next.turn?.rack).toHaveLength(5);
    expect(next.notes[0]?.kind).toBe('drew');
  });
});
