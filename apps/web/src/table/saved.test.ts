import { describe, expect, it } from 'vitest';

import { moveTile, newSession } from './session.ts';
import { fromSaved, toSaved } from './saved.ts';

// Through JSON, as the store keeps it: a field that survives only as an object reference
// would pass a test that skipped this and fail on the first real reload.
const reloaded = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('a saved session', () => {
  const fresh = newSession(7);
  const first = fresh.turn?.rack[0];
  if (first === undefined) throw new Error('a deal with no tiles');
  // A tile on the table and the rack rearranged: a turn part-way through.
  const midTurn = moveTile(
    moveTile(fresh, { kind: 'to-new-set', tileId: first.id }),
    { kind: 'to-rack', tileId: fresh.turn?.rack[1]?.id ?? '' },
    { row: 2, col: 9 },
  );

  it('resumes mid-turn with the tiles where they were left', () => {
    const back = fromSaved(reloaded(toSaved(midTurn)));
    expect(back?.game).toEqual(midTurn.game);
    expect(back?.turn).toEqual(midTurn.turn);
    expect(back?.rows).toEqual(midTurn.rows);
    expect(back?.startRows).toEqual(midTurn.startRows);
    expect(back?.pile).toEqual(midTurn.pile);
  });

  it('resumes with nothing to watch and nothing said', () => {
    const back = fromSaved(reloaded(toSaved(midTurn)));
    expect(back?.replay).toEqual([]);
    expect(back?.notes).toEqual([]);
  });

  it('takes the turn back when the saved turn is not this game’s', () => {
    const back = fromSaved(reloaded({ ...toSaved(midTurn), turn: { rack: [], table: [] } }));
    expect(back?.turn?.rack).toEqual(fresh.turn?.rack);
    expect(back?.turn?.table).toEqual([]);
  });

  it('resumes a finished game at the scores', () => {
    const over = { ...midTurn, game: { ...midTurn.game, status: overStatus() }, turn: null };
    const back = fromSaved(reloaded(toSaved(over)));
    expect(back?.game.status.kind).toBe('over');
    expect(back?.turn).toBeNull();
  });

  it('keeps the bots picked for the game (KUB-41)', () => {
    const picked = newSession(7, ['easy', 'hard']);
    expect(fromSaved(reloaded(toSaved(picked)))?.lineup).toEqual(['easy', 'hard']);
  });

  it('resumes a game saved before bots had levels against the medium bot it was playing', () => {
    const { game, turn, rows, startRows, pile } = toSaved(midTurn);
    const back = fromSaved(reloaded({ version: 1, game, turn, rows, startRows, pile }));
    expect(back?.lineup).toEqual(['medium', 'medium']);
    expect(back?.turn).toEqual(midTurn.turn);
  });

  it('is refused when it is not a game', () => {
    expect(fromSaved(null)).toBeNull();
    expect(fromSaved({ version: 2 })).toBeNull();
    const saved = toSaved(midTurn);
    // A game that lost its pool still parses as JSON; it is not the game that was saved.
    expect(fromSaved(reloaded({ ...saved, game: { ...saved.game, pool: [] } }))).toBeNull();
    expect(fromSaved(reloaded({ ...saved, rows: [['a'], ['b', 'c'], ['d']] }))).toBeNull();
  });
});

function overStatus() {
  return { kind: 'over', reason: 'rack-emptied', winner: 1, scores: [-10, 10, 0] } as const;
}
