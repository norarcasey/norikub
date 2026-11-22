import type { Game } from './game.ts';
import { fullSet } from './tiles.ts';
import type { Tile } from './tiles.ts';

const box = new Map(fullSet().map((tile) => [tile.id, tile]));

/** A tile from the box by id: `t('red-7-a')`, `t('joker-a')`. */
export function t(id: string): Tile {
  const tile = box.get(id);
  if (tile === undefined) throw new Error(`no tile ${id}`);
  return tile;
}

export function ts(...ids: string[]): Tile[] {
  return ids.map(t);
}

type Seat = { readonly rack: readonly string[]; readonly hasMelded?: boolean };

/**
 * A game laid out by hand, with every tile not placed in a rack or on the table in the pool,
 * so it is a game `gameSchema` accepts and not a fragment of one.
 */
export function layout(seats: readonly Seat[], table: readonly (readonly string[])[] = []): Game {
  const used = new Set([...seats.flatMap((seat) => seat.rack), ...table.flat()]);
  return {
    players: seats.map((seat, index) => ({
      name: `P${index}`,
      rack: seat.rack.map(t),
      hasMelded: seat.hasMelded ?? false,
    })),
    table: table.map((set) => set.map(t)),
    pool: fullSet().filter((tile) => !used.has(tile.id)),
    current: 0,
    passes: 0,
    status: { kind: 'playing' },
  };
}
