import { z } from 'zod';

export const COLOURS = ['red', 'blue', 'orange', 'black'] as const;
export const colourSchema = z.enum(COLOURS);
export type Colour = z.infer<typeof colourSchema>;

export const numberTileSchema = z
  .object({
    kind: z.literal('number'),
    id: z.string().min(1),
    colour: colourSchema,
    value: z.number().int().min(1).max(13),
  })
  .readonly();
export type NumberTile = z.infer<typeof numberTileSchema>;

export const jokerTileSchema = z
  .object({ kind: z.literal('joker'), id: z.string().min(1) })
  .readonly();
export type JokerTile = z.infer<typeof jokerTileSchema>;

export const tileSchema = z.discriminatedUnion('kind', [numberTileSchema, jokerTileSchema]);
export type Tile = z.infer<typeof tileSchema>;

export const TILE_COUNT = 106;
export const JOKER_PENALTY = 30;

/**
 * Every tile in a box: 1–13 in four colours, two copies of each, and two jokers. The id says
 * which physical tile it is, so two red 7s stay two tiles wherever they move: a turn is judged
 * by which tiles went where, and value alone cannot tell the two copies apart.
 */
export function fullSet(): readonly Tile[] {
  const tiles: Tile[] = [];
  for (const copy of ['a', 'b']) {
    for (const colour of COLOURS) {
      for (let value = 1; value <= 13; value++) {
        tiles.push({ kind: 'number', id: `${colour}-${value}-${copy}`, colour, value });
      }
    }
    tiles.push({ kind: 'joker', id: `joker-${copy}` });
  }
  return tiles;
}

export function isNumber(tile: Tile): tile is NumberTile {
  return tile.kind === 'number';
}

/** What a tile left in a rack costs at the end of a game. */
export function penalty(tile: Tile): number {
  return tile.kind === 'joker' ? JOKER_PENALTY : tile.value;
}

export function rackPenalty(rack: readonly Tile[]): number {
  return rack.reduce((sum, tile) => sum + penalty(tile), 0);
}
