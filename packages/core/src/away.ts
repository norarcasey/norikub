import { z } from 'zod';

import { drawInstead, startTurn } from './turn.ts';
import type { Applied, Outcome, Table } from './table.ts';

/**
 * A player who is away does not hold up the table (`KUB-37`, Nora's choice, 22 Nov 2026).
 *
 * There is no turn limit and no bot stands in. Once the seat whose turn it is has been away
 * for `AWAY_TURN_MS`, every other seat that is here is asked _"Draw a tile for <name>?"_; when
 * every one of them has said yes, the away seat's working turn is taken back, never judged,
 * and it draws, exactly as if it had pressed Draw (`drawInstead`). A seat that comes back
 * before then plays its own turn and the question goes away.
 *
 * These are rules, so they are the core's (invariant 1): the host only says who is here and
 * what time it is. Presence and time are not part of a `Table`, so the stall is kept beside
 * it, by the host, in the same stored row.
 */

/**
 * A minute: the real game's whole turn. The clock starts when the turn reaches a seat that is
 * away or the seat goes away during its turn, whichever is later, so a player who stepped
 * out during the others' turns is still given the minute. A phone that loses signal is only
 * known to be away 50–65 s later (`docs/online.md`, "Who is here"), so for it the question
 * comes about two minutes after it went.
 */
export const AWAY_TURN_MS = 60_000;

/** The seat whose turn is held up, since when (ms), and who has said yes to drawing for it. */
export const stallSchema = z
  .object({
    seat: z.number().int().min(0),
    since: z.number(),
    yes: z.array(z.number().int().min(0)).readonly(),
  })
  .readonly();
export type Stall = z.infer<typeof stallSchema>;

/** What every seat is told: whose turn may be drawn for, who is asked, who has said yes. */
export const awayOfferSchema = z
  .object({
    seat: z.number().int().min(0),
    voters: z.array(z.number().int().min(0)).readonly(),
    yes: z.array(z.number().int().min(0)).readonly(),
  })
  .readonly();
export type AwayOffer = z.infer<typeof awayOfferSchema>;

/** `here[seat]` is true while some device is connected to that seat. */
export type Here = readonly boolean[];

/**
 * The stall as things stand: none unless a game is being played and the seat whose turn it is
 * has no device here; the same one while that goes on; a fresh one from `now` otherwise.
 */
function reckon(table: Table, stall: Stall | null, here: Here, now: number): Stall | null {
  if (table.phase !== 'playing' || table.game.status.kind !== 'playing') return null;
  const seat = table.game.current;
  if (here[seat] === true) return null;
  if (stall !== null && stall.seat === seat) return stall;
  return { seat, since: now, yes: [] };
}

/**
 * The question, once it is open: the stall has lasted `AWAY_TURN_MS` and someone is here to
 * be asked. Every seat that is here is asked, and only they: a vote from a seat that has since
 * gone away no longer counts, and its absence does not hold the others up.
 */
export function awayOffer(stall: Stall | null, here: Here, now: number): AwayOffer | null {
  if (stall === null || now - stall.since < AWAY_TURN_MS) return null;
  const voters = here.flatMap((isHere, seat) => (isHere && seat !== stall.seat ? [seat] : []));
  if (voters.length === 0) return null;
  return { seat: stall.seat, voters, yes: stall.yes.filter((seat) => voters.includes(seat)) };
}

export type Settled = {
  readonly table: Table;
  readonly stall: Stall | null;
  /** The draw made for the away seat, as `apply` reports one; null when none was made. */
  readonly drew: Applied['drew'];
};

/**
 * The table after presence, time or the turn changed: the stall reckoned again and, if every
 * seat asked has said yes, the draw made. It is also carried when the last one who had not
 * said yes goes away, since everyone still here has agreed.
 */
export function settleAway(table: Table, stall: Stall | null, here: Here, now: number): Settled {
  const reckoned = reckon(table, stall, here, now);
  const offer = awayOffer(reckoned, here, now);
  if (table.phase !== 'playing' || offer === null) {
    return { table, stall: reckoned, drew: null };
  }
  if (!offer.voters.every((seat) => offer.yes.includes(seat))) {
    return { table, stall: reckoned, drew: null };
  }
  const { game } = table;
  const drawn = drawInstead(startTurn(game));
  // `reckon` opens no stall on a game that is over, and that is `draw`'s only refusal.
  if (!drawn.ok) return { table, stall: reckoned, drew: null };
  const next: Table = { ...table, game: drawn.game, working: null };
  const drewAt = drawn.drawn === null ? null : game.pool.length - 1;
  return {
    table: next,
    // The next seat may be away too: its own minute starts now.
    stall: reckon(next, null, here, now),
    drew: { seat: offer.seat, drewAt },
  };
}

/**
 * A seat's answer to the question. Yes counts it in; no takes back a yes it gave. Refused
 * when the question is not open to that seat: nobody's turn is held up long enough, or the
 * seat is not one of those asked.
 */
export function voteAway(
  table: Table,
  stall: Stall | null,
  here: Here,
  now: number,
  seat: number,
  yes: boolean,
): Outcome<Settled> {
  if (table.phase === 'cancelled') {
    return { ok: false, refusal: { kind: 'table', refusal: { kind: 'cancelled' } } };
  }
  const reckoned = reckon(table, stall, here, now);
  const offer = awayOffer(reckoned, here, now);
  if (reckoned === null || offer === null || !offer.voters.includes(seat)) {
    return { ok: false, refusal: { kind: 'table', refusal: { kind: 'no-away-turn' } } };
  }
  const others = reckoned.yes.filter((s) => s !== seat);
  const voted: Stall = { ...reckoned, yes: yes ? [...others, seat] : others };
  return { ok: true, value: settleAway(table, voted, here, now) };
}
