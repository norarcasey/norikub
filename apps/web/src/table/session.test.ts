import { describe, expect, it } from 'vitest';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import {
  drawTile,
  finishTurn,
  fromGame,
  moveTile,
  moveTiles,
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

  it('draws the face-down tile picked, into the emptiest rack row', () => {
    const s = session();
    const picked = s.game.pool[10];
    const next = drawTile(s, 10);
    expect(next.notes[0]).toEqual({ kind: 'drew', tile: picked });
    expect(next.rows).toEqual(
      slots(['red-13-a', 'blue-13-a'], ['black-2-a', 'black-13-a'], [picked?.id ?? '']),
    );
  });

  it('rearranges the rack without asking the engine, and keeps it through a take-back', () => {
    let s = session();
    // The 13s lined up in one column: red over black, by moving black 13 under red 13.
    s = moveTile(s, { kind: 'to-rack', tileId: 'black-13-a' }, { row: 2, col: 0 });
    expect(s.turn?.rack).toEqual(session().turn?.rack);
    const arranged = slots(['red-13-a', 'blue-13-a'], ['black-2-a'], ['black-13-a']);
    expect(s.rows).toEqual(arranged);
    s = moveTile(s, { kind: 'to-new-set', tileId: 'blue-13-a' });
    expect(s.rows[0]?.[1]).toBeNull();
    s = undoTurn(s);
    expect(s.rows).toEqual(arranged);
  });

  it('puts a tile played this turn back on the rack where it is dropped', () => {
    let s = moveTile(session(), { kind: 'to-new-set', tileId: 'red-13-a' });
    s = moveTile(s, { kind: 'to-rack', tileId: 'red-13-a' }, { row: 2, col: 4 });
    expect(s.turn?.table).toHaveLength(2);
    expect(s.rows[2]?.[4]).toBe('red-13-a');
  });
});

/** Three rows written short, padded with empty slots to the rack's ten columns. */
function slots(...rows: string[][]): (string | null)[][] {
  return rows.map((row) => [...row, ...Array.from({ length: 10 - row.length }, () => null)]);
}

const ids = (tiles: readonly { id: string }[] | undefined) => tiles?.map((tile) => tile.id);

describe('several tapped tiles sent together', () => {
  it('make a new set, in the order tapped', () => {
    const next = moveTiles(session(), ['red-13-a', 'blue-13-a', 'black-13-a'], {
      kind: 'new-set',
    });
    expect(ids(next.turn?.table[2])).toEqual(['red-13-a', 'blue-13-a', 'black-13-a']);
    expect(ids(next.turn?.rack)).toEqual(['black-2-a']);
  });

  it('go on the end of a set, unsplit', () => {
    const next = moveTiles(session(), ['red-13-a', 'black-2-a'], { kind: 'set', set: 1 });
    expect(ids(next.turn?.table[1])).toEqual([
      'red-1-a',
      'joker-a',
      'red-3-a',
      'red-13-a',
      'black-2-a',
    ]);
  });

  it('follow their set when the set before it empties', () => {
    // The red 13 alone is set 3 and the blue 13 set 4; the red 13 leaving empties set 3, and
    // set 4 becomes set 3 under the black 13 on its way.
    const lone = moveTiles(session(), ['red-13-a'], { kind: 'new-set' });
    const two = moveTiles(lone, ['blue-13-a'], { kind: 'new-set' });
    const next = moveTiles(two, ['red-13-a', 'black-13-a'], { kind: 'set', set: 3 });
    expect(next.turn?.table).toHaveLength(3);
    expect(ids(next.turn?.table[2])).toEqual(['blue-13-a', 'red-13-a', 'black-13-a']);
  });

  it('go all or none: one refused, none moved, and the refusal said', () => {
    const s = moveTiles(session(), ['red-13-a'], { kind: 'new-set' });
    const next = moveTiles(s, ['red-13-a', 'orange-13-a'], { kind: 'rack', row: 0, col: 0 });
    expect(next.turn).toBe(s.turn);
    expect(next.notes).toEqual([
      { kind: 'refused', refusal: { kind: 'table-tile-to-rack', tileId: 'orange-13-a' } },
    ]);
  });

  it('go into the rack side by side from the slot tapped', () => {
    const s = moveTiles(session(), ['red-13-a', 'blue-13-a'], { kind: 'new-set' });
    const next = moveTiles(s, ['blue-13-a', 'red-13-a'], { kind: 'rack', row: 2, col: 4 });
    expect(next.rows[2]?.slice(4, 6)).toEqual(['blue-13-a', 'red-13-a']);
  });

  it('do nothing with none tapped', () => {
    const s = session();
    expect(moveTiles(s, [], { kind: 'new-set' })).toBe(s);
  });
});
