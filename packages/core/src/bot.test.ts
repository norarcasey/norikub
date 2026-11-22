import { describe, expect, it } from 'vitest';

import { bestSets, takeBotTurn } from './bot.ts';
import type { Bot, Proposal } from './bot.ts';
import { layout, ts } from './fixtures.test-helpers.ts';
import { finish, gameSchema, newGame, seatView } from './game.ts';
import type { Game, SeatView } from './game.ts';
import { parse } from './parse.ts';
import { judgeSet } from './sets.ts';

function turnOf(game: Game): ReturnType<typeof takeBotTurn> {
  const result = takeBotTurn(game);
  expect(result.accepted).toBe(true);
  return result;
}

function ids(sets: readonly (readonly { id: string }[])[]): string[][] {
  return sets.map((set) => set.map((tile) => tile.id).sort());
}

describe('the first meld', () => {
  it('lays down sets from the rack worth 30 or more', () => {
    const game = layout([
      { rack: ['red-10-a', 'red-11-a', 'red-12-a', 'blue-2-a', 'black-5-a'] },
      { rack: [] },
    ]);
    const { game: next, proposal } = turnOf(game);
    expect(proposal.kind).toBe('play');
    expect(ids(next.table)).toEqual([['red-10-a', 'red-11-a', 'red-12-a']]);
    expect(next.players[0]?.hasMelded).toBe(true);
  });

  it('draws rather than meld under 30', () => {
    const game = layout([{ rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'] }, { rack: [] }]);
    const { game: next, proposal } = turnOf(game);
    expect(proposal).toEqual({ kind: 'draw' });
    expect(next.players[0]?.rack).toHaveLength(5);
    expect(next.table).toEqual([]);
  });

  it('never touches the table before it has melded', () => {
    const game = layout(
      [{ rack: ['red-10-a', 'red-11-a', 'red-12-a', 'blue-7-a'] }, { rack: [], hasMelded: true }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    const { game: next } = turnOf(game);
    expect(ids(next.table)).toEqual([
      ['blue-4-a', 'blue-5-a', 'blue-6-a'],
      ['red-10-a', 'red-11-a', 'red-12-a'],
    ]);
    expect(next.players[0]?.rack).toEqual(ts('blue-7-a'));
  });

  it('uses a joker to reach 30', () => {
    const game = layout([{ rack: ['red-9-a', 'joker-a', 'red-11-a', 'blue-1-a'] }, { rack: [] }]);
    expect(turnOf(game).game.players[0]?.hasMelded).toBe(true);
  });
});

describe('after the first meld', () => {
  it('adds rack tiles to sets on the table', () => {
    const game = layout(
      [{ rack: ['blue-7-a', 'blue-8-a', 'orange-4-a', 'red-1-a'], hasMelded: true }, { rack: [] }],
      [
        ['blue-4-a', 'blue-5-a', 'blue-6-a'],
        ['red-4-a', 'black-4-a', 'blue-4-b'],
      ],
    );
    const { game: next } = turnOf(game);
    expect(ids(next.table)).toEqual([
      ['blue-4-a', 'blue-5-a', 'blue-6-a', 'blue-7-a', 'blue-8-a'],
      ['black-4-a', 'blue-4-b', 'orange-4-a', 'red-4-a'],
    ]);
    expect(next.players[0]?.rack).toEqual(ts('red-1-a'));
  });

  it('lays new sets of any value, since 30 no longer applies', () => {
    const game = layout([
      { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'orange-9-a'], hasMelded: true },
      { rack: [] },
    ]);
    expect(ids(turnOf(game).game.table)).toEqual([['red-1-a', 'red-2-a', 'red-3-a']]);
  });

  it('borrows a spare tile from a long set to finish a set of its own', () => {
    const game = layout(
      [{ rack: ['red-8-a', 'black-8-a', 'orange-1-a'], hasMelded: true }, { rack: [] }],
      [['blue-5-a', 'blue-6-a', 'blue-7-a', 'blue-8-a']],
    );
    const { game: next } = turnOf(game);
    expect(ids(next.table)).toEqual([
      ['blue-5-a', 'blue-6-a', 'blue-7-a'],
      ['black-8-a', 'blue-8-a', 'red-8-a'],
    ]);
  });

  it('borrows from a group of four', () => {
    const game = layout(
      [{ rack: ['red-8-a', 'red-9-a', 'blue-1-a'], hasMelded: true }, { rack: [] }],
      [['red-10-a', 'blue-10-a', 'black-10-a', 'orange-10-a']],
    );
    expect(ids(turnOf(game).game.table)).toEqual([
      ['black-10-a', 'blue-10-a', 'orange-10-a'],
      ['red-10-a', 'red-8-a', 'red-9-a'],
    ]);
  });

  it('draws when nothing fits anywhere', () => {
    const game = layout(
      [{ rack: ['red-1-a', 'blue-9-a'], hasMelded: true }, { rack: [] }],
      [['black-4-a', 'black-5-a', 'black-6-a']],
    );
    expect(turnOf(game).proposal).toEqual({ kind: 'draw' });
  });

  it('empties its rack and wins when everything fits', () => {
    const game = layout(
      [
        { rack: ['blue-7-a', 'red-1-a', 'red-2-a', 'red-3-a'], hasMelded: true },
        { rack: ['joker-a'] },
      ],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    expect(turnOf(game).game.status).toMatchObject({ kind: 'over', winner: 0 });
  });
});

describe('the best sets from a rack', () => {
  it('splits a run to make a group when that lays down more', () => {
    // 10-11-12-13 alone is 46 points and four tiles; 10-11-12 and three 13s are 72 and six.
    const rack = ts('red-10-a', 'red-11-a', 'red-12-a', 'red-13-a', 'blue-13-a', 'black-13-a');
    for (const by of ['points', 'tiles'] as const) {
      const sets = bestSets(rack, by);
      expect(sets.reduce((sum, set) => sum + pointsOfSet(set), 0)).toBe(72);
      expect(sets.flat()).toHaveLength(6);
    }
  });

  it('counts points, not tiles, for a first meld', () => {
    // One joker, two uses: three 13s (39 points, three tiles) or 1-2-joker-4-5 (15 points,
    // five tiles).
    const rack = ts('red-1-a', 'red-2-a', 'red-4-a', 'red-5-a', 'joker-a', 'red-13-a', 'blue-13-a');
    expect(ids(bestSets(rack, 'points'))).toEqual([['blue-13-a', 'joker-a', 'red-13-a']]);
    expect(ids(bestSets(rack, 'tiles'))).toEqual([
      ['joker-a', 'red-1-a', 'red-2-a', 'red-4-a', 'red-5-a'],
    ]);
  });

  it('keeps two copies of one tile apart', () => {
    const rack = ts('red-5-a', 'red-5-b', 'red-6-a', 'red-6-b', 'red-7-a', 'red-7-b');
    expect(ids(bestSets(rack, 'tiles'))).toEqual([
      ['red-5-a', 'red-6-a', 'red-7-a'],
      ['red-5-b', 'red-6-b', 'red-7-b'],
    ]);
  });

  it('finds nothing in a rack of strays', () => {
    expect(bestSets(ts('red-1-a', 'blue-5-a', 'black-9-a'), 'tiles')).toEqual([]);
  });
});

describe('what a bot is handed', () => {
  it('is its seat view and nothing more', () => {
    const game = newGame({ names: ['Nora', 'Bot A', 'Bot B'], seed: 3 });
    const seen: SeatView[] = [];
    const spy: Bot = (view) => {
      seen.push(view);
      return { kind: 'draw' };
    };
    takeBotTurn(game, spy);
    expect(seen).toEqual([seatView(game, 0)]);
    const hidden = [
      ...(game.players[1]?.rack ?? []),
      ...(game.players[2]?.rack ?? []),
      ...game.pool,
    ];
    const text = JSON.stringify(seen);
    for (const tile of hidden) expect(text).not.toContain(`"${tile.id}"`);
  });

  it('costs a refused proposal a turn: it is taken back and the seat draws', () => {
    const game = layout([{ rack: ['red-1-a', 'red-2-a'] }, { rack: [] }]);
    const cheat: Bot = () => ({ kind: 'play', moves: [{ kind: 'to-new-set', tileId: 'red-1-a' }] });
    const result = takeBotTurn(game, cheat);
    expect(result.accepted).toBe(false);
    expect(result.game.table).toEqual([]);
    expect(result.game.players[0]?.rack).toHaveLength(3);
    const ghost: Bot = () => ({
      kind: 'play',
      moves: [{ kind: 'to-new-set', tileId: 'blue-9-b' }],
    });
    expect(takeBotTurn(game, ghost).accepted).toBe(false);
  });

  it('changes nothing once the game is over', () => {
    const over = finish(layout([{ rack: [] }, { rack: ['red-1-a'] }]), 0, 'rack-emptied');
    expect(takeBotTurn(over).game).toBe(over);
  });
});

describe('bots playing whole games', () => {
  // 150 seeded three-bot games: 1.6 s on 21 Nov 2026, of which 123 ended on an emptied rack
  // and 27 on an exhausted pool, averaging 94 turns a game.
  const seeds = Array.from({ length: 150 }, (_, i) => i + 1);

  it('only ever propose turns the engine accepts, or draw, and every game ends', () => {
    let won = 0;
    let borrowedOrAdded = 0;
    for (const seed of seeds) {
      let game = newGame({ names: ['A', 'B', 'C'], seed });
      let turns = 0;
      while (game.status.kind === 'playing') {
        const before = game.table.flat().length;
        const result = takeBotTurn(game);
        if (!result.accepted) throw new Error(`seed ${seed}, turn ${turns}: proposal refused`);
        if (result.proposal.kind === 'play' && game.players[game.current]?.hasMelded === true) {
          const placed = result.game.table.flat().length - before;
          if (placed > 0 && proposalTouchesTable(result.proposal, game)) borrowedOrAdded++;
        }
        game = result.game;
        turns++;
        if (turns > 1000) throw new Error(`seed ${seed} did not end`);
      }
      if (game.status.reason === 'rack-emptied') won++;
      expect(parse(gameSchema, game).ok).toBe(true);
    }
    // Not a skill target, a sign of life: bots that never melded or never built on the
    // table would end every game on an empty pool.
    expect(won).toBeGreaterThan(seeds.length / 4);
    expect(borrowedOrAdded).toBeGreaterThan(0);
  });
});

function pointsOfSet(set: Parameters<typeof judgeSet>[0]): number {
  const verdict = judgeSet(set);
  return verdict.valid ? verdict.points : 0;
}

function proposalTouchesTable(proposal: Proposal, game: Game): boolean {
  if (proposal.kind !== 'play') return false;
  return proposal.moves.some((m) => m.kind === 'to-set' && m.set < game.table.length);
}
