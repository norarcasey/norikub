import { describe, expect, it } from 'vitest';

import { layout, t } from './fixtures.test-helpers.ts';
import { draw, finish, gameSchema, newGame, seatView } from './game.ts';
import type { Game } from './game.ts';
import { parse } from './parse.ts';

const names = ['Nora', 'Bot A', 'Bot B'];

function drawn(game: Game): Game {
  const result = draw(game);
  if (!result.ok) throw new Error(result.refusal);
  return result.game;
}

describe('a new game', () => {
  const game = newGame({ names, seed: 42 });

  it('deals fourteen tiles to each seat and leaves the rest in the pool', () => {
    for (const player of game.players) expect(player.rack).toHaveLength(14);
    expect(game.pool).toHaveLength(106 - 3 * 14);
    expect(game.table).toEqual([]);
    expect(game.current).toBe(0);
    expect(game.players.every((player) => !player.hasMelded)).toBe(true);
  });

  it('deals the same game from the same seed', () => {
    expect(newGame({ names, seed: 42 })).toEqual(game);
    expect(newGame({ names, seed: 43 })).not.toEqual(game);
  });

  it('survives a save and a reload exactly', () => {
    const reloaded = parse(gameSchema, JSON.parse(JSON.stringify(game)));
    expect(reloaded).toEqual({ ok: true, value: game });
  });
});

describe('reading a saved game back', () => {
  const game = newGame({ names, seed: 1 });

  it('refuses one that lost a tile', () => {
    expect(parse(gameSchema, { ...game, pool: game.pool.slice(1) }).ok).toBe(false);
  });

  it('refuses one that doubled a tile', () => {
    const pool = [...game.pool.slice(1), game.pool[2]];
    expect(parse(gameSchema, { ...game, pool }).ok).toBe(false);
  });

  it('refuses a tile that is not in the box', () => {
    const pool = [...game.pool.slice(1), { kind: 'joker', id: 'joker-c' }];
    const result = parse(gameSchema, { ...game, pool });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toMatch(/not in the box/);
  });

  it('refuses a turn for a seat nobody sits in', () => {
    const result = parse(gameSchema, { ...game, current: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join()).toMatch(/current: no such seat/);
  });
});

describe('drawing', () => {
  it('takes one tile from the pool into the rack and passes the turn', () => {
    const game = newGame({ names, seed: 9 });
    const result = draw(game);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.drawn).toEqual(game.pool.at(-1));
    expect(result.game.players[0]?.rack).toHaveLength(15);
    expect(result.game.pool).toHaveLength(game.pool.length - 1);
    expect(result.game.current).toBe(1);
    expect(parse(gameSchema, result.game).ok).toBe(true);
  });

  it('goes round the table back to the first seat', () => {
    const game = drawn(drawn(drawn(newGame({ names, seed: 9 }))));
    expect(game.current).toBe(0);
  });

  it('passes on an empty pool, and a full round of passes ends the game on the lowest rack', () => {
    const start: Game = {
      ...layout([{ rack: ['red-9-a'] }, { rack: ['red-2-a', 'red-3-a'] }, { rack: ['joker-a'] }]),
      pool: [],
    };
    const first = draw(start);
    expect(first).toMatchObject({ ok: true, drawn: null });
    const end = drawn(drawn(drawn(start)));
    expect(end.status).toEqual({
      kind: 'over',
      reason: 'pool-exhausted',
      winner: 1,
      scores: [-9, 39, -30],
    });
  });

  it('starts the count of passes again after a draw', () => {
    const start: Game = { ...layout([{ rack: ['red-9-a'] }, { rack: ['red-2-a'] }]), passes: 1 };
    expect(drawn(start).passes).toBe(0);
  });

  it('breaks a tie on the lowest rack by fewer tiles, then by the earlier seat', () => {
    const fewer: Game = {
      ...layout([{ rack: ['red-2-a', 'red-3-a'] }, { rack: ['red-5-a'] }]),
      pool: [],
      passes: 1,
    };
    expect(drawn(fewer).status).toMatchObject({ winner: 1 });
    const same: Game = {
      ...layout([{ rack: ['red-5-a'] }, { rack: ['blue-5-a'] }]),
      pool: [],
      passes: 1,
    };
    expect(drawn(same).status).toMatchObject({ winner: 0 });
  });

  it('takes the face-down tile the player picked, and only that one', () => {
    const game = newGame({ names, seed: 9 });
    const result = draw(game, 5);
    if (!result.ok) throw new Error(result.refusal);
    expect(result.drawn).toEqual(game.pool[5]);
    expect(result.game.pool).toEqual(game.pool.filter((_, i) => i !== 5));
    expect(result.game.players[0]?.rack.at(-1)).toEqual(game.pool[5]);
    expect(parse(gameSchema, result.game).ok).toBe(true);
  });

  it('refuses a pick that is not a tile in the pool', () => {
    const game = newGame({ names, seed: 9 });
    for (const pick of [-1, game.pool.length, 1.5]) {
      expect(draw(game, pick)).toEqual({ ok: false, refusal: 'no-such-tile' });
    }
    const empty: Game = { ...layout([{ rack: ['red-9-a'] }, { rack: ['red-2-a'] }]), pool: [] };
    expect(draw(empty, 0)).toEqual({ ok: false, refusal: 'no-such-tile' });
  });

  it('is refused once the game is over', () => {
    const over = finish(layout([{ rack: [] }, { rack: ['red-1-a'] }]), 0, 'rack-emptied');
    expect(draw(over)).toEqual({ ok: false, refusal: 'game-over' });
  });
});

describe('scoring', () => {
  it('charges each loser their rack, joker 30, and pays the winner the sum', () => {
    const game = layout([
      { rack: [] },
      { rack: ['red-10-a', 'joker-a'] },
      { rack: ['blue-1-a', 'blue-2-a'] },
    ]);
    const over = finish(game, 0, 'rack-emptied');
    expect(over.status).toEqual({
      kind: 'over',
      reason: 'rack-emptied',
      winner: 0,
      scores: [43, -40, -3],
    });
  });
});

describe('a seat view', () => {
  const game = newGame({ names, seed: 5 });
  const view = seatView(game, 1);

  it('shows its own rack, the table and the counts', () => {
    expect(view.seat).toBe(1);
    expect(view.rack).toEqual(game.players[1]?.rack);
    expect(view.table).toEqual(game.table);
    expect(view.poolSize).toBe(game.pool.length);
    expect(view.opponents).toEqual([
      { seat: 0, name: 'Nora', tileCount: 14, hasMelded: false },
      { seat: 2, name: 'Bot B', tileCount: 14, hasMelded: false },
    ]);
  });

  it('holds no tile of another rack or of the pool', () => {
    const seen = JSON.stringify(view);
    const hidden = [
      ...(game.players[0]?.rack ?? []),
      ...(game.players[2]?.rack ?? []),
      ...game.pool,
    ];
    expect(hidden).toHaveLength(106 - 14);
    for (const tile of hidden) expect(seen).not.toContain(`"${tile.id}"`);
  });

  it('refuses a seat nobody sits in', () => {
    expect(() => seatView(game, 3)).toThrow(RangeError);
  });

  it('shows a tile on the table to everyone', () => {
    const laid = layout([{ rack: [] }, { rack: [] }], [['red-1-a', 'red-2-a', 'red-3-a']]);
    expect(JSON.stringify(seatView(laid, 1))).toContain(t('red-2-a').id);
  });
});
