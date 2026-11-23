import { describe, expect, it } from 'vitest';

import { LEVELS, bestSets, botFor, movesToward, takeBotTurn } from './bot.ts';
import type { Bot, Level, Proposal } from './bot.ts';
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

describe('the hard bot', () => {
  const hard = botFor('hard');

  function hardTurn(game: Game): ReturnType<typeof takeBotTurn> {
    const result = takeBotTurn(game, hard);
    expect(result.accepted).toBe(true);
    return result;
  }

  it('splits a run to fit a tile, which the medium bot cannot', () => {
    const game = layout(
      [{ rack: ['red-5-b', 'blue-1-a'], hasMelded: true }, { rack: [] }],
      [['red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a']],
    );
    expect(takeBotTurn(game).proposal).toEqual({ kind: 'draw' });
    const { game: next } = hardTurn(game);
    expect(next.players[0]?.rack).toEqual(ts('blue-1-a'));
    expect(next.table.flat()).toHaveLength(6);
  });

  it('takes a joker back by replacing it and plays it again in the same turn', () => {
    const game = layout(
      [{ rack: ['red-5-a', 'blue-9-a', 'black-9-a', 'orange-2-a'], hasMelded: true }, { rack: [] }],
      [['red-4-a', 'joker-a', 'red-6-a']],
    );
    const { game: next } = hardTurn(game);
    expect(ids(next.table).sort()).toEqual([
      ['black-9-a', 'blue-9-a', 'joker-a'],
      ['red-4-a', 'red-5-a', 'red-6-a'],
    ]);
    expect(next.players[0]?.rack).toEqual(ts('orange-2-a'));
  });

  it('reworks the whole table to empty its rack', () => {
    // Two groups become three runs: no tile of the rack fits any set as it stands.
    const game = layout(
      [{ rack: ['red-6-a', 'blue-6-a', 'black-6-a'], hasMelded: true }, { rack: ['red-1-a'] }],
      [
        ['red-4-a', 'blue-4-a', 'black-4-a'],
        ['red-5-a', 'blue-5-a', 'black-5-a'],
      ],
    );
    expect(hardTurn(game).game.status).toMatchObject({ kind: 'over', winner: 0 });
  });

  it('melds from its rack alone, with as many tiles as reach 30', () => {
    const game = layout(
      [
        {
          rack: ['red-10-a', 'red-11-a', 'red-12-a', 'blue-1-a', 'blue-2-a', 'blue-3-a', 'red-9-a'],
        },
        { rack: [], hasMelded: true },
      ],
      [['red-13-a', 'blue-13-a', 'black-13-a']],
    );
    const { game: next } = hardTurn(game);
    expect(ids(next.table)).toEqual([
      ['black-13-a', 'blue-13-a', 'red-13-a'],
      ['blue-1-a', 'blue-2-a', 'blue-3-a'],
      ['red-10-a', 'red-11-a', 'red-12-a', 'red-9-a'],
    ]);
  });

  it('draws rather than meld under 30', () => {
    const game = layout([{ rack: ['red-1-a', 'red-2-a', 'red-3-a'] }, { rack: [] }]);
    expect(hardTurn(game).proposal).toEqual({ kind: 'draw' });
  });

  it('draws when nothing of its rack can go anywhere', () => {
    const game = layout(
      [{ rack: ['red-1-a', 'blue-9-a'], hasMelded: true }, { rack: [] }],
      [['black-4-a', 'black-5-a', 'black-6-a']],
    );
    expect(hardTurn(game).proposal).toEqual({ kind: 'draw' });
  });
});

describe('the easy bot', () => {
  it('lays its own sets but never adds to the table', () => {
    const game = layout(
      [{ rack: ['blue-7-a', 'red-1-a', 'red-2-a', 'red-3-a'], hasMelded: true }, { rack: [] }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    const result = takeBotTurn(game, botFor('easy'));
    expect(result.accepted).toBe(true);
    expect(ids(result.game.table)).toEqual([
      ['blue-4-a', 'blue-5-a', 'blue-6-a'],
      ['red-1-a', 'red-2-a', 'red-3-a'],
    ]);
    expect(result.game.players[0]?.rack).toEqual(ts('blue-7-a'));
  });

  it('draws with nothing of its own to lay', () => {
    const game = layout(
      [{ rack: ['blue-7-a'], hasMelded: true }, { rack: [] }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    expect(takeBotTurn(game, botFor('easy')).proposal).toEqual({ kind: 'draw' });
  });

  it('melds only at 30', () => {
    const game = layout([{ rack: ['red-1-a', 'red-2-a', 'red-3-a'] }, { rack: [] }]);
    expect(takeBotTurn(game, botFor('easy')).proposal).toEqual({ kind: 'draw' });
  });
});

describe('the moves toward a table', () => {
  it('keeps a set whole where it stays, and moves only what it lacks', () => {
    const start = [ts('red-4-a', 'red-5-a', 'red-6-a')];
    const moves = movesToward(start, [ts('red-4-a', 'red-5-a', 'red-6-a', 'red-7-a')]);
    expect(moves).toEqual([{ kind: 'to-set', tileId: 'red-7-a', set: 0 }]);
  });

  it('follows a set as an emptied one before it drops out', () => {
    // The group of 9s empties into the new run, and the run that was second becomes first.
    const start = [
      ts('red-9-a', 'blue-9-a', 'black-9-a'),
      ts('orange-1-a', 'orange-2-a', 'orange-3-a'),
    ];
    const target = [
      ts('orange-1-a', 'orange-2-a', 'orange-3-a', 'orange-4-a'),
      ts('red-9-a', 'red-10-a', 'red-11-a'),
      ts('blue-9-a', 'blue-10-a', 'blue-11-a'),
      ts('black-9-a', 'black-10-a', 'black-11-a'),
    ];
    const moves = movesToward(start, target);
    expect(moves).toContainEqual({ kind: 'to-set', tileId: 'orange-4-a', set: 1 });
    expect(moves.filter((m) => m.kind === 'to-new-set')).toHaveLength(2);
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
  // 150 seeded three-bot games, of which 123 end on an emptied rack and 27 on an exhausted
  // pool, averaging 94 turns a game. Measured 21 Nov 2026: 1.6 s on this laptop and 8 s on
  // CI's runner with coverage on, which is past vitest's default 5 s and turned main red
  // (run 44996233841). Hence the explicit timeout below rather than fewer games.
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
  }, 60_000);
});

describe('every level playing whole games', () => {
  // 20 seeded games of each lineup below; measured 22 Nov 2026 on this laptop, the slowest
  // hard turn took 57 ms and the mean 1.9 ms over 180 such games, and hard won 169 of them.
  const lineups: readonly (readonly Level[])[] = [
    ['easy', 'medium', 'hard'],
    ['hard', 'hard', 'easy'],
  ];
  it('only ever propose turns the engine accepts, and hard wins most', () => {
    const wins = new Map<Level, number>(LEVELS.map((level) => [level, 0]));
    for (const levels of lineups) {
      for (let seed = 1; seed <= 20; seed++) {
        let game = newGame({ names: [...levels], seed });
        let turns = 0;
        while (game.status.kind === 'playing') {
          const level = levels[game.current] ?? 'medium';
          const result = takeBotTurn(game, botFor(level));
          if (!result.accepted) throw new Error(`${level}, seed ${seed}, turn ${turns}: refused`);
          game = result.game;
          turns++;
          if (turns > 1000) throw new Error(`seed ${seed} did not end`);
        }
        const winner = levels[game.status.winner];
        if (winner !== undefined) wins.set(winner, (wins.get(winner) ?? 0) + 1);
        expect(parse(gameSchema, game).ok).toBe(true);
      }
    }
    expect(wins.get('hard')).toBeGreaterThan(30);
  }, 60_000);
});

function pointsOfSet(set: Parameters<typeof judgeSet>[0]): number {
  const verdict = judgeSet(set);
  return verdict.valid ? verdict.points : 0;
}

function proposalTouchesTable(proposal: Proposal, game: Game): boolean {
  if (proposal.kind !== 'play') return false;
  return proposal.moves.some((m) => m.kind === 'to-set' && m.set < game.table.length);
}
