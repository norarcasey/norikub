import { z } from 'zod';

import { seatView, statusSchema } from './game.ts';
import type { Game, SeatView } from './game.ts';
import { tileSchema } from './tiles.ts';
import { move } from './turn.ts';
import type { Move, MoveRefusal, Turn } from './turn.ts';

const tilesSchema = z.array(tileSchema).readonly();
const tableTilesSchema = z.array(tilesSchema).readonly();

/**
 * What a seat at a friends' table is shown, as the page parses it from the host. It is a
 * `SeatView` with one field more, `turn`, so a page that drew a seat view against the bots
 * draws this one the same way.
 */
export const turnViewSchema = z
  .object({
    seat: z.number().int().min(0),
    rack: tilesSchema,
    hasMelded: z.boolean(),
    table: tableTilesSchema,
    poolSize: z.number().int().min(0),
    current: z.number().int().min(0),
    opponents: z
      .array(
        z
          .object({
            seat: z.number().int().min(0),
            name: z.string(),
            tileCount: z.number().int().min(0),
            hasMelded: z.boolean(),
          })
          .readonly(),
      )
      .readonly(),
    status: statusSchema,
    /**
     * The turn being played, or null between turns. `began` is the table as the turn found
     * it: what a take-back returns to, and what the mover's page needs to run `move` itself
     * (a tile that began on the table never goes to a rack). It is no secret: every seat saw
     * that table as the turn began.
     */
    turn: z
      .object({ seat: z.number().int().min(0), began: tableTilesSchema })
      .readonly()
      .nullable(),
  })
  .readonly();
export type TurnView = z.infer<typeof turnViewSchema>;

/**
 * One seat's view of the game with the turn in progress (`docs/online.md`, "A turn is shared
 * while it is played"). Every seat sees the working table and how many tiles the mover holds
 * now, as at a real table where the board is reworked in front of everyone. Only the mover
 * sees the working rack. With no turn open it is `seatView` and `turn: null`.
 *
 * Built from `seatView` rather than beside it, so the one rule that keeps a rack out of a
 * view (invariant 2) is written once: the working rack replaces the mover's own rack only in
 * the mover's view, and every other seat gets a count.
 */
export function turnView(game: Game, turn: Turn | null, seat: number): TurnView {
  const view: SeatView = seatView(game, seat);
  if (turn === null) return { ...view, turn: null };
  // A turn over another game would put that game's rack in this one's view.
  if (turn.start !== game) throw new RangeError('the turn is not one of this game');
  return {
    ...view,
    rack: seat === turn.seat ? turn.rack : view.rack,
    table: turn.table,
    opponents: view.opponents.map((o) =>
      o.seat === turn.seat ? { ...o, tileCount: turn.rack.length } : o,
    ),
    turn: { seat: turn.seat, began: game.table },
  };
}

export type ViewMoveResult =
  | { readonly ok: true; readonly view: TurnView }
  | { readonly ok: false; readonly refusal: MoveRefusal };

/**
 * A move made on the mover's own view, by the engine's `move`: what the page shows at once
 * while the same move is on its way to the host, whose next view replaces it
 * (`docs/online.md`, "A turn is shared while it is played"). A seat whose turn it is not has
 * no tile it may move, so it is refused as a tile that is not there.
 */
export function moveInView(view: TurnView, m: Move): ViewMoveResult {
  if (view.status.kind !== 'playing' || view.current !== view.seat) {
    return { ok: false, refusal: { kind: 'no-such-tile', tileId: m.tileId } };
  }
  const began = view.turn?.began ?? view.table;
  const moved = move({ start: { table: began }, rack: view.rack, table: view.table }, m);
  if (!moved.ok) return moved;
  return {
    ok: true,
    view: {
      ...view,
      rack: moved.turn.rack,
      table: moved.turn.table,
      turn: { seat: view.seat, began },
    },
  };
}
