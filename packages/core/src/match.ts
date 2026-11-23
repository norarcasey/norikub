import { z } from 'zod';

import type { Status } from './game.ts';

/**
 * How long a sitting lasts, picked before the first deal (Nora, KUB-42): one game, a set number
 * of games, or games until someone's running total reaches a score. The bounds are the
 * setup's choices with room either side, so a saved match from a later build with a longer
 * list still reads back.
 */
export const matchFormatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single') }).readonly(),
  z.object({ kind: z.literal('games'), games: z.number().int().min(2).max(50) }).readonly(),
  z.object({ kind: z.literal('points'), target: z.number().int().min(1).max(10_000) }).readonly(),
]);
export type MatchFormat = z.infer<typeof matchFormatSchema>;

export const SINGLE: MatchFormat = { kind: 'single' };

/**
 * A match: its format and the scores of every game already finished and moved on from, one
 * row per game, one number per seat. The game being played, or just finished and still on
 * screen, is not in `played`: its scores are in its own `status`, and `standing` adds them, so
 * a finished game is counted once whether or not the next one has been dealt.
 */
export const matchSchema = z
  .object({
    format: matchFormatSchema,
    played: z.array(z.array(z.number().int()).readonly()).readonly(),
  })
  .readonly();
export type Match = z.infer<typeof matchSchema>;

export function newMatch(format: MatchFormat): Match {
  return { format, played: [] };
}

/**
 * The seat that plays first in the match's next game to be dealt: seat 0 in the first, then
 * one seat on per game, as the first player changes hands at a real table (KUB-44). Playing
 * first is a small edge, and over a match of several games it would otherwise always be one
 * player's.
 */
export function firstSeat(match: Match, seats: number): number {
  return match.played.length % seats;
}

/** True when every finished game has a score for each of `seats`, as a match for them must. */
export function matchFits(match: Match, seats: number): boolean {
  return match.played.every((scores) => scores.length === seats);
}

/**
 * Where the match stands with the current game's `status`. `game` is the number of the game
 * being played or just finished, from 1. `leaders` is every seat on the highest total: a match
 * that ends level is shared, not decided by seat.
 *
 * A points match ends after the game in which any total reaches the target, and is won by the
 * highest total then, which need not be the one that crossed first. The scores of a game sum to
 * zero (`finish`), so the target is only ever reached by winning games.
 */
export type Standing = {
  readonly over: boolean;
  readonly game: number;
  readonly totals: readonly number[];
  readonly leaders: readonly number[];
};

export function standing(match: Match, status: Status, seats: number): Standing {
  const results = status.kind === 'over' ? [...match.played, status.scores] : match.played;
  const totals = Array.from({ length: seats }, (_, seat) =>
    results.reduce((sum, scores) => sum + (scores[seat] ?? 0), 0),
  );
  const top = Math.max(...totals);
  const leaders = totals.flatMap((total, seat) => (total === top ? [seat] : []));
  return {
    over: status.kind === 'over' && ended(match.format, results.length, top),
    game: match.played.length + 1,
    totals,
    leaders,
  };
}

function ended(format: MatchFormat, finished: number, top: number): boolean {
  switch (format.kind) {
    case 'single':
      return true;
    case 'games':
      return finished >= format.games;
    case 'points':
      return top >= format.target;
  }
}

/**
 * The match once the finished game is moved on from, for the next deal: its scores join
 * `played`. Null while the game is still being played or once the match is over, when there is
 * no next game to deal.
 */
export function nextGameOf(match: Match, status: Status, seats: number): Match | null {
  if (status.kind !== 'over' || standing(match, status, seats).over) return null;
  return { ...match, played: [...match.played, status.scores] };
}
