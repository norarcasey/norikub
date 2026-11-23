import type { Status } from '@norikub/core/game';
import { rackPenalty } from '@norikub/core/tiles';
import type { Tile } from '@norikub/core/tiles';
import type { Move, MoveRefusal } from '@norikub/core/turn';

import type { Who } from './cast.ts';
import type { DropTarget } from './drag.ts';
import { fitPile } from './pile.ts';
import type { Pile } from './pile.ts';
import type { RackRows } from './rack.ts';
import type { Frame } from './replay.ts';
import { PERSON, drawTile, finishTurn, moveTile, moveTiles, probe, undoTurn } from './session.ts';
import type { Note, Played, RackSpot, Session } from './session.ts';

/**
 * What the table screen draws: one seat's sight of the game and nothing more. The bot game
 * makes it from its whole session (`boardOf`); a friends' table makes it from the view the
 * host sent that seat (`online/friends.ts`), which never holds another rack or the pool
 * (invariant 2). The screen cannot show what a board does not carry, so it reads no `Game`.
 */
export type Board = {
  /** The seat this screen plays from. */
  readonly you: number;
  readonly names: readonly string[];
  /** Tiles in each seat's rack, by seat, as the table stands now. */
  readonly counts: readonly number[];
  readonly table: readonly (readonly Tile[])[];
  readonly rack: readonly Tile[];
  /** The table as your turn found it, while it is your turn to play; null otherwise. */
  readonly began: readonly (readonly Tile[])[] | null;
  readonly current: number;
  readonly poolSize: number;
  /** The face-down tiles' spots, one per tile in the pool (KUB-25). */
  readonly pile: Pile;
  readonly status: Status;
  /** Points left in each rack once the game is over, by seat; null where this seat cannot know. */
  readonly left: readonly (number | null)[];
  readonly rows: RackRows;
  readonly notes: readonly Note[];
  /** The other players' turns since this seat's last one, for the status line to open (KUB-53). */
  readonly round: readonly Played[];
  readonly replay: readonly Frame[];
  /**
   * Seats with no device connected, by seat (`KUB-35`): away, never gone. Only a friends'
   * table has anyone away; the bots are always here.
   */
  readonly away: readonly boolean[];
  /**
   * The face drawn beside each seat's name, by seat (`KUB-43`): a bot's character, null for a
   * person. Only the bots have faces.
   */
  readonly faces: readonly (Who | null)[];
};

/** What the screen can ask for. Each goes to the engine, never decided by the screen. */
export type Actions = {
  /** What the engine would say to a move, without making it: used while a tile is dragged. */
  readonly probe: (m: Move) => MoveRefusal | null;
  readonly place: (m: Move, spot?: RackSpot) => void;
  readonly send: (tileIds: readonly string[], target: DropTarget) => void;
  readonly takeBack: () => void;
  readonly endTurn: () => void;
  /** A face-down tile by its place in the pool; none passes on an empty pool. */
  readonly draw: (pick?: number) => void;
};

export function boardOf(session: Session): Board {
  const { game, turn } = session;
  return {
    you: PERSON,
    names: game.players.map((player) => player.name),
    counts: game.players.map((player) => player.rack.length),
    table: turn?.table ?? game.table,
    rack: turn?.rack ?? game.players[PERSON]?.rack ?? [],
    began: turn?.start.table ?? null,
    current: game.current,
    poolSize: game.pool.length,
    pile: fitPile(session.pile, game.pool.length),
    status: game.status,
    left: game.players.map((player) => rackPenalty(player.rack)),
    rows: session.rows,
    notes: session.notes,
    round: session.round,
    replay: session.replay,
    away: game.players.map(() => false),
    faces: game.players.map((_, seat) =>
      seat === PERSON ? null : (session.lineup[seat - 1]?.who ?? null),
    ),
  };
}

export function sessionActions(session: Session, onChange: (next: Session) => void): Actions {
  return {
    probe: (m) => probe(session, m),
    place: (m, spot) => onChange(moveTile(session, m, spot)),
    send: (tileIds, target) => onChange(moveTiles(session, tileIds, target)),
    takeBack: () => onChange(undoTurn(session)),
    endTurn: () => onChange(finishTurn(session)),
    draw: (pick) => onChange(drawTile(session, pick)),
  };
}
