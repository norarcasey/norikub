/**
 * Where the face-down tiles lie in the pile, as spot numbers parallel to the pool: `pile[i]` is
 * the spot of the pool's tile `i`.
 *
 * A spot is fixed for the whole game, so taking a tile leaves a gap and nothing else moves. It
 * cannot be the pool index, because a draw shifts every index after it, and it must not be
 * worked out from the tile, because then the page would say which tile lies where. So the
 * deal gives pool index k spot k (the pool is shuffled, so that says nothing), and each draw
 * takes its spot out of the list (KUB-25).
 */
export type Pile = readonly number[];

export function dealPile(size: number): Pile {
  return Array.from({ length: size }, (_, spot) => spot);
}

export function takeFromPile(pile: Pile, at: number): Pile {
  return pile.filter((_, i) => i !== at);
}

/**
 * The pile for a pool of `size`: this one if it fits, otherwise a fresh deal. A pile only fails
 * to fit after the spots were lost, as on a reload before KUB-6 saves them.
 */
export function fitPile(pile: Pile | undefined, size: number): Pile {
  return pile?.length === size ? pile : dealPile(size);
}

/** Where a spot lies, as fractions of the pile's area (`x`, `y`), and how far it is turned. */
export type Spot = { readonly x: number; readonly y: number; readonly turn: number };

/**
 * A spot's place, the same every time for the same spot. Each coordinate leans two parts to one
 * draw and one to another, so the pile is thicker in the middle than at its edges, as tiles
 * tipped out of a bag are, but not so thick that tiles are buried. With an even mean of two
 * draws, 12 of 61 tiles had no point left to tap at 390 px wide (22 Nov 2026, Chromium).
 */
export function pileSpot(spot: number): Spot {
  const next = noise(spot);
  return {
    x: (2 * next() + next()) / 3,
    y: (2 * next() + next()) / 3,
    turn: Math.round((next() * 2 - 1) * 40),
  };
}

/** A small seeded generator (mulberry32): fractions in [0, 1), the same sequence per seed. */
function noise(seed: number): () => number {
  let state = (seed + 1) * 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
