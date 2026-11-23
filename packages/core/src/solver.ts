import { COLOURS, isNumber } from './tiles.ts';
import type { Tile } from './tiles.ts';

/**
 * What a rack tile laid down is worth to the solver. A joker's `value` is the number it stands
 * for where the solver put it.
 */
export type Worth = (tile: { readonly joker: boolean; readonly value: number }) => number;

/**
 * The best table that can be made from every tile on it and any of the rack's: each table
 * tile ends in a valid set, and the rack tiles used are worth the most by `worth`. This is
 * every rearrangement a person can make by hand in a turn — breaking sets up, splitting runs,
 * taking a joker back by replacing it, moving tiles from set to set — found exactly rather
 * than searched for.
 *
 * Null when the table cannot be read as one the solver makes. The one kind it cannot represent
 * uses a joker as a third copy of a tile, both real copies already in sets (three red runs
 * through red 5, or a group whose joker is a colour two runs already hold at that number). A
 * caller falls back to a plainer bot then.
 *
 * How: a dynamic programme over the 52 kinds of numbered tile, number by number and colour by
 * colour. Runs of one colour overlap at most twice, since the box holds two copies of each
 * tile, so each colour carries two open run slots whose length matters only up to 3: a run of
 * 3 or more may end, a shorter one may not. The tiles of one number not fed into runs must make
 * up to two groups of distinct colours, which is decided by how many there are and whether any
 * colour has two. A joker is a tile of whatever colour and number its place needs. The state is
 * the run slots, the jokers placed and that group tally: 10^4 slot pairs × 3 × 9 × 2 at the
 * very most, against the 2^rack subsets of the rack a search would try.
 */
export function solveTable(
  table: readonly Tile[],
  rack: readonly Tile[],
  worth: Worth,
): Tile[][] | null {
  const plan: Plan = {
    table: byKind(table),
    rack: byKind(rack),
    tableJokers: table.filter((tile) => !isNumber(tile)),
    rackJokers: rack.filter((tile) => !isNumber(tile)),
  };
  const memo = Array.from({ length: STEPS + 1 }, () => new Map<number, number>());

  const best = (step: number, state: State): number => {
    const key = encode(state);
    const known = memo[step]?.get(key);
    if (known !== undefined) return known;
    let value = NEVER;
    if (step === STEPS) {
      if (closes(state) && state.jokers >= plan.tableJokers.length) value = 0;
    } else {
      for (const option of optionsAt(plan, step, state, worth)) {
        const rest = best(step + 1, option.next);
        if (rest !== NEVER) value = Math.max(value, option.gain + rest);
      }
    }
    memo[step]?.set(key, value);
    return value;
  };

  const start: State = { slots: [0, 0, 0, 0], jokers: 0, sum: 0, two: false };
  if (best(0, start) === NEVER) return null;

  // Walk the best path again, taking at each step an option that keeps to it.
  const path: Option[] = [];
  let state = start;
  for (let step = 0; step < STEPS; step++) {
    const target = best(step, state);
    const chosen = optionsAt(plan, step, state, worth).find(
      (option) => option.gain + best(step + 1, option.next) === target,
    );
    if (chosen === undefined) return null;
    path.push(chosen);
    state = chosen.next;
  }
  return build(plan, path);
}

const STEPS = 13 * COLOURS.length;
const NEVER = Number.NEGATIVE_INFINITY;

/** A colour's two open run slots as an unordered pair of lengths 0–3 (3 is 3 or more). */
const PAIRS: readonly (readonly [number, number])[] = [0, 1, 2, 3].flatMap((a) =>
  [0, 1, 2, 3].filter((b) => b >= a).map((b): [number, number] => [a, b]),
);

function pairOf(a: number, b: number): number {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return PAIRS.findIndex(([x, y]) => x === low && y === high);
}

type State = {
  /** Per colour, an index into PAIRS. */
  readonly slots: readonly number[];
  readonly jokers: number;
  /** Tiles of the current number going to groups, and whether one colour sends two. */
  readonly sum: number;
  readonly two: boolean;
};

function encode(state: State): number {
  const slots = state.slots.reduce((n, pair) => n * PAIRS.length + pair, 0);
  return ((slots * 3 + state.jokers) * 9 + state.sum) * 2 + (state.two ? 1 : 0);
}

/** Every slot of every colour is empty or holds a run long enough to end. */
function closes(state: State): boolean {
  return state.slots.every((pair) => (PAIRS[pair] ?? [1, 1]).every((n) => n === 0 || n === 3));
}

/**
 * The tiles of one number left over from runs make whole groups: one group of 3 or 4 when no
 * colour has two, or two groups, each needing 3, when one does. Four colours cap a group at 4.
 */
function groupsFit(sum: number, two: boolean): boolean {
  if (sum === 0) return true;
  return two ? sum >= 6 : sum >= 3;
}

type Plan = {
  readonly table: ReadonlyMap<string, readonly Tile[]>;
  readonly rack: ReadonlyMap<string, readonly Tile[]>;
  readonly tableJokers: readonly Tile[];
  readonly rackJokers: readonly Tile[];
};

function byKind(tiles: readonly Tile[]): Map<string, Tile[]> {
  const out = new Map<string, Tile[]>();
  for (const tile of tiles) {
    if (!isNumber(tile)) continue;
    const kind = `${tile.colour}-${tile.value}`;
    out.set(kind, [...(out.get(kind) ?? []), tile]);
  }
  return out;
}

type Option = {
  readonly colour: number;
  readonly value: number;
  /** Real tiles of this kind used: every one on the table, then this many from the rack. */
  readonly fromRack: number;
  readonly jokers: number;
  /** Which of the colour's slots, shorter first, this kind's tiles extend. */
  readonly fed: readonly [boolean, boolean];
  readonly gain: number;
  readonly next: State;
};

const FEEDS: readonly (readonly [boolean, boolean])[] = [
  [false, false],
  [true, false],
  [false, true],
  [true, true],
];

/** Every way the tiles of one kind can go at this step, and the state each leaves. */
function optionsAt(plan: Plan, step: number, state: State, worth: Worth): Option[] {
  const colour = step % COLOURS.length;
  const value = Math.floor(step / COLOURS.length) + 1;
  const kind = `${COLOURS[colour] ?? ''}-${value}`;
  const onTable = plan.table.get(kind)?.length ?? 0;
  const inRack = plan.rack.get(kind)?.length ?? 0;
  const jokersLeft = plan.tableJokers.length + plan.rackJokers.length - state.jokers;
  const [low, high] = PAIRS[state.slots[colour] ?? 0] ?? [0, 0];
  const last = colour === COLOURS.length - 1;

  const out: Option[] = [];
  for (let fromRack = 0; fromRack <= inRack; fromRack++) {
    for (let jokers = 0; jokers <= jokersLeft; jokers++) {
      const tiles = onTable + fromRack + jokers;
      for (const fed of FEEDS) {
        const feeding = fed.filter(Boolean).length;
        const group = tiles - feeding;
        if (group < 0 || group > 2) continue;
        // A slot not fed ends here, which only an empty slot or a run of 3 or more can do.
        if ((!fed[0] && low !== 0 && low !== 3) || (!fed[1] && high !== 0 && high !== 3)) continue;
        const sum = state.sum + group;
        const two = state.two || group === 2;
        if (last && !groupsFit(sum, two)) continue;
        const slots = [...state.slots];
        slots[colour] = pairOf(
          fed[0] ? Math.min(low + 1, 3) : 0,
          fed[1] ? Math.min(high + 1, 3) : 0,
        );
        let gain = fromRack * worth({ joker: false, value });
        // The first jokers placed are the table's, which must be placed and earn nothing.
        for (let j = state.jokers; j < state.jokers + jokers; j++) {
          if (j >= plan.tableJokers.length) gain += worth({ joker: true, value });
        }
        out.push({
          colour,
          value,
          fromRack,
          jokers,
          fed,
          gain,
          next: {
            slots,
            jokers: state.jokers + jokers,
            sum: last ? 0 : sum,
            two: last ? false : two,
          },
        });
      }
    }
  }
  return out;
}

/** The sets a path through the programme describes, with real tiles in every place. */
function build(plan: Plan, path: readonly Option[]): Tile[][] {
  const sets: Tile[][] = [];
  const runs: Tile[][][] = COLOURS.map(() => [[], []]);
  const jokers = [...plan.tableJokers, ...plan.rackJokers];
  let groups: Tile[][] = [];

  for (const option of path) {
    const kind = `${COLOURS[option.colour] ?? ''}-${option.value}`;
    const tiles = [
      ...(plan.table.get(kind) ?? []),
      ...(plan.rack.get(kind) ?? []).slice(0, option.fromRack),
      ...jokers.splice(0, option.jokers),
    ];
    // Shorter first, as the programme's pairs are, so `fed` names the same slots.
    const slots = [...(runs[option.colour] ?? [])].sort(
      (a, b) => Math.min(a.length, 3) - Math.min(b.length, 3),
    );
    slots.forEach((slot, i) => {
      if (option.fed[i] === true) {
        const tile = tiles.shift();
        if (tile !== undefined) slot.push(tile);
      } else if (slot.length > 0) {
        sets.push([...slot]);
        slot.length = 0;
      }
    });
    runs[option.colour] = slots;
    if (tiles.length > 0) groups.push(tiles);

    if (option.colour === COLOURS.length - 1) {
      sets.push(...formGroups(groups));
      groups = [];
    }
  }
  for (const slots of runs) for (const slot of slots) if (slot.length > 0) sets.push(slot);
  return sets;
}

/**
 * One number's leftover tiles, by colour, as groups: one group, or two when a colour has two
 * tiles, that colour in both and the rest dealt to whichever is shorter.
 */
function formGroups(byColour: readonly (readonly Tile[])[]): Tile[][] {
  if (byColour.length === 0) return [];
  if (byColour.every((tiles) => tiles.length === 1)) return [byColour.flat()];
  const a: Tile[] = [];
  const b: Tile[] = [];
  const doubled = byColour.filter((tiles) => tiles.length === 2);
  const single = byColour.filter((tiles) => tiles.length === 1);
  for (const [first, second] of doubled) {
    if (first !== undefined) a.push(first);
    if (second !== undefined) b.push(second);
  }
  for (const [tile] of single) if (tile !== undefined) (a.length <= b.length ? a : b).push(tile);
  return [a, b];
}
