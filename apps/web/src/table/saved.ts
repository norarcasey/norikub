import { gameSchema } from '@norikub/core/game';
import { parse } from '@norikub/core/parse';
import { tileSchema } from '@norikub/core/tiles';
import { resumeTurn } from '@norikub/core/turn';
import { z } from 'zod';

import { fitPile } from './pile.ts';
import { RACK_ROWS, reconcileRows } from './rack.ts';
import { PERSON, fromGame } from './session.ts';
import type { Session } from './session.ts';

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
export const savedSchema = z
  .object({
    version: z.literal(1),
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
  })
  .readonly();
export type Saved = z.infer<typeof savedSchema>;

export function toSaved(session: Session): Saved {
  const { turn } = session;
  return {
    version: 1,
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
  const { game } = saved;
  const turn =
    saved.turn === null || game.current !== PERSON
      ? null
      : resumeTurn(game, saved.turn.rack, saved.turn.table);
  if (turn === null) return fromGame(game, [], saved.startRows, [], saved.pile);
  return {
    game,
    turn,
    rows: reconcileRows(saved.rows, turn.rack, saved.startRows),
    startRows: reconcileRows(saved.startRows, turn.start.players[PERSON]?.rack ?? []),
    notes: [],
    replay: [],
    pile: fitPile(saved.pile, game.pool.length),
  };
}
