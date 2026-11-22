import { FIRST_MELD_POINTS, draw, seatView } from './game.ts';
import type { Game, SeatView } from './game.ts';
import { judgeSet } from './sets.ts';
import { COLOURS } from './tiles.ts';
import type { Tile } from './tiles.ts';
import { endTurn, move, startTurn } from './turn.ts';
import type { Move, Turn } from './turn.ts';

/**
 * What a bot hands back: a turn for the engine to judge, or a draw. It never hands back a
 * table, only the moves that would make one, so it goes through exactly the door a person's
 * drags do (invariant 1).
 */
export type Proposal =
  { readonly kind: 'draw' } | { readonly kind: 'play'; readonly moves: readonly Move[] };

/** A bot is a function of what its seat can see, and of nothing else (invariant 2). */
export type Bot = (view: SeatView) => Proposal;

/** A set the bot could make, as the kinds of tile it needs: `red-5`, `joker`. */
type Candidate = { readonly needs: readonly string[]; readonly points: number };

// The search over combinations of candidate sets stops here. Over 150 seeded three-bot games
// (21 Nov 2026, on this laptop) the slowest whole bot turn took 1.7 ms; the bound only ever
// costs the bot a better combination, never legality.
const SEARCH_LIMIT = 4000;

/**
 * The first bot, deliberately plain:
 * 1. Lay down the best combination of sets from the rack alone. Before the first meld this is
 *    the whole turn, and only if it reaches 30.
 * 2. Once melded, add single rack tiles to any set they fit.
 * 3. Once melded, take a spare tile off the end of a long set or a group of four to finish a
 *    new set with two rack tiles.
 * Steps 2 and 3 repeat until neither finds anything. With nothing played, it draws.
 *
 * Step 3 only ever takes a tile from a set of four or more, so no set empties and the indices
 * of the sets on the table never shift under the moves it emits.
 */
export function proposeTurn(view: SeatView): Proposal {
  const table: Tile[][] = view.table.map((set) => [...set]);
  let rack: Tile[] = [...view.rack];
  const moves: Move[] = [];

  const layNewSet = (tiles: readonly Tile[]): void => {
    const index = table.length;
    table.push([...tiles]);
    tiles.forEach((tile, i) => {
      moves.push(
        i === 0
          ? { kind: 'to-new-set', tileId: tile.id }
          : { kind: 'to-set', tileId: tile.id, set: index },
      );
    });
    const used = new Set(tiles.map((tile) => tile.id));
    rack = rack.filter((tile) => !used.has(tile.id));
  };

  const fromRack = bestSets(rack, view.hasMelded ? 'tiles' : 'points');
  const meldPoints = fromRack.reduce((sum, set) => sum + pointsOf(set), 0);
  if (!view.hasMelded) {
    if (meldPoints < FIRST_MELD_POINTS) return { kind: 'draw' };
    fromRack.forEach(layNewSet);
    return { kind: 'play', moves };
  }
  fromRack.forEach(layNewSet);

  let changed = true;
  while (changed) {
    changed = false;
    for (const tile of [...rack]) {
      const index = table.findIndex((set) => judgeSet([...set, tile]).valid);
      const set = table[index];
      if (set === undefined) continue;
      set.push(tile);
      rack = rack.filter((t) => t.id !== tile.id);
      moves.push({ kind: 'to-set', tileId: tile.id, set: index });
      changed = true;
    }
    const borrowed = borrowToFinish(table, rack);
    if (borrowed !== null) {
      const { pair, spare, from } = borrowed;
      const source = table[from];
      if (source !== undefined) table[from] = source.filter((t) => t.id !== spare.id);
      layNewSet(pair);
      table[table.length - 1]?.push(spare);
      moves.push({ kind: 'to-set', tileId: spare.id, set: table.length - 1 });
      changed = true;
    }
  }
  return moves.length > 0 ? { kind: 'play', moves } : { kind: 'draw' };
}

/** Two rack tiles and one tile a long set can spare that make a set together, if any do. */
function borrowToFinish(
  table: readonly (readonly Tile[])[],
  rack: readonly Tile[],
): { pair: readonly [Tile, Tile]; spare: Tile; from: number } | null {
  for (const [from, set] of table.entries()) {
    if (set.length < 4) continue;
    for (const spare of set) {
      if (!judgeSet(set.filter((t) => t.id !== spare.id)).valid) continue;
      for (let i = 0; i < rack.length; i++) {
        for (let j = i + 1; j < rack.length; j++) {
          const a = rack[i];
          const b = rack[j];
          if (a === undefined || b === undefined) continue;
          if (judgeSet([a, b, spare]).valid) return { pair: [a, b], spare, from };
        }
      }
    }
  }
  return null;
}

function pointsOf(set: readonly Tile[]): number {
  const verdict = judgeSet(set);
  return verdict.valid ? verdict.points : 0;
}

function kindOf(tile: Tile): string {
  return tile.kind === 'joker' ? 'joker' : `${tile.colour}-${tile.value}`;
}

/**
 * The combination of disjoint sets from these tiles that scores best: the most points (for a
 * first meld, which needs 30) or the most tiles (afterwards, to empty the rack). A depth-first
 * search over candidate sets, bounded by SEARCH_LIMIT.
 */
export function bestSets(tiles: readonly Tile[], by: 'points' | 'tiles'): Tile[][] {
  const stock = new Map<string, Tile[]>();
  for (const tile of tiles) stock.set(kindOf(tile), [...(stock.get(kindOf(tile)) ?? []), tile]);
  const counts = new Map([...stock].map(([kind, list]) => [kind, list.length]));
  const candidates = candidateSets(counts);
  const score = (c: Candidate): number => (by === 'points' ? c.points : c.needs.length);

  let best: Candidate[] = [];
  let bestScore = 0;
  let nodes = 0;
  const chosen: Candidate[] = [];
  const search = (from: number, total: number): void => {
    nodes++;
    if (total > bestScore) {
      best = [...chosen];
      bestScore = total;
    }
    for (let i = from; i < candidates.length && nodes < SEARCH_LIMIT; i++) {
      const candidate = candidates[i];
      if (candidate === undefined || !fits(candidate, counts)) continue;
      take(candidate, counts, -1);
      chosen.push(candidate);
      search(i, total + score(candidate));
      chosen.pop();
      take(candidate, counts, 1);
    }
  };
  search(0, 0);

  return best.map((candidate) =>
    candidate.needs.flatMap((kind) => {
      const tile = stock.get(kind)?.shift();
      return tile === undefined ? [] : [tile];
    }),
  );
}

function fits(candidate: Candidate, counts: ReadonlyMap<string, number>): boolean {
  const need = new Map<string, number>();
  for (const kind of candidate.needs) need.set(kind, (need.get(kind) ?? 0) + 1);
  return [...need].every(([kind, n]) => (counts.get(kind) ?? 0) >= n);
}

function take(candidate: Candidate, counts: Map<string, number>, sign: 1 | -1): void {
  for (const kind of candidate.needs) counts.set(kind, (counts.get(kind) ?? 0) + sign);
}

/** Every run and group these tiles could make on their own, best-scoring first. */
function candidateSets(counts: ReadonlyMap<string, number>): Candidate[] {
  const jokers = counts.get('joker') ?? 0;
  const has = (kind: string): boolean => (counts.get(kind) ?? 0) > 0;
  const out: Candidate[] = [];
  const add = (needs: string[]): void => {
    out.push({ needs, points: pointsOf(needs.map(representative)) });
  };

  for (const colour of COLOURS) {
    for (let low = 1; low <= 11; low++) {
      for (let high = low + 2; high <= 13; high++) {
        const needs: string[] = [];
        for (let value = low; value <= high; value++) {
          needs.push(has(`${colour}-${value}`) ? `${colour}-${value}` : 'joker');
        }
        const wild = needs.filter((kind) => kind === 'joker').length;
        if (wild <= jokers && wild < needs.length) add(needs);
      }
    }
  }
  for (let value = 1; value <= 13; value++) {
    const colours = COLOURS.filter((colour) => has(`${colour}-${value}`));
    for (const subset of subsets(colours)) {
      for (let wild = 0; wild <= jokers; wild++) {
        const size = subset.length + wild;
        if (subset.length === 0 || size < 3 || size > 4) continue;
        add([
          ...subset.map((colour) => `${colour}-${value}`),
          ...Array<string>(wild).fill('joker'),
        ]);
      }
    }
  }
  return out.sort((a, b) => b.points - a.points || b.needs.length - a.needs.length);
}

function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((all, item) => [...all, ...all.map((s) => [...s, item])], [[]]);
}

/** A stand-in tile for a kind, to score a candidate before real tiles are chosen for it. */
function representative(kind: string, index: number): Tile {
  const [colour, value] = kind.split('-');
  const found = COLOURS.find((c) => c === colour);
  if (found === undefined) return { kind: 'joker', id: `joker-${index}` };
  return { kind: 'number', id: `${kind}-${index}`, colour: found, value: Number(value) };
}

export type BotTurn = {
  readonly game: Game;
  readonly proposal: Proposal;
  /** False when the engine refused the proposal and the seat drew instead. */
  readonly accepted: boolean;
};

/**
 * One bot turn, from the game's side: the bot is handed its seat view and nothing more, and
 * what it proposes goes through the engine like any player's turn. A refused proposal is taken
 * back and the seat draws, so a bot with a bug costs itself a turn instead of stalling a game;
 * `accepted` says it happened, and the tests hold it never does.
 */
export function takeBotTurn(game: Game, bot: Bot = proposeTurn): BotTurn {
  const proposal = bot(seatView(game, game.current));
  if (proposal.kind === 'play') {
    const played = applyMoves(startTurn(game), proposal.moves);
    const ended = played === null ? null : endTurn(played);
    if (ended?.ok === true) return { game: ended.game, proposal, accepted: true };
  }
  const drawn = draw(game);
  return { game: drawn.ok ? drawn.game : game, proposal, accepted: proposal.kind === 'draw' };
}

function applyMoves(turn: Turn, moves: readonly Move[]): Turn | null {
  let current = turn;
  for (const m of moves) {
    const result = move(current, m);
    if (!result.ok) return null;
    current = result.turn;
  }
  return current;
}
