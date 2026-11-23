import { describe, expect, it } from 'vitest';

import { proposeTurn } from './bot.ts';
import { layout, ts } from './fixtures.test-helpers.ts';
import { finish, seatView } from './game.ts';
import { parse } from './parse.ts';
import { seededRandom } from './random.ts';
import { apply, deal, newTable, sitDown, tableSchema, tableViewFor, turnOf } from './table.ts';
import type { Applied, Outcome, Table, TurnMessage } from './table.ts';
import type { Move } from './turn.ts';

function seated(...names: string[]): Table {
  return names.reduce((table, name) => {
    const sat = sitDown(table, name);
    if (!sat.ok) throw new Error(JSON.stringify(sat.refusal));
    return sat.value.table;
  }, newTable());
}

function dealt(seed: number, ...names: string[]): Table {
  const result = deal(seated(...names), 0, seed);
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value;
}

function ok(result: Outcome<Applied>): Applied {
  if (!result.ok) throw new Error(JSON.stringify(result.refusal));
  return result.value;
}

function playing(table: Table): Extract<Table, { phase: 'playing' }> {
  if (table.phase !== 'playing') throw new Error('not dealt');
  return table;
}

/** A table laid out by hand: seat 0 to play, nothing moved yet. */
function laidOut(...args: Parameters<typeof layout>): Extract<Table, { phase: 'playing' }> {
  const game = layout(...args);
  return { phase: 'playing', names: game.players.map((p) => p.name), game, working: null };
}

/** Every tile id anywhere in a value, however deep: what a page could read off a message. */
function idsIn(value: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) {
      for (const [key, inner] of Object.entries(v)) {
        if (key === 'id' && typeof inner === 'string') found.add(inner);
        else walk(inner);
      }
    }
  };
  walk(value);
  return found;
}

/**
 * The tiles seat `a` must never be shown: the pool, and every other seat's rack as it is right
 * now, which for the mover is the working rack, since a tile the mover has put down mid-turn
 * is on the table in front of everyone.
 */
function hiddenFrom(table: Extract<Table, { phase: 'playing' }>, a: number): Set<string> {
  const turn = turnOf(table);
  const hidden = new Set(table.game.pool.map((tile) => tile.id));
  table.game.players.forEach((player, b) => {
    if (b === a) return;
    const rack = b === turn.seat ? turn.rack : player.rack;
    for (const tile of rack) hidden.add(tile.id);
  });
  return hidden;
}

describe('seating and the deal', () => {
  it('seats friends in the order they sit down, two to four', () => {
    const table = seated('Nora', 'Ana', 'Bo', 'Cy');
    expect(table.names).toEqual(['Nora', 'Ana', 'Bo', 'Cy']);
    expect(sitDown(table, 'Di')).toEqual({
      ok: false,
      refusal: { kind: 'table', refusal: { kind: 'table-full' } },
    });
    expect(sitDown(seated('Nora'), 'Ana')).toMatchObject({ ok: true, value: { seat: 1 } });
  });

  it('is dealt by the first seat once two are seated, and by no one else', () => {
    const refusal = (kind: string): unknown => ({
      ok: false,
      refusal: { kind: 'table', refusal: { kind } },
    });
    expect(deal(seated('Nora'), 0, 1)).toEqual(refusal('waiting-for-players'));
    expect(deal(seated('Nora', 'Ana'), 1, 1)).toEqual(refusal('only-the-first-seat-deals'));
    const table = dealt(1, 'Nora', 'Ana');
    expect(deal(table, 0, 2)).toEqual(refusal('already-dealt'));
    expect(sitDown(table, 'Bo')).toEqual(refusal('already-dealt'));
    expect(parse(tableSchema, table).ok).toBe(true);
  });

  it('deals the same table from the same seed, and starts on a random seat', () => {
    expect(dealt(7, 'A', 'B', 'C')).toEqual(dealt(7, 'A', 'B', 'C'));
    const firsts = new Set(
      Array.from({ length: 40 }, (_, seed) => playing(dealt(seed, 'A', 'B', 'C')).game.current),
    );
    expect(firsts).toEqual(new Set([0, 1, 2]));
  });

  it('deals again for the same seats once a game is over', () => {
    const table = playing(dealt(3, 'Nora', 'Ana'));
    const over = { ...table, game: finish(table.game, 0, 'rack-emptied') };
    const again = deal(over, 0, 4);
    expect(again).toMatchObject({ ok: true, value: { names: ['Nora', 'Ana'], working: null } });
    expect(apply(over, over.game.current, { type: 'end-turn' })).toEqual({
      ok: false,
      refusal: { kind: 'table', refusal: { kind: 'game-over' } },
    });
  });
});

describe('a turn message', () => {
  const table = laidOut([
    { rack: ['red-10-a', 'red-11-a', 'red-12-a', 'blue-1-a'] },
    { rack: ['black-5-a'] },
  ]);
  const messages: TurnMessage[] = [
    { type: 'move', move: { kind: 'to-new-set', tileId: 'black-5-a' } },
    { type: 'take-back' },
    { type: 'end-turn' },
    { type: 'draw', pick: null },
  ];

  it('is refused from every seat whose turn it is not, before the engine sees it', () => {
    for (const message of messages) {
      expect(apply(table, 1, message)).toEqual({
        ok: false,
        refusal: { kind: 'table', refusal: { kind: 'not-your-turn' } },
      });
      expect(apply(table, 5, message)).toMatchObject({
        refusal: { refusal: { kind: 'no-such-seat' } },
      });
      expect(apply(newTable(), 0, message)).toMatchObject({
        refusal: { refusal: { kind: 'not-dealt' } },
      });
    }
  });

  it("passes the engine's own refusals on unchanged", () => {
    expect(apply(table, 0, messages[0] ?? { type: 'end-turn' })).toEqual({
      ok: false,
      refusal: { kind: 'move', refusal: { kind: 'no-such-tile', tileId: 'black-5-a' } },
    });
    expect(apply(table, 0, { type: 'end-turn' })).toEqual({
      ok: false,
      refusal: { kind: 'end-turn', faults: [{ kind: 'nothing-played' }] },
    });
    expect(apply(table, 0, { type: 'draw', pick: 500 })).toEqual({
      ok: false,
      refusal: { kind: 'draw', refusal: 'no-such-tile' },
    });
  });

  it('keeps the working turn, takes it back, and ends it through the engine', () => {
    const toNew = (tileId: string): TurnMessage => ({
      type: 'move',
      move: { kind: 'to-new-set', tileId },
    });
    const toSet = (tileId: string): TurnMessage => ({
      type: 'move',
      move: { kind: 'to-set', tileId, set: 0 },
    });
    const one = ok(apply(table, 0, toNew('red-10-a'))).table;
    expect(one).toMatchObject({ working: { table: [ts('red-10-a')] } });
    expect(ok(apply(one, 0, { type: 'take-back' })).table).toEqual(table);

    expect(apply(one, 0, { type: 'end-turn' })).toEqual({
      ok: false,
      refusal: {
        kind: 'end-turn',
        faults: [
          { kind: 'invalid-set', set: 0 },
          { kind: 'first-meld-under-30', points: 0 },
        ],
      },
    });

    const melded = laidOut([
      { rack: ['red-10-a', 'red-11-a', 'red-12-a', 'red-13-a'] },
      { rack: [] },
    ]);
    const four = ['red-11-a', 'red-12-a', 'red-13-a'].reduce(
      (t, id) => ok(apply(t, 0, toSet(id))).table,
      ok(apply(melded, 0, toNew('red-10-a'))).table,
    );
    const ended = playing(ok(apply(four, 0, { type: 'end-turn' })).table);
    expect(ended.working).toBeNull();
    expect(ended.game.status.kind).toBe('over');
  });

  it('draws by pick, and tells every seat where from but not what', () => {
    const at = ok(apply(table, 0, { type: 'draw', pick: 3 }));
    expect(at.drew).toEqual({ seat: 0, drewAt: 3 });
    const drawn = table.game.pool[3];
    expect(playing(at.table).game.players[0]?.rack.at(-1)).toEqual(drawn);
    expect(at.drew === null ? [] : [...idsIn(at.drew)]).toEqual([]);

    const last = ok(apply(table, 0, { type: 'draw', pick: null }));
    expect(last.drew).toEqual({ seat: 0, drewAt: table.game.pool.length - 1 });

    const empty = { ...table, game: { ...table.game, pool: [] } };
    expect(ok(apply(empty, 0, { type: 'draw', pick: null })).drew).toEqual({
      seat: 0,
      drewAt: null,
    });
  });

  it('starts the turn over rather than trust a stored working turn that lost a tile', () => {
    const one = playing(
      ok(apply(table, 0, { type: 'move', move: { kind: 'to-new-set', tileId: 'red-10-a' } })).table,
    );
    const lost = { ...one, working: { rack: [], table: [] } };
    expect(turnOf(lost).rack).toEqual(table.game.players[0]?.rack);
    expect(turnOf(lost).table).toEqual([]);
  });
});

/** Whole games played by the exhaustive test below; 30 take 1.4s on this Mac (22 Nov 2026). */
const SEEDS = 30;

describe('what each seat is sent', () => {
  it('before the deal, the names and nothing else', () => {
    expect(tableViewFor(seated('Nora', 'Ana'), 1)).toEqual({
      phase: 'seating',
      you: 1,
      names: ['Nora', 'Ana'],
    });
  });

  /**
   * The ticket's done-when: many whole games at tables of two to four, every message a page
   * could send from every seat, legal or not, including half-reworked tables, take-backs,
   * draws by pick and the bots' real turns, and after each one every seat's view is checked
   * for any tile of another seat's rack or of the pool.
   */
  it('never holds a tile from another seat’s rack or from the pool, mid-turn or after a draw', () => {
    let views = 0;
    let midTurn = 0;
    let draws = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = seededRandom(seed * 7919);
      const pick = <T>(items: readonly T[]): T | undefined =>
        items[Math.floor(random() * items.length)];
      const names = ['Nora', 'Ana', 'Bo', 'Cy'].slice(0, 2 + (seed % 3));
      let table = playing(dealt(seed, ...names));

      const check = (): void => {
        for (let a = 0; a < names.length; a++) {
          const view = tableViewFor(table, a);
          if (view.phase !== 'playing') throw new Error('not dealt');
          const hidden = hiddenFrom(table, a);
          const leaked = [...idsIn(view)].filter((id) => hidden.has(id));
          expect(leaked, `seed ${seed}, seat ${a}`).toEqual([]);

          const turn = turnOf(table);
          expect(view.view.rack).toEqual(a === turn.seat ? turn.rack : table.game.players[a]?.rack);
          for (const o of view.view.opponents) {
            const count =
              o.seat === turn.seat ? turn.rack.length : table.game.players[o.seat]?.rack.length;
            expect(o.tileCount).toBe(count);
          }
          if (table.working !== null) expect(view.view.table).toEqual(table.working.table);
          views++;
        }
      };

      const send = (message: TurnMessage): void => {
        const result = apply(table, table.game.current, message);
        // A message from a seat whose turn it is not changes nothing, whatever it says.
        const other = (table.game.current + 1) % names.length;
        expect(apply(table, other, message).ok).toBe(false);
        if (result.ok) {
          table = playing(result.value.table);
          if (result.value.drew !== null) {
            draws++;
            expect(idsIn(result.value.drew).size).toBe(0);
          }
        }
        if (table.working !== null) midTurn++;
        check();
      };

      for (let step = 0; step < 300 && table.game.status.kind === 'playing'; step++) {
        const turn = turnOf(table);
        const roll = random();
        if (roll < 0.5) {
          const tile = pick([...turn.rack, ...turn.table.flat()]);
          if (tile === undefined) continue;
          const set = Math.floor(random() * (turn.table.length + 1));
          const moves: Move[] = [
            { kind: 'to-set', tileId: tile.id, set },
            { kind: 'onto-set', tileId: tile.id, set },
            { kind: 'to-new-set', tileId: tile.id },
            { kind: 'to-rack', tileId: tile.id },
          ];
          send({ type: 'move', move: pick(moves) ?? { kind: 'to-new-set', tileId: tile.id } });
        } else if (roll < 0.58) {
          send({ type: 'take-back' });
        } else if (roll < 0.64) {
          send({ type: 'end-turn' });
        } else if (roll < 0.74) {
          const at = Math.floor(random() * (table.game.pool.length + 1));
          send({ type: 'draw', pick: random() < 0.3 ? null : at });
        } else {
          // The bot's turn for this seat, sent as a page would send it.
          send({ type: 'take-back' });
          const proposal = proposeTurn(seatView(table.game, table.game.current));
          if (proposal.kind === 'draw') send({ type: 'draw', pick: null });
          else {
            for (const m of proposal.moves) send({ type: 'move', move: m });
            send({ type: 'end-turn' });
          }
        }
      }
    }
    // About half of what 30 seeds gave on 22 Nov 2026 (35,916 views, 6,338 of them mid-turn,
    // 1,638 draws), so a change that stopped exercising a case fails here instead of passing.
    expect(views).toBeGreaterThan(18_000);
    expect(midTurn).toBeGreaterThan(3_000);
    expect(draws).toBeGreaterThan(800);
  }, 20_000);
});
