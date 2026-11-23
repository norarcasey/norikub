import { z } from 'zod';

import { botFor, levelSchema, takeBotTurn } from './bot.ts';
import type { Bot, Level } from './bot.ts';
import { drawRefusalSchema, gameSchema, newGame } from './game.ts';
import type { Game } from './game.ts';
import { seededRandom } from './random.ts';
import { tileSchema } from './tiles.ts';
import { drawInstead, endTurn, move, resumeTurn, startTurn } from './turn.ts';
import { moveRefusalSchema, moveSchema, turnFaultSchema } from './turn.ts';
import type { Move, Turn } from './turn.ts';
import { turnView, turnViewSchema } from './view.ts';

export const MIN_SEATS = 2;
export const MAX_SEATS = 4;

/**
 * A friends' table: the names in the order they sat down, and once dealt the game and the
 * turn in progress. A seat is its place in `names`. The secret that proves a device holds a
 * seat is the host's and never part of a table (`docs/online.md`, as in Hanora).
 *
 * The turn is kept as its working rack and table alone, over the game it began from, and is
 * read back through `resumeTurn`, which judges it as strictly as a move: a stored table is
 * whatever was in storage. Null means no tile has moved this turn, or it was taken back.
 */

/** What a friend types as their name, as in Hanora: trimmed, 1–24, no control characters. */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(24)
  .regex(/^[^\p{Cc}]*$/u);

const tilesSchema = z.array(tileSchema).readonly();
const workingSchema = z
  .object({ rack: tilesSchema, table: z.array(tilesSchema).readonly() })
  .readonly();

/**
 * A seat the first player gave to a bot before the deal (`KUB-36`), and how hard it plays. The
 * host plays it with that seat's view alone (invariant 2); it has no token, so no device can
 * speak for it.
 */
export const botSeatSchema = z
  .object({ seat: z.number().int().min(0), level: levelSchema })
  .readonly();
export type BotSeat = z.infer<typeof botSeatSchema>;

// A table stored before bots could sit at one has none, which is what it had.
const botsSchema = z.array(botSeatSchema).max(MAX_SEATS).readonly().default([]);

export const tableSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('seating'),
      names: z.array(displayNameSchema).max(MAX_SEATS).readonly(),
      bots: botsSchema,
    })
    .readonly(),
  z
    .object({
      phase: z.literal('playing'),
      names: z.array(displayNameSchema).min(MIN_SEATS).max(MAX_SEATS).readonly(),
      bots: botsSchema,
      game: gameSchema,
      working: workingSchema.nullable(),
    })
    .readonly(),
  /**
   * Called off by a seated player (`KUB-52`), before the deal or mid-game, and for good: the
   * code names this table and no other, so it refuses every later seat, deal and move rather
   * than becoming a fresh table that a stale link would seat someone at.
   */
  z
    .object({
      phase: z.literal('cancelled'),
      names: z.array(displayNameSchema).max(MAX_SEATS).readonly(),
      bots: botsSchema,
      by: z.number().int().min(0),
    })
    .readonly(),
]);
export type Table = z.infer<typeof tableSchema>;

export const tableRefusalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('table-full') }).readonly(),
  z.object({ kind: z.literal('already-dealt') }).readonly(),
  z.object({ kind: z.literal('not-dealt') }).readonly(),
  z.object({ kind: z.literal('waiting-for-players') }).readonly(),
  z.object({ kind: z.literal('only-the-first-seat-deals') }).readonly(),
  /** Bots are seated by the one who deals, as the dealer sets the table (`KUB-36`). */
  z.object({ kind: z.literal('only-the-first-seat-adds-bots') }).readonly(),
  z.object({ kind: z.literal('no-such-seat') }).readonly(),
  /** Taking a bot off a seat a person holds, or no one (`KUB-54`). */
  z.object({ kind: z.literal('not-a-bot') }).readonly(),
  z.object({ kind: z.literal('not-your-turn') }).readonly(),
  z.object({ kind: z.literal('game-over') }).readonly(),
  z.object({ kind: z.literal('cancelled') }).readonly(),
  /** A vote to draw for an away seat when no turn is held up long enough to ask (`KUB-37`). */
  z.object({ kind: z.literal('no-away-turn') }).readonly(),
]);
export type TableRefusal = z.infer<typeof tableRefusalSchema>;

/** Why a turn message was refused: the table's own reasons, or the engine's, unchanged. */
export const refusalSchema = z.discriminatedUnion('kind', [
  /** A socket frame that does not parse as a message at all; the host's, never `apply`'s. */
  z.object({ kind: z.literal('not-a-message') }).readonly(),
  z.object({ kind: z.literal('table'), refusal: tableRefusalSchema }).readonly(),
  z.object({ kind: z.literal('move'), refusal: moveRefusalSchema }).readonly(),
  z.object({ kind: z.literal('end-turn'), faults: z.array(turnFaultSchema).readonly() }).readonly(),
  z.object({ kind: z.literal('draw'), refusal: drawRefusalSchema }).readonly(),
]);
export type Refusal = z.infer<typeof refusalSchema>;

export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly refusal: Refusal };

const refused = (refusal: TableRefusal): { ok: false; refusal: Refusal } => ({
  ok: false,
  refusal: { kind: 'table', refusal },
});

export function newTable(): Table {
  return { phase: 'seating', names: [], bots: [] };
}

/** The next seat, for a name already parsed with `displayNameSchema`. */
export function sitDown(table: Table, name: string): Outcome<{ table: Table; seat: number }> {
  if (table.phase === 'cancelled') return refused({ kind: 'cancelled' });
  if (table.phase !== 'seating') return refused({ kind: 'already-dealt' });
  if (table.names.length >= MAX_SEATS) return refused({ kind: 'table-full' });
  const names = [...table.names, name];
  return { ok: true, value: { seat: table.names.length, table: { ...table, names } } };
}

/**
 * The first seat gives the next empty seat to a bot, before the deal (`KUB-36`). `name` is
 * who it plays as, which the page picks from the bots' cast as the device game does; the
 * rules know only its level. It takes a seat as a friend sitting down would, so a friend who
 * comes after it sits in the seat after it.
 */
export function addBot(table: Table, seat: number, level: Level, name: string): Outcome<Table> {
  if (table.phase === 'seating' && seat !== 0) {
    return refused({ kind: 'only-the-first-seat-adds-bots' });
  }
  const sat = sitDown(table, name);
  if (!sat.ok) return sat;
  const bots = [...table.bots, { seat: sat.value.seat, level }];
  return { ok: true, value: { ...sat.value.table, bots } };
}

/**
 * The first seat takes the bot in `botSeat` off the table again, before the deal (`KUB-54`),
 * for a level tapped by mistake. Every seat after it moves up one, friends' and bots' alike:
 * allowing only the last seat to go would refuse the usual case, a bot added before a friend
 * sat down after it. Before the deal a seat number is nothing but a place in `names`: no game,
 * no turn and no stall holds one, so renumbering moves nothing else in the table. The host
 * moves its tokens and open sockets with it (`room.ts`, `removeBotFromRoom`).
 */
export function removeBot(table: Table, seat: number, botSeat: number): Outcome<Table> {
  if (table.phase === 'cancelled') return refused({ kind: 'cancelled' });
  if (table.phase !== 'seating') return refused({ kind: 'already-dealt' });
  if (seat !== 0) return refused({ kind: 'only-the-first-seat-adds-bots' });
  if (botAt(table, botSeat) === null) return refused({ kind: 'not-a-bot' });
  const names = table.names.filter((_, at) => at !== botSeat);
  const bots = table.bots.flatMap((bot) => {
    if (bot.seat === botSeat) return [];
    return [bot.seat > botSeat ? { ...bot, seat: bot.seat - 1 } : bot];
  });
  return { ok: true, value: { ...table, names, bots } };
}

/** The level of the bot in `seat`, or null when a person sits there. */
export function botAt(table: Table, seat: number): Level | null {
  return table.bots.find((bot) => bot.seat === seat)?.level ?? null;
}

/**
 * One bot's turn, as the host tells it: the table after it, the bot's moves for each page's
 * playback (`KUB-17`), empty when it drew, and where it drew from, as `apply` reports a draw.
 */
export type BotPlayed = {
  readonly table: Table;
  readonly seat: number;
  readonly moves: readonly Move[];
  readonly drew: Drew | null;
};

/**
 * The turn of the bot whose turn it is, or null when it is nobody's or a person's. It is the
 * device game's own call, `takeBotTurn`, which hands the bot its seat's `seatView` and nothing
 * more (invariant 2) and puts what it proposes through the engine (invariant 1). `botOf` is
 * there for the test that watches what a bot is handed.
 *
 * A bot's turn opens no working turn: it decides at once, so nothing of it is stored half-done.
 */
export function botTurn(table: Table, botOf: (level: Level) => Bot = botFor): BotPlayed | null {
  if (table.phase !== 'playing' || table.game.status.kind !== 'playing') return null;
  const { game } = table;
  const seat = game.current;
  const level = botAt(table, seat);
  if (level === null) return null;
  const result = takeBotTurn(game, botOf(level));
  const next: Table = { ...table, game: result.game, working: null };
  if (result.accepted && result.proposal.kind === 'play') {
    return { table: next, seat, moves: result.proposal.moves, drew: null };
  }
  // A bot draws the pool's last tile, as `draw` does with no pick; an empty pool is a pass.
  const passed = result.game.pool.length === game.pool.length;
  const drew = { seat, drewAt: passed ? null : game.pool.length - 1 };
  return { table: next, seat, moves: [], drew };
}

/**
 * The first seat deals once two or more are seated, and deals again for the same seats when a
 * game is over. `seed` is the host's, fresh from `crypto.getRandomValues`, neither stored nor
 * sent: the dealt pool is in the game, and a seat that knew the seed could work out the pool.
 *
 * Who plays first is a random seat, so sitting down first is no advantage. It and the shuffle
 * are two draws from one generator rather than the shuffle's seed itself, so the first seat,
 * which every seat is shown, says nothing about where any tile lies.
 */
export function deal(table: Table, seat: number, seed: number): Outcome<Table> {
  if (table.phase === 'cancelled') return refused({ kind: 'cancelled' });
  if (table.phase === 'playing' && table.game.status.kind === 'playing') {
    return refused({ kind: 'already-dealt' });
  }
  if (seat !== 0) return refused({ kind: 'only-the-first-seat-deals' });
  if (table.names.length < MIN_SEATS) return refused({ kind: 'waiting-for-players' });
  const random = seededRandom(seed);
  const first = Math.floor(random() * table.names.length);
  const game = newGame({ names: table.names, seed: Math.floor(random() * 2 ** 32), first });
  const { names, bots } = table;
  return { ok: true, value: { phase: 'playing', names, bots, game, working: null } };
}

/**
 * Any seated player calls the table off, for everyone at it (Nora, `KUB-52`): before the deal,
 * mid-game or between games. Not the first seat alone, though it deals: friends who have
 * stopped playing should not need the one who started the table to be there to end it.
 */
export function cancel(table: Table, seat: number): Outcome<Table> {
  if (table.phase === 'cancelled') return refused({ kind: 'cancelled' });
  if (table.names[seat] === undefined) return refused({ kind: 'no-such-seat' });
  const { names, bots } = table;
  return { ok: true, value: { phase: 'cancelled', names, bots, by: seat } };
}

/** The four messages that are a turn being played; only the seat whose turn it is sends them. */
export const turnMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), move: moveSchema }).readonly(),
  z.object({ type: z.literal('take-back') }).readonly(),
  z.object({ type: z.literal('end-turn') }).readonly(),
  /** `pick` is a place in the pool; null takes the last tile, or passes on an empty pool. */
  z.object({ type: z.literal('draw'), pick: z.number().int().min(0).nullable() }).readonly(),
]);
export type TurnMessage = z.infer<typeof turnMessageSchema>;

/**
 * Where a draw took its tile from, for every seat (`docs/online.md`, "Drawing by pick"):
 * a place in the pool says nothing about the tile there. Null when the pool was empty and the
 * draw was a pass.
 */
export type Drew = { readonly seat: number; readonly drewAt: number | null };

export type Applied = { readonly table: Table; readonly drew: Drew | null };

/**
 * A turn message from `seat`, which is the host's word for who sent it. Anything from a seat
 * whose turn it is not is refused before the engine sees it; the rest is the engine's own
 * `move`, `takeBack`, `endTurn` and `drawInstead`, and its refusals are passed on unchanged.
 */
export function apply(table: Table, seat: number, message: TurnMessage): Outcome<Applied> {
  if (table.phase === 'cancelled') return refused({ kind: 'cancelled' });
  if (table.phase !== 'playing') return refused({ kind: 'not-dealt' });
  const { game } = table;
  if (game.players[seat] === undefined) return refused({ kind: 'no-such-seat' });
  if (game.status.kind !== 'playing') return refused({ kind: 'game-over' });
  if (seat !== game.current) return refused({ kind: 'not-your-turn' });
  const turn = turnOf(table);
  const at = (next: Game): Table => ({ ...table, game: next, working: null });

  switch (message.type) {
    case 'move': {
      const moved = move(turn, message.move);
      if (!moved.ok) return { ok: false, refusal: { kind: 'move', refusal: moved.refusal } };
      const working = { rack: moved.turn.rack, table: moved.turn.table };
      return { ok: true, value: { table: { ...table, working }, drew: null } };
    }
    // `takeBack` is `startTurn` of the game the turn began from, which is no working turn.
    case 'take-back':
      return { ok: true, value: { table: { ...table, working: null }, drew: null } };
    case 'end-turn': {
      const ended = endTurn(turn);
      if (!ended.ok) return { ok: false, refusal: { kind: 'end-turn', faults: ended.faults } };
      return { ok: true, value: { table: at(ended.game), drew: null } };
    }
    case 'draw': {
      const drawn = drawInstead(turn, message.pick ?? undefined);
      if (!drawn.ok) return { ok: false, refusal: { kind: 'draw', refusal: drawn.refusal } };
      const drewAt = drawn.drawn === null ? null : (message.pick ?? game.pool.length - 1);
      return { ok: true, value: { table: at(drawn.game), drew: { seat, drewAt } } };
    }
  }
}

/**
 * The turn in progress. A stored working rack and table that `resumeTurn` will not accept
 * cannot have been written by `apply`; the turn starts over from the game rather than
 * putting a doubled or vanished tile on everyone's screen.
 */
export function turnOf(table: Extract<Table, { phase: 'playing' }>): Turn {
  const { game, working } = table;
  if (working === null) return startTurn(game);
  return resumeTurn(game, working.rack, working.table) ?? startTurn(game);
}

export const tableViewSchema = z.discriminatedUnion('phase', [
  z
    .object({
      phase: z.literal('seating'),
      you: z.number().int().min(0),
      names: z.array(z.string()).readonly(),
      bots: botsSchema,
    })
    .readonly(),
  z
    .object({
      phase: z.literal('playing'),
      you: z.number().int().min(0),
      names: z.array(z.string()).readonly(),
      bots: botsSchema,
      view: turnViewSchema,
    })
    .readonly(),
  z
    .object({
      phase: z.literal('cancelled'),
      you: z.number().int().min(0),
      names: z.array(z.string()).readonly(),
      bots: botsSchema,
      by: z.number().int().min(0),
    })
    .readonly(),
]);
export type TableView = z.infer<typeof tableViewSchema>;

/**
 * What `seat` is sent of the table. Before the deal nothing is secret; after, `turnView`.
 * Which seats are bots is no secret either: the page shows them as bots and never as away.
 */
export function tableViewFor(table: Table, seat: number): TableView {
  const { names, bots } = table;
  if (table.phase === 'seating') return { phase: 'seating', you: seat, names, bots };
  if (table.phase === 'cancelled') {
    return { phase: 'cancelled', you: seat, names, bots, by: table.by };
  }
  const open = table.working !== null && table.game.status.kind === 'playing';
  const turn = open ? turnOf(table) : null;
  return {
    phase: 'playing',
    you: seat,
    names,
    bots,
    view: turnView(table.game, turn, seat),
  };
}
