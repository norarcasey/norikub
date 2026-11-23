import { describe, expect, it } from 'vitest';

import { AWAY_TURN_MS, awayOffer, settleAway, voteAway } from './away.ts';
import type { Stall } from './away.ts';
import { layout } from './fixtures.test-helpers.ts';
import { apply, newTable } from './table.ts';
import type { Table } from './table.ts';

const MIN = AWAY_TURN_MS;
/** Where a draw takes the last tile of a fresh `playing()` pool from. */
const LAST = playing().game.pool.length - 1;

/** Ana to play, at a table of three; Ana has a run in her rack and has melded. */
function playing(): Extract<Table, { phase: 'playing' }> {
  const game = layout(
    [
      { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'], hasMelded: true },
      { rack: ['black-5-a', 'black-6-a'] },
      { rack: ['orange-7-a', 'orange-8-a'] },
    ],
    [['blue-1-a', 'blue-2-a', 'blue-3-a']],
  );
  return { phase: 'playing', names: ['Ana', 'Bo', 'Cy'], bots: [], game, working: null };
}

const ALL_HERE = [true, true, true];
const ANA_AWAY = [false, true, true];

/** Settles at `now` and returns the stall, for a test that draws nothing. */
function stallAt(table: Table, stall: Stall | null, here: boolean[], now: number): Stall | null {
  const settled = settleAway(table, stall, here, now);
  expect(settled.drew).toBeNull();
  expect(settled.table).toBe(table);
  return settled.stall;
}

function vote(table: Table, stall: Stall | null, here: boolean[], now: number, seat: number) {
  const voted = voteAway(table, stall, here, now, seat, true);
  if (!voted.ok) throw new Error(`refused: ${JSON.stringify(voted.refusal)}`);
  return voted.value;
}

describe('a seat away on its turn', () => {
  it('holds nothing up while the seat to play is here, or before the deal, or once it is over', () => {
    expect(stallAt(playing(), null, ALL_HERE, 0)).toBeNull();
    expect(stallAt(newTable(), null, [false], 0)).toBeNull();
    const table = playing();
    const over: Table = {
      ...table,
      game: {
        ...table.game,
        status: { kind: 'over', winner: 1, reason: 'rack-emptied', scores: [] },
      },
    };
    expect(stallAt(over, null, ANA_AWAY, 0)).toBeNull();
  });

  it('starts the clock when the seat to play goes, and keeps it while it stays away', () => {
    const table = playing();
    const stall = stallAt(table, null, ANA_AWAY, 1_000);
    expect(stall).toEqual({ seat: 0, since: 1_000, yes: [] });
    expect(stallAt(table, stall, ANA_AWAY, 30_000)).toBe(stall);
    // Back before the minute: the question never comes.
    expect(stallAt(table, stall, ALL_HERE, 30_000)).toBeNull();
  });

  it('asks only after a minute, and only the seats that are here', () => {
    const table = playing();
    const stall = stallAt(table, null, ANA_AWAY, 0);
    expect(awayOffer(stall, ANA_AWAY, MIN - 1)).toBeNull();
    expect(awayOffer(stall, ANA_AWAY, MIN)).toEqual({ seat: 0, voters: [1, 2], yes: [] });
    expect(awayOffer(stall, [false, true, false], MIN)).toEqual({ seat: 0, voters: [1], yes: [] });
    // With nobody to ask there is no question.
    expect(awayOffer(stall, [false, false, false], MIN)).toBeNull();
    expect(awayOffer(null, ANA_AWAY, MIN)).toBeNull();
  });

  it('refuses a vote before the minute, from the away seat, or at a cancelled table', () => {
    const table = playing();
    const stall = stallAt(table, null, ANA_AWAY, 0);
    const noTurn = { ok: false, refusal: { kind: 'table', refusal: { kind: 'no-away-turn' } } };
    expect(voteAway(table, stall, ANA_AWAY, MIN - 1, 1, true)).toEqual(noTurn);
    expect(voteAway(table, stall, ANA_AWAY, MIN, 0, true)).toEqual(noTurn);
    expect(voteAway(table, null, ALL_HERE, MIN, 1, true)).toEqual(noTurn);
    const cancelled: Table = { phase: 'cancelled', names: table.names, bots: [], by: 1 };
    expect(voteAway(cancelled, stall, ANA_AWAY, MIN, 1, true)).toEqual({
      ok: false,
      refusal: { kind: 'table', refusal: { kind: 'cancelled' } },
    });
  });

  it('waits for every seat asked, lets a yes be taken back, and draws once all agree', () => {
    // Ana has begun reworking the table when she goes.
    const moved = apply(playing(), 0, {
      type: 'move',
      move: { kind: 'to-new-set', tileId: 'red-1-a' },
    });
    if (!moved.ok) throw new Error('move refused');
    const table = moved.value.table;
    const stall = stallAt(table, null, ANA_AWAY, 0);

    const bo = vote(table, stall, ANA_AWAY, MIN, 1);
    expect(bo.drew).toBeNull();
    expect(bo.stall?.yes).toEqual([1]);
    // Saying yes twice counts once; no takes it back.
    expect(vote(table, bo.stall, ANA_AWAY, MIN, 1).stall?.yes).toEqual([1]);
    const withdrawn = voteAway(table, bo.stall, ANA_AWAY, MIN, 1, false);
    expect(withdrawn.ok && withdrawn.value.stall?.yes).toEqual([]);

    const cy = vote(table, bo.stall, ANA_AWAY, MIN, 2);
    expect(cy.drew).toEqual({ seat: 0, drewAt: LAST });
    if (cy.table.phase !== 'playing' || table.phase !== 'playing') throw new Error('not playing');
    // The working turn is taken back, never judged; Ana has the last tile of the pool.
    expect(cy.table.working).toBeNull();
    expect(cy.table.game.table).toEqual(table.game.table);
    expect(cy.table.game.current).toBe(1);
    expect(cy.table.game.players[0]?.rack).toHaveLength(5);
    expect(cy.stall).toBeNull();
  });

  it('carries the vote when the last one who had not agreed goes away too', () => {
    const table = playing();
    const stall = stallAt(table, null, ANA_AWAY, 0);
    const bo = vote(table, stall, ANA_AWAY, MIN, 1);
    const settled = settleAway(table, bo.stall, [false, true, false], MIN + 1);
    expect(settled.drew).toEqual({ seat: 0, drewAt: LAST });
  });

  it('starts the next seat’s own minute when the turn passes to another seat that is away', () => {
    const table = playing();
    const here = [false, false, true];
    const stall = stallAt(table, null, here, 0);
    const cy = vote(table, stall, here, MIN, 2);
    expect(cy.drew).toEqual({ seat: 0, drewAt: LAST });
    expect(cy.stall).toEqual({ seat: 1, since: MIN, yes: [] });
  });

  it('draws nothing from an empty pool, and passes the turn', () => {
    const table = playing();
    const empty: Table = { ...table, game: { ...table.game, pool: [] } };
    const stall = stallAt(empty, null, ANA_AWAY, 0);
    const voted = vote(empty, vote(empty, stall, ANA_AWAY, MIN, 1).stall, ANA_AWAY, MIN, 2);
    expect(voted.drew).toEqual({ seat: 0, drewAt: null });
  });
});

describe('a bot’s seat', () => {
  it('is never held up as away, though no device holds it', () => {
    const table = { ...playing(), bots: [{ seat: 0, level: 'medium' as const }] };
    expect(settleAway(table, null, ANA_AWAY, 0).stall).toBeNull();
    expect(settleAway(table, null, ANA_AWAY, 10 * MIN)).toEqual({ table, stall: null, drew: null });
  });
});
