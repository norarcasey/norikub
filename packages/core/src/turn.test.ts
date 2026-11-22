import { describe, expect, it } from 'vitest';

import { layout, ts } from './fixtures.test-helpers.ts';
import { finish, gameSchema } from './game.ts';
import type { Game } from './game.ts';
import { parse } from './parse.ts';
import { endTurn, move, startTurn, takeBack } from './turn.ts';
import type { Move, Turn } from './turn.ts';

/** Plays moves that must all be accepted; a refusal fails the test where it happened. */
function play(turn: Turn, ...moves: Move[]): Turn {
  return moves.reduce((current, m) => {
    const result = move(current, m);
    if (!result.ok) throw new Error(`${m.kind} ${m.tileId}: ${result.refusal.kind}`);
    return result.turn;
  }, turn);
}

function ended(turn: Turn): Game {
  const result = endTurn(turn);
  if (!result.ok) throw new Error(JSON.stringify(result.faults));
  return result.game;
}

const toNew = (tileId: string): Move => ({ kind: 'to-new-set', tileId });
const toSet = (tileId: string, set: number): Move => ({ kind: 'to-set', tileId, set });
const toRack = (tileId: string): Move => ({ kind: 'to-rack', tileId });

describe('the first meld', () => {
  it('counts at 30 or more from the rack', () => {
    const game = layout([{ rack: ['red-10-a', 'red-11-a', 'red-12-a', 'blue-1-a'] }, { rack: [] }]);
    const turn = play(
      startTurn(game),
      toNew('red-10-a'),
      toSet('red-11-a', 0),
      toSet('red-12-a', 0),
    );
    const next = ended(turn);
    expect(next.players[0]).toMatchObject({ hasMelded: true, rack: ts('blue-1-a') });
    expect(next.table).toEqual([ts('red-10-a', 'red-11-a', 'red-12-a')]);
    expect(next.current).toBe(1);
    expect(parse(gameSchema, next).ok).toBe(true);
  });

  it('may reach 30 across more than one set', () => {
    const game = layout([
      { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'red-8-a', 'blue-8-a', 'black-8-a', 'joker-a'] },
      { rack: [] },
    ]);
    const turn = play(
      startTurn(game),
      toNew('red-1-a'),
      toSet('red-2-a', 0),
      toSet('red-3-a', 0),
      toNew('red-8-a'),
      toSet('blue-8-a', 1),
      toSet('black-8-a', 1),
    );
    expect(ended(turn).players[0]?.hasMelded).toBe(true);
  });

  it('is refused under 30, saying how many it made', () => {
    const game = layout([{ rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'] }, { rack: [] }]);
    const turn = play(startTurn(game), toNew('red-1-a'), toSet('red-2-a', 0), toSet('red-3-a', 0));
    expect(endTurn(turn)).toEqual({
      ok: false,
      faults: [{ kind: 'first-meld-under-30', points: 6 }],
    });
  });

  it('counts a joker as the tile it stands for', () => {
    const game = layout([{ rack: ['red-9-a', 'joker-a', 'red-11-a', 'blue-1-a'] }, { rack: [] }]);
    const turn = play(startTurn(game), toNew('red-9-a'), toSet('joker-a', 0), toSet('red-11-a', 0));
    expect(ended(turn).players[0]?.hasMelded).toBe(true);
  });

  it('may not add to a set already on the table', () => {
    const game = layout(
      [{ rack: ['blue-7-a', 'red-10-a', 'red-11-a', 'red-12-a'] }, { rack: [], hasMelded: true }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    const turn = play(
      startTurn(game),
      toSet('blue-7-a', 0),
      toNew('red-10-a'),
      toSet('red-11-a', 1),
      toSet('red-12-a', 1),
    );
    expect(endTurn(turn)).toEqual({
      ok: false,
      faults: [{ kind: 'table-touched-before-first-meld' }],
    });
  });

  it('may not take a tile from the table to make up its 30', () => {
    const game = layout(
      [{ rack: ['red-10-a', 'red-11-a'] }, { rack: [], hasMelded: true }],
      [['red-12-a', 'blue-12-a', 'black-12-a', 'orange-12-a']],
    );
    const turn = play(
      startTurn(game),
      toNew('red-10-a'),
      toSet('red-11-a', 1),
      toSet('red-12-a', 1),
    );
    expect(endTurn(turn)).toMatchObject({
      ok: false,
      faults: [{ kind: 'table-touched-before-first-meld' }],
    });
  });

  it('does not mind a table tile moved and put back where it was', () => {
    const game = layout(
      [{ rack: ['red-10-a', 'red-11-a', 'red-12-a', 'blue-1-a'] }, { rack: [] }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    const turn = play(
      startTurn(game),
      toNew('blue-6-a'),
      toSet('blue-6-a', 0),
      toNew('red-10-a'),
      toSet('red-11-a', 1),
      toSet('red-12-a', 1),
    );
    expect(endTurn(turn).ok).toBe(true);
  });

  it('frees the player to rework the table on later turns', () => {
    const game = layout(
      [{ rack: ['blue-7-a', 'red-1-a'], hasMelded: true }, { rack: [] }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a']],
    );
    expect(ended(play(startTurn(game), toSet('blue-7-a', 0))).table).toEqual([
      ts('blue-4-a', 'blue-5-a', 'blue-6-a', 'blue-7-a'),
    ]);
  });
});

describe('the end of a turn', () => {
  const melded = (rack: string[], table: string[][] = []): Game =>
    layout([{ rack, hasMelded: true }, { rack: ['orange-1-b'] }], table);

  it('is refused when nothing was played from the rack: the player draws instead', () => {
    const game = melded(['red-1-a']);
    expect(endTurn(startTurn(game))).toEqual({ ok: false, faults: [{ kind: 'nothing-played' }] });
  });

  it('is refused when the table was only rearranged', () => {
    const game = melded(
      ['red-1-a'],
      [['blue-4-a', 'blue-5-a', 'blue-6-a', 'blue-7-a', 'blue-8-a', 'blue-9-a']],
    );
    const turn = play(
      startTurn(game),
      toNew('blue-7-a'),
      toSet('blue-8-a', 1),
      toSet('blue-9-a', 1),
    );
    expect(endTurn(turn)).toEqual({ ok: false, faults: [{ kind: 'nothing-played' }] });
  });

  it('names every set that is not valid', () => {
    const game = melded(['red-1-a', 'red-2-a', 'blue-9-a'], [['blue-4-a', 'blue-5-a', 'blue-6-a']]);
    const turn = play(startTurn(game), toNew('red-1-a'), toSet('red-2-a', 1), toSet('blue-9-a', 0));
    expect(endTurn(turn)).toEqual({
      ok: false,
      faults: [
        { kind: 'invalid-set', set: 0 },
        { kind: 'invalid-set', set: 1 },
      ],
    });
  });

  it('ends the game when the rack is emptied, and scores it', () => {
    const game = melded(['blue-7-a'], [['blue-4-a', 'blue-5-a', 'blue-6-a']]);
    const next = ended(play(startTurn(game), toSet('blue-7-a', 0)));
    expect(next.status).toEqual({
      kind: 'over',
      reason: 'rack-emptied',
      winner: 0,
      scores: [1, -1],
    });
    expect(next.current).toBe(0);
  });

  it('is refused once the game is over', () => {
    const over = finish(melded(['blue-7-a']), 1, 'pool-exhausted');
    expect(endTurn(startTurn(over))).toEqual({ ok: false, faults: [{ kind: 'game-over' }] });
  });

  it('starts the count of empty-pool passes again', () => {
    const game: Game = { ...melded(['red-1-a', 'red-2-a', 'red-3-a', 'blue-1-a']), passes: 1 };
    const turn = play(startTurn(game), toNew('red-1-a'), toSet('red-2-a', 0), toSet('red-3-a', 0));
    expect(ended(turn).passes).toBe(0);
  });
});

describe('rearranging during a turn', () => {
  it('lets sets be broken on the way and judges only the end', () => {
    const game = layout(
      [{ rack: ['red-7-a', 'blue-1-a'], hasMelded: true }, { rack: [] }],
      [['red-4-a', 'red-5-a', 'red-6-a', 'red-8-a', 'red-9-a', 'red-10-a']],
    );
    // An invalid six-tile set: 4-5-6 and 8-9-10 with no 7. Split the 8-9-10 off, then mend.
    expect(endTurn(startTurn(game)).ok).toBe(false);
    const broken = play(startTurn(game), toNew('red-8-a'), toSet('red-9-a', 1));
    expect(broken.table).toEqual([
      ts('red-4-a', 'red-5-a', 'red-6-a', 'red-10-a'),
      ts('red-8-a', 'red-9-a'),
    ]);
    const mended = play(broken, toSet('red-10-a', 1), toSet('red-7-a', 0));
    expect(ended(mended).table).toEqual([
      ts('red-4-a', 'red-5-a', 'red-6-a', 'red-7-a'),
      ts('red-8-a', 'red-9-a', 'red-10-a'),
    ]);
  });

  it('starts a group of two 13s while the board is reworked to free the third', () => {
    const game = layout(
      [{ rack: ['red-13-a', 'blue-13-a', 'black-2-a'], hasMelded: true }, { rack: [] }],
      [['orange-10-a', 'orange-11-a', 'orange-12-a', 'orange-13-a']],
    );
    const twoThirteens = play(startTurn(game), toNew('red-13-a'), toSet('blue-13-a', 1));
    expect(twoThirteens.table[1]).toEqual(ts('red-13-a', 'blue-13-a'));
    expect(endTurn(twoThirteens)).toEqual({ ok: false, faults: [{ kind: 'invalid-set', set: 1 }] });

    const freed = play(twoThirteens, toSet('orange-13-a', 1));
    const next = ended(freed);
    expect(next.table).toEqual([
      ts('orange-10-a', 'orange-11-a', 'orange-12-a'),
      ts('red-13-a', 'blue-13-a', 'orange-13-a'),
    ]);
    expect(next.players[0]?.rack).toEqual(ts('black-2-a'));
  });

  it('drops a set emptied by a move, after the tile has landed', () => {
    const game = layout(
      [{ rack: ['blue-1-a'], hasMelded: true }, { rack: [] }],
      [['red-1-a'], ['red-2-a', 'red-3-a']],
    );
    const turn = play(startTurn(game), toSet('red-1-a', 1));
    expect(turn.table).toEqual([ts('red-2-a', 'red-3-a', 'red-1-a')]);
  });

  it('lets a tile played from the rack go back to it this turn', () => {
    const game = layout([{ rack: ['red-1-a', 'red-2-a'] }, { rack: [] }]);
    const turn = play(startTurn(game), toNew('red-1-a'), toRack('red-1-a'), toRack('red-2-a'));
    expect(turn.table).toEqual([]);
    // A rack tile sent to the rack goes to its end: that is how a player reorders the rack.
    expect(turn.rack).toEqual(ts('red-1-a', 'red-2-a'));
  });

  it('refuses at once a tile that began the turn on the table going into a rack', () => {
    const game = layout(
      [{ rack: ['red-1-a'], hasMelded: true }, { rack: [] }],
      [['blue-4-a', 'blue-5-a', 'blue-6-a', 'blue-7-a']],
    );
    const turn = play(startTurn(game), toNew('blue-7-a'));
    expect(move(turn, toRack('blue-7-a'))).toEqual({
      ok: false,
      refusal: { kind: 'table-tile-to-rack', tileId: 'blue-7-a' },
    });
  });

  it('takes a joker back by replacing it, and plays it again the same turn', () => {
    const game = layout(
      [{ rack: ['red-5-a', 'blue-8-a', 'black-8-a', 'orange-1-a'], hasMelded: true }, { rack: [] }],
      [['red-4-a', 'joker-a', 'red-6-a']],
    );
    const replaced = play(startTurn(game), toSet('red-5-a', 0), toNew('joker-a'));
    expect(move(replaced, toRack('joker-a'))).toEqual({
      ok: false,
      refusal: { kind: 'table-joker-to-rack', tileId: 'joker-a' },
    });
    // Left on its own it is a set of one, and the turn cannot end.
    expect(endTurn(replaced)).toMatchObject({
      ok: false,
      faults: [{ kind: 'invalid-set', set: 1 }],
    });
    const next = ended(play(replaced, toSet('blue-8-a', 1), toSet('black-8-a', 1)));
    expect(next.table).toEqual([
      ts('red-4-a', 'red-6-a', 'red-5-a'),
      ts('joker-a', 'blue-8-a', 'black-8-a'),
    ]);
  });

  it('refuses a tile or a set that is not there', () => {
    const game = layout([{ rack: ['red-1-a'] }, { rack: [] }]);
    const turn = startTurn(game);
    expect(move(turn, toNew('red-2-a'))).toEqual({
      ok: false,
      refusal: { kind: 'no-such-tile', tileId: 'red-2-a' },
    });
    expect(move(turn, toSet('red-1-a', 0))).toEqual({
      ok: false,
      refusal: { kind: 'no-such-set', set: 0 },
    });
  });
});

describe('taking the turn back', () => {
  it('restores the table and the rack exactly, order included', () => {
    const game = layout(
      [{ rack: ['red-13-a', 'blue-13-a', 'black-2-a'], hasMelded: true }, { rack: [] }],
      [
        ['orange-10-a', 'orange-11-a', 'orange-12-a', 'orange-13-a'],
        ['red-1-a', 'red-2-a', 'red-3-a'],
      ],
    );
    const start = startTurn(game);
    const messy = play(
      start,
      toNew('red-13-a'),
      toSet('orange-13-a', 2),
      toSet('red-2-a', 0),
      toNew('blue-13-a'),
      toRack('red-13-a'),
    );
    expect(messy.table).not.toEqual(game.table);
    const back = takeBack(messy);
    expect(back).toEqual(start);
    expect(back.table).toEqual(game.table);
    expect(back.rack).toEqual(game.players[0]?.rack);
  });
});
