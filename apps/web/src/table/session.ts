import { takeBotTurn } from '@norikub/core/bot';
import { newGame } from '@norikub/core/game';
import type { Game } from '@norikub/core/game';
import type { Tile } from '@norikub/core/tiles';
import { drawInstead, endTurn, move, startTurn, takeBack } from '@norikub/core/turn';
import type { Move, MoveRefusal, Turn, TurnFault } from '@norikub/core/turn';

import { toMove } from './drag.ts';
import type { DropTarget } from './drag.ts';
import { fitPile, takeFromPile } from './pile.ts';
import type { Pile } from './pile.ts';
import { dealRows, placeOnRack, reconcileRows } from './rack.ts';
import type { RackRows } from './rack.ts';
import { drawFrames, framesOf } from './replay.ts';
import type { Frame } from './replay.ts';

/** The seat the person plays from; the other seats are bots. */
export const PERSON = 0;

/**
 * What the person is told after an action. Every one of these carries what the engine said,
 * not a judgement of the screen's own (invariant 1): a refusal, a fault, a draw or a bot's
 * turn.
 */
export type Note =
  | { readonly kind: 'refused'; readonly refusal: MoveRefusal }
  | { readonly kind: 'fault'; readonly fault: TurnFault }
  | { readonly kind: 'drew'; readonly tile: Tile | null }
  | { readonly kind: 'bot'; readonly name: string; readonly played: number };

/**
 * The screen's whole state: the game, the person's turn in progress over it (none once the
 * game is over), how they have arranged their rack, and what to tell them. `startRows` is the
 * rack as the turn began, so a take-back puts tiles back where they were. What of it is saved
 * across a reload, and how it is read back, is `saved.ts` (KUB-6).
 *
 * `replay` is the bot turns played since the person's last action, as frames to watch. It is
 * only something to look at: `game` is already the game those turns produced, so the state
 * worth saving is whole before the playback starts (invariant 3), and a reload part-way
 * through resumes at the person's turn rather than playing a bot turn twice. It is never
 * saved.
 */
export type Session = {
  readonly game: Game;
  readonly turn: Turn | null;
  readonly rows: RackRows;
  readonly startRows: RackRows;
  readonly notes: readonly Note[];
  readonly replay: readonly Frame[];
  /** The face-down tiles' spots, parallel to `game.pool` (KUB-25). */
  readonly pile: Pile;
};

/** Where on the rack a tile is let go: a row, and the place along it. */
export type RackSpot = { readonly row: number; readonly col: number };

export function newSession(seed: number): Session {
  return fromGame(newGame({ names: ['You', 'Bot A', 'Bot B'], seed }), []);
}

/**
 * A session at the person's turn, after any bots due before it have played. With no rows
 * given, the rack is laid out as a fresh deal. `lead` is played back before the bots' turns:
 * the person's own draw. `pile` is the pile for `game.pool`; with none, the pile is dealt.
 */
export function fromGame(
  game: Game,
  notes: readonly Note[],
  rows?: RackRows,
  lead: readonly Frame[] = [],
  pile?: Pile,
): Session {
  const played = playBots(game, fitPile(pile, game.pool.length));
  const turn = played.game.status.kind === 'playing' ? startTurn(played.game) : null;
  const rack = played.game.players[PERSON]?.rack ?? [];
  const laidOut = rows === undefined ? dealRows(rack) : reconcileRows(rows, rack);
  return {
    game: played.game,
    turn,
    rows: laidOut,
    startRows: laidOut,
    notes: [...notes, ...played.notes],
    replay: [...lead, ...played.frames],
    pile: played.pile,
  };
}

/**
 * The bots take their turns until it is the person's turn or the game is over. They decide at
 * once; the frames are how the screen shows it afterwards, at a pace a person can follow.
 */
function playBots(
  game: Game,
  dealt: Pile,
): { game: Game; notes: Note[]; frames: Frame[]; pile: Pile } {
  const notes: Note[] = [];
  const frames: Frame[] = [];
  let current = game;
  let pile = dealt;
  while (current.status.kind === 'playing' && current.current !== PERSON) {
    const seat = current.current;
    const before = current.players[seat]?.rack.length ?? 0;
    const result = takeBotTurn(current);
    const turnFrames = framesOf(current, result, pile);
    frames.push(...turnFrames);
    pile = turnFrames.at(-1)?.pile ?? pile;
    const next = result.game;
    const after = next.players[seat]?.rack.length ?? 0;
    // A bot that draws ends with one tile more, and has played none.
    const played = Math.max(0, before - after);
    notes.push({ kind: 'bot', name: current.players[seat]?.name ?? '', played });
    current = next;
  }
  return { game: current, notes, frames, pile };
}

/** What the engine would say to a move, without making it: used while a tile is dragged. */
export function probe(session: Session, m: Move): MoveRefusal | null {
  if (session.turn === null) return null;
  if (m.kind === 'to-rack' && inRack(session.turn, m.tileId)) return null;
  const result = move(session.turn, m);
  return result.ok ? null : result.refusal;
}

function inRack(turn: Turn, tileId: string): boolean {
  return turn.rack.some((tile) => tile.id === tileId);
}

/**
 * A refused move leaves the turn exactly as it was; the tile goes back where it came from. A
 * tile moved along its own rack is only rearranged: no tile changes hands, so the engine is
 * not asked.
 */
export function moveTile(session: Session, m: Move, spot?: RackSpot): Session {
  const { turn } = session;
  if (turn === null) return session;
  if (m.kind === 'to-rack' && inRack(turn, m.tileId)) {
    if (spot === undefined) return session;
    return {
      ...session,
      rows: placeOnRack(session.rows, m.tileId, spot.row, spot.col),
      notes: [],
    };
  }
  const result = move(turn, m);
  if (!result.ok) return { ...session, notes: [{ kind: 'refused', refusal: result.refusal }] };
  let rows = reconcileRows(session.rows, result.turn.rack, session.startRows);
  if (m.kind === 'to-rack' && spot !== undefined) {
    rows = placeOnRack(rows, m.tileId, spot.row, spot.col);
  }
  return { ...session, turn: result.turn, rows, notes: [] };
}

/**
 * Several tiles tapped and then sent somewhere together (Nora, 22 Nov 2026, KUB-2): tap a few
 * tiles in the rack, tap New set, and they are a set. Each is still one engine move, in the
 * order tapped, so the engine judges every one (invariant 1); the group goes all or none, so
 * a refusal part-way leaves no half-moved group behind and says why.
 *
 * One tile alone is exactly a drop, splitting a run where it fits. A group is laid on the end
 * of the set (`to-set`): which of three tiles should cut a run is not a question a tap can
 * answer. A set is followed by a tile already in it, not by its index, because the engine
 * drops a set its last tile leaves and the indices after it move up.
 */
export function moveTiles(
  session: Session,
  tileIds: readonly string[],
  target: DropTarget,
): Session {
  const [first, ...rest] = tileIds;
  if (first === undefined || session.turn === null) return session;
  if (rest.length === 0) {
    return moveTile(session, toMove(first, target), target.kind === 'rack' ? target : undefined);
  }
  let next = session;
  for (let i = 0; i < tileIds.length; i++) {
    const step = groupStep(next, tileIds, i, target);
    if (step === null) return session;
    next = moveTile(
      next,
      step,
      target.kind === 'rack' ? { row: target.row, col: target.col + i } : undefined,
    );
    const refused = next.notes.find((note) => note.kind === 'refused');
    if (refused !== undefined) return { ...session, notes: [refused] };
  }
  return next;
}

function groupStep(
  session: Session,
  tileIds: readonly string[],
  i: number,
  target: DropTarget,
): Move | null {
  const tileId = tileIds[i];
  if (tileId === undefined) return null;
  if (target.kind === 'rack') return { kind: 'to-rack', tileId };
  if (i === 0) {
    return target.kind === 'new-set'
      ? { kind: 'to-new-set', tileId }
      : { kind: 'to-set', tileId, set: target.set };
  }
  const anchor = tileIds[0];
  const set = session.turn?.table.findIndex((tiles) => tiles.some((tile) => tile.id === anchor));
  if (set === undefined || set === -1) return null;
  return { kind: 'to-set', tileId, set };
}

export function finishTurn(session: Session): Session {
  if (session.turn === null) return session;
  const result = endTurn(session.turn);
  if (!result.ok) {
    return { ...session, notes: result.faults.map((fault): Note => ({ kind: 'fault', fault })) };
  }
  return fromGame(result.game, [], session.rows, [], session.pile);
}

export function undoTurn(session: Session): Session {
  if (session.turn === null) return session;
  const turn = takeBack(session.turn);
  return {
    ...session,
    turn,
    rows: reconcileRows(session.rows, turn.rack, session.startRows),
    notes: [],
  };
}

/**
 * Drawing the face-down tile at `pick` in the pool, or passing when the pool is empty (no
 * pick). Whatever was moved this turn goes back first; the arrangement of the rack stays.
 */
export function drawTile(session: Session, pick?: number): Session {
  if (session.turn === null) return session;
  const result = drawInstead(session.turn, pick);
  if (!result.ok) return session;
  const back = reconcileRows(
    session.rows,
    session.turn.start.players[PERSON]?.rack ?? [],
    session.startRows,
  );
  const pile = fitPile(session.pile, session.turn.start.pool.length);
  // A pass is told in the note alone; only a tile drawn has something to watch.
  const lead =
    result.drawn === null || pick === undefined
      ? []
      : drawFrames(session.turn.start, result.game, pick, result.drawn, pile);
  const after = pick === undefined || result.drawn === null ? pile : takeFromPile(pile, pick);
  return fromGame(result.game, [{ kind: 'drew', tile: result.drawn }], back, lead, after);
}
