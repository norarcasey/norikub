import { describe, expect, it } from 'vitest';

import { SINGLE } from '../../../../packages/core/src/match.ts';
import { moveTile, newSession, nextGame, seatsFor } from './session.ts';
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
    const lineup = seatsFor(['easy', 'hard']);
    const picked = newSession(7, { lineup, format: SINGLE });
    expect(fromSaved(reloaded(toSaved(picked)))?.lineup).toEqual(lineup);
  });

  it('gives a game saved before characters its levels’ roster, renamed for it (KUB-43)', () => {
    const { game, turn, rows, startRows, pile, match } = toSaved(midTurn);
    const old = {
      ...game,
      players: game.players.map((player, seat) =>
        seat === 0 ? player : { ...player, name: `Hard bot ${'AB'.charAt(seat - 1)}` },
      ),
    };
    const lineup = ['hard', 'hard'];
    const back = fromSaved(
      reloaded({ version: 3, game: old, turn, rows, startRows, pile, lineup, match }),
    );
    expect(back?.lineup).toEqual(seatsFor(['hard', 'hard']));
    expect(back?.game.players.map((player) => player.name)).toEqual([
      'You',
      'Michael',
      'Lumber Jill Nora',
    ]);
    expect(back?.turn?.rack).toEqual(midTurn.turn?.rack);
  });

  it('seats the roster over a game saved when any face could play any level', () => {
    const saved = toSaved(midTurn);
    const free = [
      { level: 'hard', who: 'tatum' },
      { level: 'easy', who: 'tatum' },
    ];
    const back = fromSaved(reloaded({ ...saved, lineup: free }));
    expect(back?.lineup).toEqual(seatsFor(['hard', 'easy']));
    expect(back?.game.players.map((player) => player.name)).toEqual(['You', 'Michael', 'Tatum']);
  });

  it('resumes a game saved before bots had levels against the medium bot it was playing', () => {
    const { game, turn, rows, startRows, pile } = toSaved(midTurn);
    const back = fromSaved(reloaded({ version: 1, game, turn, rows, startRows, pile }));
    expect(back?.lineup).toEqual(seatsFor(['medium', 'medium']));
    expect(back?.turn).toEqual(midTurn.turn);
  });

  it('keeps the match, its games played and its format (KUB-42)', () => {
    const three = newSession(7, {
      lineup: seatsFor(['easy', 'hard']),
      format: { kind: 'games', games: 3 },
    });
    const second = nextGame(
      { ...three, game: { ...three.game, status: overStatus() }, turn: null },
      8,
    );
    if (second === null) throw new Error('a match of three ended after one');
    const back = fromSaved(reloaded(toSaved(second)));
    expect(back?.match).toEqual({ format: { kind: 'games', games: 3 }, played: [[-10, 10, 0]] });
  });

  it('resumes a game saved before matches as one game on its own', () => {
    const { game, turn, rows, startRows, pile } = toSaved(midTurn);
    const lineup = ['medium', 'medium'];
    const back = fromSaved(reloaded({ version: 2, game, turn, rows, startRows, pile, lineup }));
    expect(back?.match).toEqual({ format: { kind: 'single' }, played: [] });
  });

  it('is refused when its lineup or its match is for another number of seats', () => {
    const saved = toSaved(midTurn);
    expect(fromSaved(reloaded({ ...saved, lineup: seatsFor(['easy']) }))).toBeNull();
    const match = { format: SINGLE, played: [[10, -10]] };
    expect(fromSaved(reloaded({ ...saved, match }))).toBeNull();
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
