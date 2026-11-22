import type { BotTurn } from '@norikub/core/bot';
import type { Game } from '@norikub/core/game';
import type { Tile } from '@norikub/core/tiles';
import { move, startTurn } from '@norikub/core/turn';

import { takeFromPile } from './pile.ts';
import type { Pile } from './pile.ts';

/**
 * One step of a turn as the person watches it: the table and the tile counts at that moment,
 * and what just happened. A frame holds what the person could see at the table and no more,
 * so a bot's rack, or the tile a bot drew, never reaches the page (invariant 2's other half:
 * the screen does not show the person what the bot could not have shown them).
 */
export type Frame = {
  readonly seat: number;
  readonly name: string;
  readonly table: readonly (readonly Tile[])[];
  /** Tiles in each seat's rack, by seat. */
  readonly counts: readonly number[];
  /** The face-down tiles' spots at that moment; how many there are is the pool's size. */
  readonly pile: Pile;
  readonly step: Step;
};

/**
 * A draw is two frames: `drawing`, while a face-down tile travels from its place in the pool
 * (`pick`) and the counts are still those before it, then `drew`, once it has landed. `face`
 * is the tile drawn, and is only ever set when the person drew it.
 */
export type Step =
  | { readonly kind: 'placed'; readonly tile: Tile }
  | { readonly kind: 'drawing'; readonly pick: number; readonly face: Tile | null }
  | { readonly kind: 'drew'; readonly face: Tile | null }
  | { readonly kind: 'passed' }
  | { readonly kind: 'done'; readonly played: number };

const counts = (game: Game): number[] => game.players.map((player) => player.rack.length);

/**
 * The frames of a draw, from the game before it and after it. `face` is passed only for the
 * person's own draw. A pass, with the pool empty, has no tile to show travelling: it is one
 * `passed` frame.
 */
export function drawFrames(
  before: Game,
  after: Game,
  pick: number,
  face: Tile | null,
  pile: Pile,
): Frame[] {
  const seat = before.current;
  const name = before.players[seat]?.name ?? '';
  const passed = after.pool.length === before.pool.length;
  const landed: Frame = {
    seat,
    name,
    table: after.table,
    counts: counts(after),
    pile: passed ? pile : takeFromPile(pile, pick),
    step: passed ? { kind: 'passed' } : { kind: 'drew', face },
  };
  if (passed) return [landed];
  return [
    {
      seat,
      name,
      table: before.table,
      counts: counts(before),
      pile,
      step: { kind: 'drawing', pick, face },
    },
    landed,
  ];
}

/**
 * The frames of one bot turn, from the game before it and what `takeBotTurn` returned. The
 * moves are replayed through the engine's own `move`, in the bot's order: the screen shows
 * what the engine did and judges nothing (invariant 1). The last frame is the table the
 * engine accepted. A refused proposal ended in a draw, so it is shown as one. A bot draws the
 * pool's last tile (core `draw` with no pick), so that is the one shown leaving. `pile` is
 * the pile before the turn; the last frame's is the pile after it.
 */
export function framesOf(before: Game, result: BotTurn, pile: Pile): Frame[] {
  const seat = before.current;
  const name = before.players[seat]?.name ?? '';
  const frames: Frame[] = [];
  const { proposal } = result;
  if (proposal.kind === 'play' && result.accepted) {
    let turn = startTurn(before);
    for (const m of proposal.moves) {
      const moved = move(turn, m);
      if (!moved.ok) break;
      const tile = turn.rack.find((t) => t.id === m.tileId) ?? findOnTable(turn.table, m.tileId);
      turn = moved.turn;
      if (tile === undefined) continue;
      const now = counts(before);
      now[seat] = turn.rack.length;
      frames.push({
        seat,
        name,
        table: turn.table,
        counts: now,
        pile,
        step: { kind: 'placed', tile },
      });
    }
    const played = (before.players[seat]?.rack.length ?? 0) - turn.rack.length;
    frames.push({
      seat,
      name,
      table: result.game.table,
      counts: counts(result.game),
      pile,
      step: { kind: 'done', played },
    });
    return frames;
  }
  return drawFrames(before, result.game, before.pool.length - 1, null, pile);
}

function findOnTable(table: readonly (readonly Tile[])[], id: string): Tile | undefined {
  return table.flat().find((tile) => tile.id === id);
}
