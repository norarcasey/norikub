import type { BotTurn } from '@norikub/core/bot';
import type { Game } from '@norikub/core/game';
import type { Tile } from '@norikub/core/tiles';
import { move, startTurn } from '@norikub/core/turn';

/**
 * One step of a bot's turn as the person watches it: the table and the tile counts at that
 * moment, and what just happened. A frame holds what anyone at the table could see and no
 * more, so a bot's rack never reaches the page (invariant 2's other half: the screen does not
 * show the person what the bot could not have shown them).
 */
export type Frame = {
  readonly seat: number;
  readonly name: string;
  readonly table: readonly (readonly Tile[])[];
  /** Tiles in each seat's rack, by seat. */
  readonly counts: readonly number[];
  readonly pool: number;
  readonly step:
    | { readonly kind: 'placed'; readonly tile: Tile }
    | { readonly kind: 'drew' }
    | { readonly kind: 'done'; readonly played: number };
};

const counts = (game: Game): number[] => game.players.map((player) => player.rack.length);

/**
 * The frames of one bot turn, from the game before it and what `takeBotTurn` returned. The
 * moves are replayed through the engine's own `move`, in the bot's order: the screen shows
 * what the engine did and judges nothing (invariant 1). The last frame is the table the
 * engine accepted. A refused proposal ended in a draw, so it is shown as one.
 */
export function framesOf(before: Game, result: BotTurn): Frame[] {
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
        pool: before.pool.length,
        step: { kind: 'placed', tile },
      });
    }
    const played = (before.players[seat]?.rack.length ?? 0) - turn.rack.length;
    frames.push({
      seat,
      name,
      table: result.game.table,
      counts: counts(result.game),
      pool: result.game.pool.length,
      step: { kind: 'done', played },
    });
    return frames;
  }
  return [
    {
      seat,
      name,
      table: result.game.table,
      counts: counts(result.game),
      pool: result.game.pool.length,
      step: { kind: 'drew' },
    },
  ];
}

function findOnTable(table: readonly (readonly Tile[])[], id: string): Tile | undefined {
  return table.flat().find((tile) => tile.id === id);
}
