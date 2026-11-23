import { levelSchema } from '@norikub/core/bot';
import { gameSchema } from '@norikub/core/game';
import type { Game } from '@norikub/core/game';
import { SINGLE, matchFits, matchSchema, newMatch } from '@norikub/core/match';
import { parse } from '@norikub/core/parse';
import { tileSchema } from '@norikub/core/tiles';
import { resumeTurn } from '@norikub/core/turn';
import { z } from 'zod';

import { whoSchema } from './cast.ts';
import { fitPile } from './pile.ts';
import { RACK_ROWS, reconcileRows } from './rack.ts';
import { FIRST_LINEUP, PERSON, botNames, fromGame, seatsFor } from './session.ts';
import type { Lineup, Session } from './session.ts';

const rowsSchema = z
  .array(z.array(z.string().min(1).nullable()).readonly())
  .length(RACK_ROWS)
  .readonly()
  .refine((rows) => rows.every((row) => row.length === rows[0]?.length && row.length > 0), {
    message: 'rack rows of different lengths',
  });

/**
 * What of a session is kept on the device so a reload resumes it (invariant 3). `version` is
 * bumped when the shape changes, so a game saved by an older build is migrated or refused by
 * name rather than misread.
 *
 * The turn in progress is its working rack and table and nothing more: the game it began from
 * is `game`, so it is not stored twice, and the two cannot disagree. Left out on purpose: the
 * notes, which are about the person's last action and there was none since the reload, and the
 * replay, which `Session` already says is only to watch (a reload mid-playback resumes at the
 * person's turn, the bots' turns already in `game`).
 */
const savedFields = {
  game: gameSchema,
  turn: z
    .object({
      rack: z.array(tileSchema).readonly(),
      table: z.array(z.array(tileSchema).readonly()).readonly(),
    })
    .readonly()
    .nullable(),
  rows: rowsSchema,
  startRows: rowsSchema,
  pile: z.array(z.number().int().min(0)).readonly(),
};

const levelsSchema = z.array(levelSchema).min(1).max(3).readonly();

const lineupSchema = z
  .array(z.object({ level: levelSchema, who: whoSchema }).readonly())
  .min(1)
  .max(3)
  .readonly();

/**
 * Version 2 adds the lineup, the level of each bot (KUB-41). A version 1 game was played
 * against the one bot there was, which is the medium one, and resumes against it.
 *
 * Version 3 adds the match (KUB-42). A game saved before it was one game on its own, and
 * resumes as one.
 *
 * Version 4 gives each bot a character (KUB-43). Whatever a game was saved with, its bots
 * resume as their levels' roster says (`seatsFor`) and are renamed for it: a game from before
 * characters, or from the day each seat picked any face, would otherwise show "Medium bot A", or
 * Tatum playing hard, beside the roster's faces.
 */
export const savedSchema = z.union([
  z
    .object({ version: z.literal(4), ...savedFields, lineup: lineupSchema, match: matchSchema })
    .readonly(),
  z
    .object({ version: z.literal(3), ...savedFields, lineup: levelsSchema, match: matchSchema })
    .readonly(),
  z.object({ version: z.literal(2), ...savedFields, lineup: levelsSchema }).readonly(),
  z.object({ version: z.literal(1), ...savedFields }).readonly(),
]);
export type Saved = z.infer<typeof savedSchema>;

export function toSaved(session: Session): Extract<Saved, { version: 4 }> {
  const { turn } = session;
  return {
    version: 4,
    lineup: session.lineup,
    match: session.match,
    game: session.game,
    turn: turn === null ? null : { rack: turn.rack, table: turn.table },
    rows: session.rows,
    startRows: session.startRows,
    pile: session.pile,
  };
}

/**
 * A session from what was on disk, or null when it is not a game this build can resume. A
 * turn that the engine will not take back as this game's (`resumeTurn`) is dropped and the
 * turn starts again from the game, which loses the person's rearranging but never a tile.
 */
export function fromSaved(input: unknown): Session | null {
  const parsed = parse(savedSchema, input);
  if (!parsed.ok) return null;
  const saved = parsed.value;
  const lineup = seatsFor(
    saved.version === 1
      ? FIRST_LINEUP.map((seat) => seat.level)
      : saved.lineup.map((seat) => (typeof seat === 'string' ? seat : seat.level)),
  );
  const game = named(saved.game, lineup);
  const match = 'match' in saved ? saved.match : newMatch(SINGLE);
  // A lineup or a match for another number of seats is not this game's: one of them was
  // written wrong, and resuming would score a game nobody played.
  const seats = game.players.length;
  if (lineup.length !== seats - 1 || !matchFits(match, seats)) return null;
  const sitting = { lineup, match };
  const turn =
    saved.turn === null || game.current !== PERSON
      ? null
      : resumeTurn(game, saved.turn.rack, saved.turn.table);
  if (turn === null) return fromGame(game, [], saved.startRows, [], saved.pile, sitting);
  return {
    game,
    turn,
    rows: reconcileRows(saved.rows, turn.rack, saved.startRows),
    startRows: reconcileRows(saved.startRows, turn.start.players[PERSON]?.rack ?? []),
    notes: [],
    replay: [],
    pile: fitPile(saved.pile, game.pool.length),
    ...sitting,
  };
}

/** The game with its bots' seats named for their characters; the person's seat keeps its name. */
function named(game: Game, lineup: Lineup): Game {
  const names = botNames(lineup);
  return {
    ...game,
    players: game.players.map((player, seat) =>
      seat === PERSON ? player : { ...player, name: names[seat - 1] ?? player.name },
    ),
  };
}
