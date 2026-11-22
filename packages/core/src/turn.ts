import { FIRST_MELD_POINTS, draw, finish, nextSeat } from './game.ts';
import type { DrawResult, Game } from './game.ts';
import { judgeSet, splitFor } from './sets.ts';
import type { Tile } from './tiles.ts';

/**
 * A turn in progress: a working copy of the current player's rack and of the table, which
 * moves change freely. Nothing here is judged until the turn ends (invariant 4), so a move may
 * leave any set broken, short or wrong on the way to reworking the board. `start` is the game
 * as it was, which is what taking the turn back returns to and what the end of the turn is
 * judged against.
 */
export type Turn = {
  readonly start: Game;
  readonly seat: number;
  readonly rack: readonly Tile[];
  readonly table: readonly (readonly Tile[])[];
};

/**
 * `to-set` puts the tile on the end of the set, whatever it makes: the literal move, which the
 * bots use. `onto-set` is a tile let go on a set by a person: the same, except that when the set
 * is a run the tile does not extend but would fit by splitting it (`splitFor`), the run is split
 * there, its left half keeping the set's place and its right half coming next (KUB-23).
 */
export type Move =
  | { readonly kind: 'to-set'; readonly tileId: string; readonly set: number }
  | { readonly kind: 'onto-set'; readonly tileId: string; readonly set: number }
  | { readonly kind: 'to-new-set'; readonly tileId: string }
  | { readonly kind: 'to-rack'; readonly tileId: string };

/**
 * The only moves refused at once, because no end of turn could make them legal: a tile that
 * began the turn on the table going into a rack, and the joker case of the same rule, named
 * apart because a joker taken back by replacing it must be played again this turn, and the
 * player should be told that rather than the general rule. The rest are moves that name
 * something not there.
 */
export type MoveRefusal =
  | { readonly kind: 'no-such-tile'; readonly tileId: string }
  | { readonly kind: 'no-such-set'; readonly set: number }
  | { readonly kind: 'table-tile-to-rack'; readonly tileId: string }
  | { readonly kind: 'table-joker-to-rack'; readonly tileId: string };

export type MoveResult =
  | { readonly ok: true; readonly turn: Turn }
  | { readonly ok: false; readonly refusal: MoveRefusal };

export function startTurn(game: Game): Turn {
  const player = game.players[game.current];
  return { start: game, seat: game.current, rack: player?.rack ?? [], table: game.table };
}

/** Taking the turn back: the table and the rack exactly as they were when it began. */
export function takeBack(turn: Turn): Turn {
  return startTurn(turn.start);
}

/**
 * Drawing instead of playing, from part-way through a turn. A draw plays no tile, so whatever
 * was moved goes back first: the next player finds the table this turn began with, not a
 * half-reworked one that nobody judged.
 */
export function drawInstead(turn: Turn, pick?: number): DrawResult {
  return draw(turn.start, pick);
}

export function move(turn: Turn, m: Move): MoveResult {
  const inRack = turn.rack.findIndex((tile) => tile.id === m.tileId);
  const setIndex = turn.table.findIndex((set) => set.some((tile) => tile.id === m.tileId));
  const tile = turn.rack[inRack] ?? turn.table[setIndex]?.find((t) => t.id === m.tileId);
  if (tile === undefined) return { ok: false, refusal: { kind: 'no-such-tile', tileId: m.tileId } };
  if ((m.kind === 'to-set' || m.kind === 'onto-set') && turn.table[m.set] === undefined) {
    return { ok: false, refusal: { kind: 'no-such-set', set: m.set } };
  }
  if (m.kind === 'to-rack' && inRack === -1 && beganOnTable(turn, tile.id)) {
    const kind = tile.kind === 'joker' ? 'table-joker-to-rack' : 'table-tile-to-rack';
    return { ok: false, refusal: { kind, tileId: tile.id } };
  }

  const rack = turn.rack.filter((t) => t.id !== tile.id);
  // Emptied sets are kept until the tile has landed, so a destination index means the set the
  // player saw when they let go, then dropped.
  const table = turn.table.map((set) => set.filter((t) => t.id !== tile.id));
  if (m.kind === 'to-rack') rack.push(tile);
  if (m.kind === 'to-new-set') table.push([tile]);
  if (m.kind === 'to-set') table[m.set] = [...(table[m.set] ?? []), tile];
  if (m.kind === 'onto-set') {
    const target = table[m.set] ?? [];
    const split = splitFor(target, tile);
    if (split === null) table[m.set] = [...target, tile];
    else table.splice(m.set, 1, [...split.left], [...split.right]);
  }
  return { ok: true, turn: { ...turn, rack, table: table.filter((set) => set.length > 0) } };
}

function beganOnTable(turn: Turn, tileId: string): boolean {
  return turn.start.table.some((set) => set.some((tile) => tile.id === tileId));
}

/**
 * Why a turn cannot end as it stands. The player keeps rearranging, takes the turn back, or
 * draws instead.
 */
export type TurnFault =
  | { readonly kind: 'game-over' }
  | { readonly kind: 'nothing-played' }
  | { readonly kind: 'invalid-set'; readonly set: number }
  | { readonly kind: 'table-touched-before-first-meld' }
  | { readonly kind: 'first-meld-under-30'; readonly points: number };

export type EndTurnResult =
  | { readonly ok: true; readonly game: Game }
  | { readonly ok: false; readonly faults: readonly TurnFault[] };

/**
 * The end of a turn, where the table is judged: every set valid and at least one tile played
 * from the rack. Before a player's first meld the table they found must still be there set for
 * set, and the sets they added, all from their own rack, must reach 30.
 */
export function endTurn(turn: Turn): EndTurnResult {
  const { start } = turn;
  const player = start.players[turn.seat];
  if (start.status.kind !== 'playing' || player === undefined) {
    return { ok: false, faults: [{ kind: 'game-over' }] };
  }
  const faults: TurnFault[] = [];
  const played = player.rack.length - turn.rack.length;
  if (played <= 0) faults.push({ kind: 'nothing-played' });
  turn.table.forEach((set, index) => {
    if (!judgeSet(set).valid) faults.push({ kind: 'invalid-set', set: index });
  });
  if (!player.hasMelded && played > 0) faults.push(...firstMeldFaults(turn));
  if (faults.length > 0) return { ok: false, faults };

  const players = start.players.map((p, seat) =>
    seat === turn.seat ? { ...p, rack: turn.rack, hasMelded: true } : p,
  );
  const game: Game = { ...start, players, table: turn.table, passes: 0 };
  if (turn.rack.length === 0) return { ok: true, game: finish(game, turn.seat, 'rack-emptied') };
  return { ok: true, game: { ...game, current: nextSeat(game) } };
}

function firstMeldFaults(turn: Turn): TurnFault[] {
  const remaining = turn.table.map(setKey);
  for (const set of turn.start.table) {
    const at = remaining.indexOf(setKey(set));
    if (at === -1) return [{ kind: 'table-touched-before-first-meld' }];
    remaining.splice(at, 1);
  }
  // With every set the player found still there whole, what remains is their own rack's.
  const points = turn.table
    .filter((set) => !turn.start.table.some((old) => setKey(old) === setKey(set)))
    .reduce((sum, set) => {
      const verdict = judgeSet(set);
      return sum + (verdict.valid ? verdict.points : 0);
    }, 0);
  return points >= FIRST_MELD_POINTS ? [] : [{ kind: 'first-meld-under-30', points }];
}

function setKey(set: readonly Tile[]): string {
  return set
    .map((tile) => tile.id)
    .sort()
    .join(',');
}

/**
 * A turn read back after a reload (invariant 3): the working rack and table that were saved,
 * over the game the turn began from. Null when they cannot be that turn: the game is over, or
 * the tiles are not exactly the ones the seat's rack and the table held when it began, or a
 * tile that began on the table is in the rack, which `move` never allows. Saved state is
 * whatever was on disk, so it is judged as strictly as a move is, never trusted for having
 * once been written by this code.
 */
export function resumeTurn(
  start: Game,
  rack: readonly Tile[],
  table: readonly (readonly Tile[])[],
): Turn | null {
  if (start.status.kind !== 'playing') return null;
  const began = startTurn(start);
  const ids = (tiles: readonly Tile[]): string[] => tiles.map((tile) => tile.id).sort();
  const had = ids([...began.rack, ...began.table.flat()]);
  const has = ids([...rack, ...table.flat()]);
  if (had.length !== has.length || had.some((id, i) => id !== has[i])) return null;
  if (rack.some((tile) => beganOnTable(began, tile.id))) return null;
  if (table.some((set) => set.length === 0)) return null;
  return { ...began, rack, table };
}
