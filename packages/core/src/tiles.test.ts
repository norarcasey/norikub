import { describe, expect, it } from 'vitest';

import { t } from './fixtures.test-helpers.ts';
import { seededRandom, shuffle } from './random.ts';
import { COLOURS, TILE_COUNT, fullSet, penalty, rackPenalty, tileSchema } from './tiles.ts';

describe('the box', () => {
  const tiles = fullSet();

  it('holds 106 tiles, each with its own id', () => {
    expect(tiles).toHaveLength(TILE_COUNT);
    expect(new Set(tiles.map((tile) => tile.id)).size).toBe(TILE_COUNT);
  });

  it('holds 1–13 in four colours, two of each, and two jokers', () => {
    for (const colour of COLOURS) {
      for (let value = 1; value <= 13; value++) {
        const copies = tiles.filter(
          (tile) => tile.kind === 'number' && tile.colour === colour && tile.value === value,
        );
        expect(copies).toHaveLength(2);
      }
    }
    expect(tiles.filter((tile) => tile.kind === 'joker')).toHaveLength(2);
  });

  it('parses every tile it makes, and refuses a 14', () => {
    for (const tile of tiles) expect(tileSchema.safeParse(tile).success).toBe(true);
    expect(
      tileSchema.safeParse({ kind: 'number', id: 'x', colour: 'red', value: 14 }).success,
    ).toBe(false);
  });

  it('costs face value left in a rack, and 30 for a joker', () => {
    expect(penalty(t('blue-9-a'))).toBe(9);
    expect(penalty(t('joker-b'))).toBe(30);
    expect(rackPenalty([t('red-1-a'), t('red-13-b'), t('joker-a')])).toBe(44);
    expect(rackPenalty([])).toBe(0);
  });

  it('names a tile the box does not hold, in the fixtures', () => {
    expect(() => t('green-3-a')).toThrow('no tile green-3-a');
  });
});

describe('the shuffle', () => {
  it('is the same for the same seed and different for another', () => {
    const a = shuffle(fullSet(), seededRandom(7)).map((tile) => tile.id);
    const b = shuffle(fullSet(), seededRandom(7)).map((tile) => tile.id);
    const c = shuffle(fullSet(), seededRandom(8)).map((tile) => tile.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('keeps every tile and leaves its input alone', () => {
    const input = fullSet();
    const before = input.map((tile) => tile.id);
    const out = shuffle(input, seededRandom(1));
    expect(input.map((tile) => tile.id)).toEqual(before);
    expect([...out.map((tile) => tile.id)].sort()).toEqual([...before].sort());
  });

  it('draws numbers in [0, 1)', () => {
    const random = seededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const x = random();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
