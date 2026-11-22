import { z } from 'zod';

import { seededRandom, shuffle } from './random.ts';
import { TILE_COUNT, fullSet, rackPenalty, tileSchema } from './tiles.ts';
import type { Tile } from './tiles.ts';

export const RACK_SIZE = 14;
export const FIRST_MELD_POINTS = 30;

const tilesSchema = z.array(tileSchema).readonly();

export const playerSchema = z
  .object({ name: z.string().min(1), rack: tilesSchema, hasMelded: z.boolean() })
  .readonly();
export type Player = z.infer<typeof playerSchema>;

export const statusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('playing') }).readonly(),
  z
    .object({
      kind: z.literal('over'),
      reason: z.enum(['rack-emptied', 'pool-exhausted']),
      winner: z.number().int().min(0),
      scores: z.array(z.number().int()).readonly(),
    })
    .readonly(),
]);
export type Status = z.infer<typeof statusSchema>;

/**
 * The whole game as plain data, so it can be saved before it is shown and read back after a
 * reload (invariant 3). Reading one back checks more than its shape: every one of the 106
 * tiles exactly once, somewhere. A saved game that lost or doubled a tile still parses as
 * JSON and still renders, and the game played from it is not the one that was saved.
 */
export const gameSchema = z
  .object({
    players: z.array(playerSchema).min(2).max(4).readonly(),
    table: z.array(tilesSchema).readonly(),
    pool: tilesSchema,
    current: z.number().int().min(0),
    // Draws in a row while the pool was empty; a full round of them ends the game.
    passes: z.number().int().min(0),
    status: statusSchema,
  })
  .readonly()
  .superRefine((game, ctx) => {
    if (game.current >= game.players.length) {
      ctx.addIssue({ code: 'custom', path: ['current'], message: 'no such seat' });
    }
    const ids = [
      ...game.players.flatMap((player) => player.rack),
      ...game.table.flat(),
      ...game.pool,
    ].map((tile) => tile.id);
    const expected = new Set(fullSet().map((tile) => tile.id));
    if (ids.length !== TILE_COUNT || new Set(ids).size !== TILE_COUNT) {
      ctx.addIssue({ code: 'custom', message: `expected ${TILE_COUNT} distinct tiles` });
    } else if (ids.some((id) => !expected.has(id))) {
      ctx.addIssue({ code: 'custom', message: 'a tile that is not in the box' });
    }
  });
export type Game = z.infer<typeof gameSchema>;

export type NewGame = { readonly names: readonly string[]; readonly seed: number };

export function newGame({ names, seed }: NewGame): Game {
  const deck = shuffle(fullSet(), seededRandom(seed));
  const players = names.map((name, seat) => ({
    name,
    rack: deck.slice(seat * RACK_SIZE, (seat + 1) * RACK_SIZE),
    hasMelded: false,
  }));
  return {
    players,
    table: [],
    pool: deck.slice(names.length * RACK_SIZE),
    current: 0,
    passes: 0,
    status: { kind: 'playing' },
  };
}

export type DrawResult =
  | { readonly ok: true; readonly game: Game; readonly drawn: Tile | null }
  | { readonly ok: false; readonly refusal: 'game-over' };

/**
 * The alternative to playing: take one tile from the pool and pass the turn. With the pool
 * empty it is a pass, and once every player has passed in a row nobody can play, so the game
 * ends on the lowest rack.
 */
export function draw(game: Game): DrawResult {
  if (game.status.kind !== 'playing') return { ok: false, refusal: 'game-over' };
  const drawn = game.pool.at(-1);
  if (drawn === undefined) {
    const passes = game.passes + 1;
    const next = { ...game, passes, current: nextSeat(game) };
    if (passes < game.players.length) return { ok: true, game: next, drawn: null };
    return { ok: true, game: finish(next, lowestRack(next), 'pool-exhausted'), drawn: null };
  }
  const players = game.players.map((player, seat) =>
    seat === game.current ? { ...player, rack: [...player.rack, drawn] } : player,
  );
  return {
    ok: true,
    game: { ...game, players, pool: game.pool.slice(0, -1), passes: 0, current: nextSeat(game) },
    drawn,
  };
}

export function nextSeat(game: Game): number {
  return (game.current + 1) % game.players.length;
}

/** The lowest rack by points; a tie goes to the fewer tiles, then to the earlier seat. */
function lowestRack(game: Game): number {
  let best = 0;
  game.players.forEach((player, seat) => {
    const leader = game.players[best];
    if (leader === undefined) return;
    const a = rackPenalty(player.rack);
    const b = rackPenalty(leader.rack);
    if (a < b || (a === b && player.rack.length < leader.rack.length)) best = seat;
  });
  return best;
}

/**
 * Scoring by tiles left, joker 30: each loser scores minus what is in their rack, and the
 * winner scores the sum of those. The scores sum to zero, so a running total over many games
 * stays honest. A winner on an empty pool keeps tiles too; they cost the winner nothing.
 */
export function finish(
  game: Game,
  winner: number,
  reason: 'rack-emptied' | 'pool-exhausted',
): Game {
  const penalties = game.players.map((player) => rackPenalty(player.rack));
  const total = penalties.reduce((sum, p) => sum + p, 0);
  const scores = penalties.map((p, seat) => (seat === winner ? total - p : -p));
  return { ...game, status: { kind: 'over', reason, winner, scores } };
}

export type Opponent = {
  readonly seat: number;
  readonly name: string;
  readonly tileCount: number;
  readonly hasMelded: boolean;
};

/**
 * What one seat may see: its own rack, the table, how many tiles everyone else holds and how
 * many are left in the pool. This is all a bot is ever handed (invariant 2), so a bot cannot
 * peek even by accident: the other racks and the pool are not in the object.
 */
export type SeatView = {
  readonly seat: number;
  readonly rack: readonly Tile[];
  readonly hasMelded: boolean;
  readonly table: readonly (readonly Tile[])[];
  readonly poolSize: number;
  readonly current: number;
  readonly opponents: readonly Opponent[];
  readonly status: Status;
};

export function seatView(game: Game, seat: number): SeatView {
  const me = game.players[seat];
  if (me === undefined) throw new RangeError(`no seat ${seat}`);
  return {
    seat,
    rack: me.rack,
    hasMelded: me.hasMelded,
    table: game.table,
    poolSize: game.pool.length,
    current: game.current,
    opponents: game.players.flatMap((player, s) =>
      s === seat
        ? []
        : [
            {
              seat: s,
              name: player.name,
              tileCount: player.rack.length,
              hasMelded: player.hasMelded,
            },
          ],
    ),
    status: game.status,
  };
}
