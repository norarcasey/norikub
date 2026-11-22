import { COLOURS } from '@norikub/core/tiles';
import type { Tile } from '@norikub/core/tiles';

export const RACK_ROWS = 3;

/**
 * How the person has arranged their rack: three rows of tile ids, like a real rack's tiers.
 * It is the screen's, not the game's. Which tiles are in the rack is the engine's business;
 * where they sit on it is the player's, and moving one along the rack is never a game move.
 */
export type RackRows = readonly (readonly string[])[];

function rank(tile: Tile): number {
  return tile.kind === 'joker' ? 1000 : COLOURS.indexOf(tile.colour) * 100 + tile.value;
}

/** A first deal laid out sorted, by colour then number with jokers last, across the rows. */
export function dealRows(rack: readonly Tile[]): RackRows {
  const sorted = [...rack].sort((a, b) => rank(a) - rank(b)).map((tile) => tile.id);
  const per = Math.ceil(sorted.length / RACK_ROWS);
  return Array.from({ length: RACK_ROWS }, (_, row) => sorted.slice(row * per, (row + 1) * per));
}

/** Moves one tile to a row, before the tile now at `index` there (the end when past it). */
export function placeOnRack(rows: RackRows, tileId: string, row: number, index: number): RackRows {
  const without = rows.map((ids) => ids.filter((id) => id !== tileId));
  return without.map((ids, r) =>
    r === row ? [...ids.slice(0, index), tileId, ...ids.slice(index)] : ids,
  );
}

/**
 * Brings the rows into line with the tiles actually in the rack: a tile that left goes, and a
 * tile that arrived is put where `hint` had it (a taken-back tile returns near where it came
 * from), or else at the end of the shortest row, where a drawn tile lands.
 */
export function reconcileRows(
  rows: RackRows,
  rack: readonly Tile[],
  hint: RackRows = [],
): RackRows {
  const inRack = new Set(rack.map((tile) => tile.id));
  let out: RackRows = rows.map((ids) => ids.filter((id) => inRack.has(id)));
  const placed = new Set(out.flat());
  for (const tile of rack) {
    if (placed.has(tile.id)) continue;
    const row = hint.findIndex((ids) => ids.includes(tile.id));
    const index = hint[row]?.indexOf(tile.id);
    if (row !== -1 && index !== undefined) {
      out = placeOnRack(out, tile.id, row, index);
    } else {
      const lengths = out.map((ids) => ids.length);
      out = placeOnRack(out, tile.id, lengths.indexOf(Math.min(...lengths)), Infinity);
    }
  }
  return out;
}
