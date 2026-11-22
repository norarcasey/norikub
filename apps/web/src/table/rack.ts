import { COLOURS } from '@norikub/core/tiles';
import type { Tile } from '@norikub/core/tiles';

export const RACK_ROWS = 3;
export const RACK_COLUMNS = 10;

/**
 * How the person has arranged their rack: three rows of slots, every row the same length, a
 * slot holding a tile id or nothing. Slots rather than packed rows, so tiles can be lined up
 * in columns as well as rows and gaps left between them, as on a real rack (Nora, 21 Nov
 * 2026, KUB-22).
 *
 * It is the screen's, not the game's. Which tiles are in the rack is the engine's business;
 * where they sit on it is the player's, and moving one along the rack is never a game move.
 */
export type RackRows = readonly (readonly (string | null)[])[];

function rank(tile: Tile): number {
  return tile.kind === 'joker' ? 1000 : COLOURS.indexOf(tile.colour) * 100 + tile.value;
}

function columns(rows: RackRows): number {
  return rows[0]?.length ?? RACK_COLUMNS;
}

function empty(cols: number): (string | null)[][] {
  return Array.from({ length: RACK_ROWS }, () => Array.from({ length: cols }, () => null));
}

/** A first deal laid out sorted, by colour then number with jokers last, from the left. */
export function dealRows(rack: readonly Tile[]): RackRows {
  const sorted = [...rack].sort((a, b) => rank(a) - rank(b)).map((tile) => tile.id);
  const per = Math.ceil(sorted.length / RACK_ROWS);
  const rows = empty(Math.max(RACK_COLUMNS, per));
  sorted.forEach((id, i) => {
    const row = rows[Math.floor(i / per)];
    if (row !== undefined) row[i % per] = id;
  });
  return rows;
}

/**
 * Puts a tile in a slot. A tile already there is pushed one slot right, and the tiles after it
 * with it, as far as the next gap. A row with no gap to push into gains a column, and so does
 * every other row, so the columns stay lined up.
 */
export function placeOnRack(rows: RackRows, tileId: string, row: number, col: number): RackRows {
  let grid = rows.map((r) => r.map((id) => (id === tileId ? null : id)));
  // Past the last column: the rack grows to reach it.
  const reach = Math.max(0, col) + 1 - columns(grid);
  if (reach > 0) grid = grid.map((r) => [...r, ...Array.from({ length: reach }, () => null)]);
  const target = grid[row];
  if (target === undefined) return rows;
  const at = Math.max(0, col);
  if (target[at] !== null) {
    let gap = target.indexOf(null, at);
    if (gap === -1) {
      grid = grid.map((r) => [...r, null]);
      gap = target.length;
    }
    const shifted = grid[row];
    if (shifted === undefined) return rows;
    shifted.splice(gap, 1);
    shifted.splice(at, 0, null);
  }
  const final = grid[row];
  if (final !== undefined) final[at] = tileId;
  return grid;
}

function slotOf(rows: RackRows, tileId: string): { row: number; col: number } | null {
  for (const [row, ids] of rows.entries()) {
    const col = ids.indexOf(tileId);
    if (col !== -1) return { row, col };
  }
  return null;
}

/**
 * Brings the slots into line with the tiles actually in the rack: a tile that left leaves its
 * slot empty, and a tile that arrived goes back to its slot in `hint` if that slot is free (a
 * taken-back tile returns where it was), or else into the first free slot after the last tile
 * of the emptiest row, where a drawn tile lands.
 */
export function reconcileRows(
  rows: RackRows,
  rack: readonly Tile[],
  hint: RackRows = [],
): RackRows {
  const inRack = new Set(rack.map((tile) => tile.id));
  let out: RackRows = rows.map((ids) =>
    ids.map((id) => (id !== null && inRack.has(id) ? id : null)),
  );
  for (const tile of rack) {
    if (slotOf(out, tile.id) !== null) continue;
    const home = slotOf(hint, tile.id);
    if (home !== null && out[home.row]?.[home.col] === null) {
      out = placeOnRack(out, tile.id, home.row, home.col);
      continue;
    }
    const counts = out.map((ids) => ids.filter((id) => id !== null).length);
    const row = counts.indexOf(Math.min(...counts));
    const ids = out[row] ?? [];
    const last = ids.findLastIndex((id) => id !== null);
    out = placeOnRack(out, tile.id, row, Math.min(last + 1, columns(out)));
  }
  return out;
}
