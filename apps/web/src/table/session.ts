import { botFor, takeBotTurn } from '@norikub/core/bot';
import type { Level } from '@norikub/core/bot';
import { newGame } from '@norikub/core/game';
import type { Game } from '@norikub/core/game';
import { SINGLE, newMatch, nextGameOf, standing } from '@norikub/core/match';
import type { Match, MatchFormat } from '@norikub/core/match';
import type { Tile } from '@norikub/core/tiles';
import { drawInstead, endTurn, move, startTurn, takeBack } from '@norikub/core/turn';
import type { Refusal } from '@norikub/core/table';
import type { Move, MoveRefusal, Turn, TurnFault } from '@norikub/core/turn';

import { toMove } from './drag.ts';
import type { DropTarget } from './drag.ts';
import { CAST_NAMES, firstFree } from './cast.ts';
import type { Who } from './cast.ts';
import { fitPile, takeFromPile } from './pile.ts';
import type { Pile } from './pile.ts';
import { dealRows, placeOnRack, reconcileRows } from './rack.ts';
import type { RackRows } from './rack.ts';
import { drawFrames, framesOf } from './replay.ts';
import type { Frame } from './replay.ts';

/** The seat the person plays from; the other seats are bots. */
export const PERSON = 0;

/**
 * One bot's seat: how it plays, and who it plays as (KUB-43). The two are picked apart, and
 * only the level reaches a bot.
 */
export type BotSeat = { readonly level: Level; readonly who: Who };

/**
 * Who plays the seats after the person's, in seat order, picked before the game (KUB-41). The
 * engine never sees it: a level only chooses which bot is handed that seat's view, and the bot's
 * turn goes through the engine like anyone's (invariant 1). No two seats share a character, so
 * two bots of one level are told apart by face and name.
 */
export type Lineup = readonly BotSeat[];

/** Seats at these levels, each given the first character not already sitting. */
export function seatsFor(levels: readonly Level[]): Lineup {
  return levels.reduce<BotSeat[]>(
    (seats, level) => [...seats, { level, who: firstFree(seats.map((seat) => seat.who)) }],
    [],
  );
}

/** The bots a game starts with when none were picked: the one bot there was before KUB-41. */
export const FIRST_LINEUP: Lineup = seatsFor(['medium', 'medium']);

/**
 * What is picked before a sitting (KUB-42): the bots, one to three of them, and how long it
 * lasts. Play now deals the last one picked, or this one on a first visit.
 */
export type Setup = { readonly lineup: Lineup; readonly format: MatchFormat };

export const FIRST_SETUP: Setup = { lineup: FIRST_LINEUP, format: SINGLE };

/** Who plays the other seats, and the match the game is part of: carried from deal to deal. */
type Sitting = Pick<Session, 'lineup' | 'match'>;

const FIRST_SITTING: Sitting = { lineup: FIRST_LINEUP, match: newMatch(SINGLE) };

/** The bots' names at the table: their characters', which no two seats share. */
export function botNames(lineup: Lineup): string[] {
  return lineup.map((seat) => CAST_NAMES[seat.who]);
}

/**
 * What the person is told after an action. Every one of these carries what the engine said,
 * not a judgement of the screen's own (invariant 1): a refusal, a fault, a draw, another
 * player's turn, or what a friends' table's host refused that is neither a move nor a fault.
 */
export type Note =
  | { readonly kind: 'refused'; readonly refusal: MoveRefusal }
  | { readonly kind: 'fault'; readonly fault: TurnFault }
  | { readonly kind: 'drew'; readonly tile: Tile | null }
  | { readonly kind: 'played'; readonly name: string; readonly played: number }
  | { readonly kind: 'host'; readonly refusal: Refusal };

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
  readonly lineup: Lineup;
  /** The games finished before this one, and how many more there are to be (KUB-42). */
  readonly match: Match;
};

/** Where on the rack a tile is let go: a row, and the place along it. */
export type RackSpot = { readonly row: number; readonly col: number };

export function newSession(seed: number, setup: Setup = FIRST_SETUP): Session {
  return deal(seed, { lineup: setup.lineup, match: newMatch(setup.format) });
}

export function setupOf(session: Session): Setup {
  return { lineup: session.lineup, format: session.match.format };
}

/**
 * The next game of the match, against the same bots, with the finished game's scores moved
 * into the match. Null while this game is being played or when the match is over: then the
 * screen offers a new sitting instead.
 */
export function nextGame(session: Session, seed: number): Session | null {
  const { game } = session;
  const match = nextGameOf(session.match, game.status, game.players.length);
  return match === null ? null : deal(seed, { lineup: session.lineup, match });
}

/**
 * True while there is something to go back to: a game being played, or a finished one with
 * the match's next game still to deal. A reload resumes these on the table (invariant 3), and
 * opens on the landing otherwise (KUB-42).
 */
export function inProgress(session: Session): boolean {
  const { game, match } = session;
  return !standing(match, game.status, game.players.length).over;
}

function deal(seed: number, sitting: Sitting): Session {
  const game = newGame({ names: ['You', ...botNames(sitting.lineup)], seed });
  return fromGame(game, [], undefined, [], undefined, sitting);
}

/**
 * A session at the person's turn, after any bots due before it have played. With no rows
 * given, the rack is laid out as a fresh deal. `lead` is played back before the bots' turns:
 * the person's own draw. `pile` is the pile for `game.pool`; with none, the pile is dealt.
 * `sitting` is who plays the other seats and the match the game is part of.
 */
export function fromGame(
  game: Game,
  notes: readonly Note[],
  rows?: RackRows,
  lead: readonly Frame[] = [],
  pile?: Pile,
  sitting: Sitting = FIRST_SITTING,
): Session {
  const { lineup, match } = sitting;
  const played = playBots(game, fitPile(pile, game.pool.length), lineup);
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
    lineup,
    match,
  };
}

/**
 * The bots take their turns until it is the person's turn or the game is over. They decide at
 * once; the frames are how the screen shows it afterwards, at a pace a person can follow.
 */
function playBots(
  game: Game,
  dealt: Pile,
  lineup: Lineup,
): { game: Game; notes: Note[]; frames: Frame[]; pile: Pile } {
  const notes: Note[] = [];
  const frames: Frame[] = [];
  let current = game;
  let pile = dealt;
  while (current.status.kind === 'playing' && current.current !== PERSON) {
    const seat = current.current;
    const before = current.players[seat]?.rack.length ?? 0;
    const result = takeBotTurn(current, botFor(levelAt(lineup, seat)));
    const turnFrames = framesOf(current, result, pile);
    frames.push(...turnFrames);
    pile = turnFrames.at(-1)?.pile ?? pile;
    const next = result.game;
    const after = next.players[seat]?.rack.length ?? 0;
    // A bot that draws ends with one tile more, and has played none.
    const played = Math.max(0, before - after);
    notes.push({ kind: 'played', name: current.players[seat]?.name ?? '', played });
    current = next;
  }
  return { game: current, notes, frames, pile };
}

/** The level of the bot in `seat`: the lineup skips the person's seat. */
function levelAt(lineup: Lineup, seat: number): Level {
  return lineup[seat > PERSON ? seat - 1 : seat]?.level ?? 'medium';
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
  if (session.turn === null) return session;
  const moved = moveGroup(session, tileIds, target, {
    table: (s) => s.turn?.table ?? [],
    place: (s, m, spot) => {
      const next = moveTile(s, m, spot);
      const refused = next.notes.find((note) => note.kind === 'refused');
      return refused === undefined ? { ok: true, state: next } : { ok: false, note: refused };
    },
  });
  return moved.ok ? moved.state : { ...session, notes: [moved.note] };
}

/** One tile placed by `moveGroup`: the state after it, or why it was refused. */
export type Placed<S> =
  { readonly ok: true; readonly state: S } | { readonly ok: false; readonly note: Note };

/**
 * The moves of tapped tiles sent somewhere together, over any state a tile can be placed on:
 * the bot game's session, or a friends' table's view (`online/friends.ts`). Written once, so
 * the two cannot disagree about where the second tile of a group goes. All or none: `moves`
 * is what was made, in order, for a friends' table to send on.
 */
export function moveGroup<S>(
  state: S,
  tileIds: readonly string[],
  target: DropTarget,
  ops: {
    readonly table: (state: S) => readonly (readonly Tile[])[];
    readonly place: (state: S, m: Move, spot?: RackSpot) => Placed<S>;
  },
):
  | { readonly ok: true; readonly state: S; readonly moves: readonly Move[] }
  | {
      readonly ok: false;
      readonly note: Note;
    } {
  const [first, ...rest] = tileIds;
  if (first === undefined) return { ok: true, state, moves: [] };
  if (rest.length === 0) {
    const m = toMove(first, target);
    const placed = ops.place(state, m, target.kind === 'rack' ? target : undefined);
    return placed.ok ? { ...placed, moves: [m] } : placed;
  }
  let next = state;
  const moves: Move[] = [];
  for (let i = 0; i < tileIds.length; i++) {
    const step = groupStep(ops.table(next), tileIds, i, target);
    if (step === null) return { ok: true, state, moves: [] };
    const placed = ops.place(
      next,
      step,
      target.kind === 'rack' ? { row: target.row, col: target.col + i } : undefined,
    );
    if (!placed.ok) return placed;
    next = placed.state;
    moves.push(step);
  }
  return { ok: true, state: next, moves };
}

function groupStep(
  table: readonly (readonly Tile[])[],
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
  const set = table.findIndex((tiles) => tiles.some((tile) => tile.id === anchor));
  if (set === -1) return null;
  return { kind: 'to-set', tileId, set };
}

export function finishTurn(session: Session): Session {
  if (session.turn === null) return session;
  const result = endTurn(session.turn);
  if (!result.ok) {
    return { ...session, notes: result.faults.map((fault): Note => ({ kind: 'fault', fault })) };
  }
  return fromGame(result.game, [], session.rows, [], session.pile, session);
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
  const notes: Note[] = [{ kind: 'drew', tile: result.drawn }];
  return fromGame(result.game, notes, back, lead, after, session);
}
