import type { TableClientMessage, TableMessage } from '@norikub/core/protocol';
import type { Refusal, TableView } from '@norikub/core/table';
import { rackPenalty } from '@norikub/core/tiles';
import type { Tile } from '@norikub/core/tiles';
import type { Move, MoveRefusal } from '@norikub/core/turn';
import { moveInView } from '@norikub/core/view';
import type { TurnView } from '@norikub/core/view';

import type { Board } from '../table/board.ts';
import type { DropTarget } from '../table/drag.ts';
import { dealPile, fitPile, takeFromPile } from '../table/pile.ts';
import type { Pile } from '../table/pile.ts';
import { dealRows, placeOnRack, reconcileRows } from '../table/rack.ts';
import type { RackRows } from '../table/rack.ts';
import type { Frame } from '../table/replay.ts';
import { moveGroup } from '../table/session.ts';
import type { Note, Placed, RackSpot } from '../table/session.ts';

/**
 * One device's side of a friends' table (`docs/online.md`): the last view the host sent, and
 * what this page shows over it while its own moves are on their way.
 *
 * The host's view is the truth. The mover's page applies each of its own moves at once with
 * the core's `move` (`moveInView`), so a drag feels as it does against the bots, and counts
 * the messages it has sent that the host has not answered yet. Every message a seat sends is
 * answered to that seat with exactly one view (accepted) or one refusal, so once the count is
 * back to nought the host's last view is shown: the page only ever disagrees with the host
 * while it is ahead of it, never after it has heard back.
 *
 * The rack's layout is the device's and never reaches the host (KUB-20, KUB-22). The pile's
 * spots are the device's too, kept in step with every other page's by the host's `drew`.
 */
export type Friends = {
  readonly host: TableView | null;
  /** The mover's own view with its unanswered moves applied; null shows the host's. */
  readonly ahead: TurnView | null;
  readonly unanswered: number;
  readonly rows: RackRows | null;
  readonly startRows: RackRows | null;
  readonly notes: readonly Note[];
  readonly replay: readonly Frame[];
  readonly pile: Pile | null;
  /** A draw the host announced, waiting for the view that comes after it. */
  readonly drew: { readonly seat: number; readonly drewAt: number | null } | null;
  /**
   * Which seats have a device connected, as the host last said (`KUB-35`); null until it has.
   * A seat with none is away, never gone: it waits for its device.
   */
  readonly here: readonly boolean[] | null;
};

/** `rows` is the rack as this device last laid it out, kept under the table's code. */
export function newFriends(rows: { rows: RackRows; startRows: RackRows } | null = null): Friends {
  return {
    host: null,
    ahead: null,
    unanswered: 0,
    rows: rows?.rows ?? null,
    startRows: rows?.startRows ?? null,
    notes: [],
    replay: [],
    pile: null,
    drew: null,
    here: null,
  };
}

/** A socket opened again starts with nothing unanswered: what was sent on the old one is gone. */
export function reconnected(state: Friends): Friends {
  return { ...state, ahead: null, unanswered: 0, drew: null };
}

/** The view on screen: the mover's own, while it is ahead of the host's, or the host's. */
export function shownView(state: Friends): TurnView | null {
  if (state.ahead !== null) return state.ahead;
  return state.host?.phase === 'playing' ? state.host.view : null;
}

export function received(state: Friends, message: TableMessage): Friends {
  switch (message.type) {
    case 'view':
      return viewed(state, message.table);
    case 'refused': {
      const answered = answer(state);
      return { ...answered, notes: refusalNotes(message.refusal) };
    }
    case 'drew':
      return { ...state, drew: { seat: message.seat, drewAt: message.drewAt } };
    case 'presence':
      return { ...state, here: message.here };
    // Bots at a friends' table are KUB-36; no host sends their moves yet.
    case 'bot-turn':
      return state;
  }
}

function answer(state: Friends): Friends {
  const unanswered = Math.max(0, state.unanswered - 1);
  return { ...state, unanswered, ahead: unanswered === 0 ? null : state.ahead };
}

function refusalNotes(refusal: Refusal): Note[] {
  if (refusal.kind === 'move') return [{ kind: 'refused', refusal: refusal.refusal }];
  if (refusal.kind === 'end-turn') {
    return refusal.faults.map((fault): Note => ({ kind: 'fault', fault }));
  }
  return [{ kind: 'host', refusal }];
}

function viewed(state: Friends, table: TableView): Friends {
  const was = state.host?.phase === 'playing' ? state.host.view : null;
  const answered = { ...answer(state), host: table };
  if (table.phase === 'seating') return { ...answered, drew: null };
  const view = table.view;
  const shown = answered.ahead ?? view;

  // A new deal, or this device's first sight of a game already under way.
  const dealt = was === null || (was.status.kind === 'over' && view.status.kind === 'playing');
  const fresh = dealt && (was !== null || state.rows === null);
  let rows = fresh ? dealRows(shown.rack) : (state.rows ?? dealRows(shown.rack));
  let startRows = fresh ? rows : (state.startRows ?? rows);
  let pile = fresh || state.pile === null ? dealPile(view.poolSize) : state.pile;

  const notes: Note[] = [];
  let replay: readonly Frame[] = [];
  if (was !== null && !dealt) {
    const turnOver = was.current !== view.current || view.status.kind !== was.status.kind;
    if (state.drew !== null) {
      replay = drawFrames(was, view, table.names, state.drew, pile);
      if (state.drew.drewAt !== null) pile = takeFromPile(pile, state.drew.drewAt);
      if (state.drew.seat === view.seat) {
        const tile = drawnTile(was, view);
        notes.push({ kind: 'drew', tile });
      }
    } else if (turnOver && was.current !== view.seat) {
      const began = was.turn?.began ?? was.table;
      const played = view.table.flat().length - began.flat().length;
      notes.push({ kind: 'played', name: table.names[was.current] ?? '', played });
    }
    // The turn that starts here is this seat's: a take-back returns tiles to where they are now.
    if (turnOver && view.current === view.seat) startRows = rows;
  }

  rows = reconcileRows(rows, shown.rack, startRows);
  if (view.current === view.seat && view.turn === null) startRows = rows;
  return {
    ...answered,
    rows,
    startRows,
    pile: fitPile(pile, view.poolSize),
    notes: answered.unanswered > 0 ? state.notes : notes,
    replay: replay.length > 0 ? replay : state.drew === null ? state.replay : [],
    drew: null,
  };
}

/** The tile this seat drew: the one in its rack now that was nowhere in its sight before. */
function drawnTile(was: TurnView, now: TurnView): Tile | null {
  const had = new Set([...was.rack, ...was.table.flat()].map((tile) => tile.id));
  return now.rack.find((tile) => !had.has(tile.id)) ?? null;
}

/**
 * The frames of a draw at a friends' table, from the views before and after it, as the bot
 * game's `drawFrames` makes them from two games. The tile's face is only ever this seat's own
 * draw: another seat's tile is not in this seat's view to show.
 */
function drawFrames(
  was: TurnView,
  now: TurnView,
  names: readonly string[],
  drew: { readonly seat: number; readonly drewAt: number | null },
  pile: Pile,
): Frame[] {
  const name = names[drew.seat] ?? '';
  const landed: Frame = {
    seat: drew.seat,
    name,
    table: now.table,
    counts: countsOf(now, now.rack.length),
    pile: drew.drewAt === null ? pile : takeFromPile(pile, drew.drewAt),
    step: drew.drewAt === null ? { kind: 'passed' } : { kind: 'drew', face: null },
  };
  if (drew.drewAt === null) return [landed];
  const face = drew.seat === now.seat ? drawnTile(was, now) : null;
  // A draw puts back whatever the mover had moved, so the tile leaves from the table they began with.
  const before = was.turn?.began ?? was.table;
  const counts = countsOf(now, now.rack.length);
  counts[drew.seat] = (counts[drew.seat] ?? 1) - 1;
  return [
    {
      seat: drew.seat,
      name,
      table: before,
      counts,
      pile,
      step: { kind: 'drawing', pick: drew.drewAt, face },
    },
    { ...landed, step: { kind: 'drew', face } },
  ];
}

function countsOf(view: TurnView, own: number): number[] {
  const counts = Array.from({ length: view.opponents.length + 1 }, () => 0);
  counts[view.seat] = own;
  for (const o of view.opponents) counts[o.seat] = o.tileCount;
  return counts;
}

/** What one of this seat's actions changed on screen, and what to send the host. */
export type Sent = { readonly state: Friends; readonly send: readonly TableClientMessage[] };

const unchanged = (state: Friends): Sent => ({ state, send: [] });

function mover(state: Friends): TurnView | null {
  const view = shownView(state);
  if (view === null || view.status.kind !== 'playing' || view.current !== view.seat) return null;
  return view;
}

function inRack(view: TurnView, tileId: string): boolean {
  return view.rack.some((tile) => tile.id === tileId);
}

export function probeMove(state: Friends, m: Move): MoveRefusal | null {
  const view = mover(state);
  if (view === null) return null;
  if (m.kind === 'to-rack' && inRack(view, m.tileId)) return null;
  const moved = moveInView(view, m);
  return moved.ok ? null : moved.refusal;
}

/**
 * A tile let go. Moved along its own rack it is only rearranged on this device; anything else
 * is the core's `move` on this page at once, and the same move sent to the host.
 */
export function placeTile(state: Friends, m: Move, spot?: RackSpot): Sent {
  const placed = placeOne(state, m, spot);
  if (!placed.ok) return unchanged({ ...state, notes: [placed.note] });
  const sent = placed.state.unanswered > state.unanswered;
  return { state: placed.state, send: sent ? [{ type: 'move', move: m }] : [] };
}

function placeOne(state: Friends, m: Move, spot?: RackSpot): Placed<Friends> {
  const view = mover(state);
  const rows = state.rows;
  if (view === null || rows === null) return { ok: true, state };
  if (m.kind === 'to-rack' && inRack(view, m.tileId)) {
    if (spot === undefined) return { ok: true, state };
    return {
      ok: true,
      state: { ...state, rows: placeOnRack(rows, m.tileId, spot.row, spot.col), notes: [] },
    };
  }
  const moved = moveInView(view, m);
  if (!moved.ok) return { ok: false, note: { kind: 'refused', refusal: moved.refusal } };
  let next = reconcileRows(rows, moved.view.rack, state.startRows ?? rows);
  if (m.kind === 'to-rack' && spot !== undefined) {
    next = placeOnRack(next, m.tileId, spot.row, spot.col);
  }
  return {
    ok: true,
    state: { ...state, ahead: moved.view, unanswered: state.unanswered + 1, rows: next, notes: [] },
  };
}

/** Tapped tiles sent somewhere together (KUB-2): each one a move, sent in the order made. */
export function sendTiles(state: Friends, tileIds: readonly string[], target: DropTarget): Sent {
  const moved = moveGroup(state, tileIds, target, {
    table: (s) => shownView(s)?.table ?? [],
    place: placeOne,
  });
  if (!moved.ok) return unchanged({ ...state, notes: [moved.note] });
  const view = mover(state);
  const send = moved.moves
    .filter((m) => !(view !== null && m.kind === 'to-rack' && inRack(view, m.tileId)))
    .map((m): TableClientMessage => ({ type: 'move', move: m }));
  return { state: moved.state, send };
}

/**
 * The turn taken back, at once: the tiles this turn put down go back to the rack and the table
 * is the one the turn began with, which is what the host's `takeBack` makes too.
 */
export function takeBackTurn(state: Friends): Sent {
  const view = mover(state);
  if (view === null || view.turn === null) return unchanged({ ...state, notes: [] });
  const began = view.turn.began;
  const there = new Set(began.flat().map((tile) => tile.id));
  const rack = [...view.rack, ...view.table.flat().filter((tile) => !there.has(tile.id))];
  const ahead: TurnView = { ...view, rack, table: began, turn: null };
  const rows = state.rows === null ? null : reconcileRows(state.rows, rack, state.startRows ?? []);
  return {
    state: { ...state, ahead, unanswered: state.unanswered + 1, rows, notes: [] },
    send: [{ type: 'take-back' }],
  };
}

/** Ending the turn and drawing are judged by the host alone; the page waits for its answer. */
export function sendTurn(
  state: Friends,
  message: Extract<TableClientMessage, { type: 'end-turn' | 'draw' }>,
): Sent {
  if (mover(state) === null) return unchanged(state);
  const ahead = shownView(state);
  return {
    state: { ...state, ahead, unanswered: state.unanswered + 1, notes: [] },
    send: [message],
  };
}

/** The first seat deals, once two or more are seated, and again when a game is over. */
export function sendDeal(state: Friends): Sent {
  return {
    state: { ...state, unanswered: state.unanswered + 1, notes: [] },
    send: [{ type: 'deal' }],
  };
}

/**
 * What the table screen draws, from this seat's view alone (invariant 2). Another player's
 * points left are known only where their score says it: a loser's score is minus their rack.
 */
export function friendsBoard(state: Friends): Board | null {
  const view = shownView(state);
  const host = state.host;
  if (view === null || host === null || state.rows === null) return null;
  const { status } = view;
  const counts = countsOf(view, view.rack.length);
  const mine = status.kind === 'playing' && view.current === view.seat;
  return {
    you: view.seat,
    names: host.names,
    counts,
    table: view.table,
    rack: view.rack,
    began: mine ? (view.turn?.began ?? view.table) : null,
    current: view.current,
    poolSize: view.poolSize,
    pile: fitPile(state.pile ?? undefined, view.poolSize),
    status,
    left: counts.map((_, seat) => {
      if (seat === view.seat) return rackPenalty(view.rack);
      if (status.kind !== 'over') return null;
      const score = status.scores[seat] ?? 0;
      if (seat !== status.winner) return -score;
      return status.reason === 'rack-emptied' ? 0 : null;
    }),
    rows: state.rows,
    notes: state.notes,
    replay: state.replay,
    away: counts.map((_, seat) => isAway(state, seat)),
  };
}

/** A seat the host has said has no device connected. Before it has said, nobody is away. */
export function isAway(state: Friends, seat: number): boolean {
  return state.here?.[seat] === false;
}
