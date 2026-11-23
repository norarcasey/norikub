import { describe, expect, it } from 'vitest';

import { awayOffer, settleAway, voteAway } from '../../../../packages/core/src/away.ts';
import type { Stall } from '../../../../packages/core/src/away.ts';
import { layout, ts } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import type { TableClientMessage, TableMessage } from '../../../../packages/core/src/protocol.ts';
import {
  addBot,
  apply,
  botTurn,
  cancel,
  deal,
  newTable,
  removeBot,
  sitDown,
  tableViewFor,
} from '../../../../packages/core/src/table.ts';
import type { Table } from '../../../../packages/core/src/table.ts';
import { noteText } from '../table/messages.ts';
import {
  awayQuestion,
  friendsBoard,
  isAway,
  newFriends,
  placeTile,
  received,
  sendAddBot,
  sendAwayVote,
  sendCancel,
  sendDeal,
  sendRemoveBot,
  sendTiles,
  sendTurn,
  shownView,
  takeBackTurn,
} from './friends.ts';
import type { Friends, Sent } from './friends.ts';

/**
 * A host in memory, running the core exactly as `apps/game/src/host.ts` does: a message from
 * a seat is `deal` or `apply`, and every seat is then sent its own `tableViewFor`. What a page
 * hears is queued, so a test can hold the host's answers back and see the page ahead of them.
 */
class Host {
  readonly inbox: TableMessage[][];
  /** Who is here and the time, as the real host takes them from its sockets and its clock. */
  here: boolean[];
  now = 0;
  stall: Stall | null = null;
  constructor(
    public table: Table,
    seats: number,
  ) {
    this.inbox = Array.from({ length: seats }, () => []);
    this.here = Array.from({ length: seats }, () => true);
  }

  /** The host's `settle`: the core settles the stall, then every seat hears presence and the offer. */
  settle(): void {
    const settled = settleAway(this.table, this.stall, this.here, this.now);
    this.stall = settled.stall;
    if (settled.drew !== null) {
      this.tellDraw(settled.table, settled.drew);
      this.playBots();
    }
    const offer = voteAwayOffer(this);
    for (const box of this.inbox) {
      box.push({ type: 'presence', here: [...this.here] });
      box.push({ type: 'away-turn', offer });
    }
  }

  tellDraw(table: Table, drew: { seat: number; drewAt: number | null }): void {
    this.table = table;
    for (const box of this.inbox) box.push({ type: 'drew', ...drew });
    this.broadcast();
  }

  hear(seat: number, message: TableClientMessage): void {
    if (message.type === 'draw-for-away') {
      const voted = voteAway(this.table, this.stall, this.here, this.now, seat, message.yes);
      if (!voted.ok)
        return void this.inbox[seat]?.push({ type: 'refused', refusal: voted.refusal });
      this.stall = voted.value.stall;
      if (voted.value.drew === null) {
        this.inbox[seat]?.push({ type: 'view', table: tableViewFor(this.table, seat) });
      } else this.tellDraw(voted.value.table, voted.value.drew);
      return this.settle();
    }
    if (message.type === 'deal') {
      const dealt = deal(this.table, seat, 7);
      if (!dealt.ok)
        return void this.inbox[seat]?.push({ type: 'refused', refusal: dealt.refusal });
      this.table = dealt.value;
      this.broadcast();
      return this.playBots();
    }
    if (message.type === 'add-bot') {
      const added = addBot(this.table, seat, message.level, message.name);
      if (!added.ok)
        return void this.inbox[seat]?.push({ type: 'refused', refusal: added.refusal });
      this.table = added.value;
      return this.broadcast();
    }
    if (message.type === 'remove-bot') {
      const removed = removeBot(this.table, seat, message.seat);
      if (!removed.ok)
        return void this.inbox[seat]?.push({ type: 'refused', refusal: removed.refusal });
      this.table = removed.value;
      // As the host moves each socket after the bot up a seat.
      this.inbox.splice(message.seat, 1);
      this.here.splice(message.seat, 1);
      return this.broadcast();
    }
    if (message.type === 'cancel') {
      const cancelled = cancel(this.table, seat);
      if (!cancelled.ok)
        return void this.inbox[seat]?.push({ type: 'refused', refusal: cancelled.refusal });
      this.table = cancelled.value;
      return this.broadcast();
    }
    const applied = apply(this.table, seat, message);
    if (!applied.ok) {
      return void this.inbox[seat]?.push({ type: 'refused', refusal: applied.refusal });
    }
    this.table = applied.value.table;
    const drew = applied.value.drew;
    if (drew !== null) for (const box of this.inbox) box.push({ type: 'drew', ...drew });
    this.broadcast();
    this.playBots();
  }

  /** The host's `playBots`: each bot whose turn it is plays, and every seat hears it in order. */
  playBots(): void {
    for (let played = botTurn(this.table); played !== null; played = botTurn(this.table)) {
      this.table = played.table;
      for (const box of this.inbox)
        box.push({ type: 'bot-turn', seat: played.seat, moves: played.moves });
      if (played.drew === null) this.broadcast();
      else this.tellDraw(played.table, played.drew);
    }
  }

  broadcast(): void {
    this.inbox.forEach((box, seat) =>
      box.push({ type: 'view', table: tableViewFor(this.table, seat) }),
    );
  }

  /** Everything queued for `seat`, handed to its page in order. */
  deliver(seat: number, page: Friends): Friends {
    const box = this.inbox[seat] ?? [];
    const out = box.reduce(received, page);
    box.length = 0;
    return out;
  }
}

function voteAwayOffer(host: Host) {
  return awayOffer(host.stall, host.here, host.now);
}

function playing(): Host {
  const game = layout(
    [
      { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'], hasMelded: true },
      { rack: ['black-5-a', 'black-6-a'] },
      { rack: ['orange-7-a', 'orange-8-a'] },
    ],
    [['blue-1-a', 'blue-2-a', 'blue-3-a']],
  );
  const host = new Host(
    { phase: 'playing', names: ['Ana', 'Bo', 'Cy'], bots: [], game, working: null },
    3,
  );
  host.broadcast();
  return host;
}

function sent(host: Host, seat: number, action: Sent): Friends {
  for (const message of action.send) host.hear(seat, message);
  return action.state;
}

describe('the mover’s page', () => {
  it('shows its own move at once and the host’s view once every move is answered', () => {
    const host = playing();
    let page = host.deliver(0, newFriends());
    page = sent(host, 0, placeTile(page, { kind: 'to-new-set', tileId: 'red-1-a' }));
    page = sent(host, 0, placeTile(page, { kind: 'to-set', tileId: 'red-2-a', set: 1 }));
    expect(page.unanswered).toBe(2);
    expect(shownView(page)?.table).toEqual([
      ts('blue-1-a', 'blue-2-a', 'blue-3-a'),
      ts('red-1-a', 'red-2-a'),
    ]);

    // The first answer is the table after one move; the page stays ahead of it, not behind.
    const first = host.inbox[0]?.shift();
    if (first === undefined) throw new Error('no answer');
    page = received(page, first);
    expect(page.unanswered).toBe(1);
    expect(shownView(page)?.table.at(-1)).toEqual(ts('red-1-a', 'red-2-a'));

    page = host.deliver(0, page);
    expect(page.ahead).toBeNull();
    expect(shownView(page)?.rack).toEqual(ts('red-3-a', 'blue-9-a'));
    expect(
      page.rows
        ?.flat()
        .filter((id) => id !== null)
        .sort(),
    ).toEqual(['blue-9-a', 'red-3-a']);
  });

  it('sends each tile of a group as its own move, in the order tapped', () => {
    const host = playing();
    let page = host.deliver(0, newFriends());
    const group = sendTiles(page, ['red-1-a', 'red-2-a', 'red-3-a'], { kind: 'new-set' });
    expect(group.send).toEqual([
      { type: 'move', move: { kind: 'to-new-set', tileId: 'red-1-a' } },
      { type: 'move', move: { kind: 'to-set', tileId: 'red-2-a', set: 1 } },
      { type: 'move', move: { kind: 'to-set', tileId: 'red-3-a', set: 1 } },
    ]);
    page = host.deliver(0, sent(host, 0, group));
    expect(shownView(page)?.table[1]).toEqual(ts('red-1-a', 'red-2-a', 'red-3-a'));
  });

  it('rearranges its rack on this device alone', () => {
    const host = playing();
    const page = host.deliver(0, newFriends());
    const moved = placeTile(page, { kind: 'to-rack', tileId: 'red-1-a' }, { row: 2, col: 5 });
    expect(moved.send).toEqual([]);
    expect(moved.state.rows?.[2]?.[5]).toBe('red-1-a');
  });

  it('refuses at once what the engine refuses, and sends nothing', () => {
    const host = playing();
    const page = host.deliver(0, newFriends());
    const moved = placeTile(page, { kind: 'to-rack', tileId: 'blue-1-a' });
    expect(moved.send).toEqual([]);
    expect(moved.state.notes).toEqual([
      { kind: 'refused', refusal: { kind: 'table-tile-to-rack', tileId: 'blue-1-a' } },
    ]);
  });

  it('shows the faults the host found in a turn that cannot end', () => {
    const host = playing();
    let page = host.deliver(0, newFriends());
    page = sent(host, 0, placeTile(page, { kind: 'to-new-set', tileId: 'red-1-a' }));
    page = host.deliver(0, sent(host, 0, sendTurn(page, { type: 'end-turn' })));
    expect(page.notes).toEqual([{ kind: 'fault', fault: { kind: 'invalid-set', set: 1 } }]);
    expect(shownView(page)?.table).toHaveLength(2);
  });

  it('takes the turn back at once to the table it began with', () => {
    const host = playing();
    let page = host.deliver(0, newFriends());
    page = host.deliver(
      0,
      sent(host, 0, placeTile(page, { kind: 'to-new-set', tileId: 'red-1-a' })),
    );
    const back = takeBackTurn(page);
    expect(back.send).toEqual([{ type: 'take-back' }]);
    expect(shownView(back.state)?.table).toEqual([ts('blue-1-a', 'blue-2-a', 'blue-3-a')]);
    page = host.deliver(0, sent(host, 0, back));
    expect(shownView(page)?.rack).toHaveLength(4);
  });

  it('draws by pick, and sees its own tile land face up', () => {
    const host = playing();
    let page = host.deliver(0, newFriends());
    const pile = page.pile;
    page = host.deliver(0, sent(host, 0, sendTurn(page, { type: 'draw', pick: 3 })));
    expect(page.replay.map((frame) => frame.step.kind)).toEqual(['drawing', 'drew']);
    const drawing = page.replay[0];
    if (drawing?.step.kind !== 'drawing') throw new Error('no flight');
    expect(drawing.step.pick).toBe(3);
    expect(drawing.step.face).not.toBeNull();
    expect(page.notes).toEqual([{ kind: 'drew', tile: drawing.step.face }]);
    expect(page.pile).toEqual(pile?.filter((_, i) => i !== 3));
  });

  it('cannot move a tile when it is not its turn', () => {
    const host = playing();
    const page = host.deliver(1, newFriends());
    expect(placeTile(page, { kind: 'to-new-set', tileId: 'black-5-a' }).send).toEqual([]);
    expect(friendsBoard(page)?.began).toBeNull();
  });
});

describe('a page watching another seat play', () => {
  it('sees the table reworked live and a count, never the mover’s tiles', () => {
    const host = playing();
    let mover = host.deliver(0, newFriends());
    let watcher = host.deliver(1, newFriends());
    mover = sent(host, 0, placeTile(mover, { kind: 'to-new-set', tileId: 'red-1-a' }));
    watcher = host.deliver(1, watcher);
    const board = friendsBoard(watcher);
    expect(board?.table.at(-1)).toEqual(ts('red-1-a'));
    expect(board?.counts).toEqual([3, 2, 2]);
    expect(board?.rack).toEqual(ts('black-5-a', 'black-6-a'));
    expect(JSON.stringify(watcher)).not.toContain('blue-9-a');
    expect(mover.unanswered).toBe(1);
  });

  it('is told when another seat played, and watches another seat’s draw face down', () => {
    const host = playing();
    let watcher = host.deliver(1, newFriends());
    host.hear(0, { type: 'move', move: { kind: 'to-new-set', tileId: 'red-1-a' } });
    host.hear(0, { type: 'move', move: { kind: 'to-set', tileId: 'red-2-a', set: 1 } });
    host.hear(0, { type: 'move', move: { kind: 'to-set', tileId: 'red-3-a', set: 1 } });
    host.hear(0, { type: 'end-turn' });
    watcher = host.deliver(1, watcher);
    expect(watcher.notes.map(noteText)).toEqual(['Ana laid down red 1–3.']);
    expect(friendsBoard(watcher)?.began).not.toBeNull();

    let other = host.deliver(2, newFriends());
    sent(host, 1, sendTurn(watcher, { type: 'draw', pick: 0 }));
    other = host.deliver(2, other);
    expect(other.replay.map((frame) => frame.step.kind)).toEqual(['drawing', 'drew']);
    expect(other.replay.every((f) => f.step.kind !== 'drawing' || f.step.face === null)).toBe(true);
    expect(other.replay[0]?.counts[1]).toBe(2);
    expect(other.replay[1]?.counts[1]).toBe(3);
  });
});

describe('seating and the deal', () => {
  it('lays out a fresh rack at the deal and refuses a deal from any seat but the first', () => {
    let table = newTable();
    for (const name of ['Ana', 'Bo']) {
      const sat = sitDown(table, name);
      if (!sat.ok) throw new Error('refused');
      table = sat.value.table;
    }
    const host = new Host(table, 2);
    host.broadcast();
    let second = host.deliver(1, newFriends());
    second = host.deliver(1, sent(host, 1, sendDeal(second)));
    expect(second.notes).toEqual([
      { kind: 'host', refusal: { kind: 'table', refusal: { kind: 'only-the-first-seat-deals' } } },
    ]);
    let first = host.deliver(0, newFriends());
    first = host.deliver(0, sent(host, 0, sendDeal(first)));
    second = host.deliver(1, second);
    for (const page of [first, second]) {
      expect(page.rows?.flat().filter((id) => id !== null)).toHaveLength(14);
      expect(friendsBoard(page)?.pile).toHaveLength(106 - 28);
    }
  });
});

describe('cancelling the table', () => {
  it('ends it for every seat, mid-turn, and drops what the mover was ahead with', () => {
    const host = playing();
    let mover = host.deliver(0, newFriends());
    let watcher = host.deliver(1, newFriends());
    mover = placeTile(mover, { kind: 'to-new-set', tileId: 'red-1-a' }).state;
    expect(mover.ahead).not.toBeNull();

    watcher = sent(host, 1, sendCancel(watcher));
    mover = host.deliver(0, mover);
    watcher = host.deliver(1, watcher);
    for (const page of [mover, watcher]) {
      expect(page.host).toMatchObject({ phase: 'cancelled', by: 1 });
      expect(shownView(page)).toBeNull();
      expect(friendsBoard(page)).toBeNull();
    }
    expect(watcher.unanswered).toBe(0);

    // Nothing is played at a cancelled table, and it is not cancelled twice.
    sent(host, 0, sendTurn(mover, { type: 'end-turn' }));
    sent(host, 0, sendCancel(mover));
    expect(host.deliver(0, mover).notes).toEqual([
      { kind: 'host', refusal: { kind: 'table', refusal: { kind: 'cancelled' } } },
    ]);
  });
});

describe('who is here', () => {
  it('shows a seat away once the host says it has no device connected, and back again', () => {
    let page = playing().deliver(0, newFriends());
    expect(friendsBoard(page)?.away).toEqual([false, false, false]);
    page = received(page, { type: 'presence', here: [true, false, true] });
    expect(friendsBoard(page)?.away).toEqual([false, true, false]);
    page = received(page, { type: 'presence', here: [true, true, true] });
    expect(friendsBoard(page)?.away).toEqual([false, false, false]);
  });
});

describe('a player who is away on their turn', () => {
  it('asks the others, and draws for them once everyone here has said yes', () => {
    const host = playing();
    let ana = host.deliver(0, newFriends());
    let bo = host.deliver(1, newFriends());
    let cy = host.deliver(2, newFriends());
    // Ana starts reworking the table, then her phone goes to sleep.
    ana = sent(host, 0, placeTile(ana, { kind: 'to-new-set', tileId: 'red-1-a' }));
    host.here = [false, true, true];
    host.settle();
    bo = host.deliver(1, bo);
    expect(bo.awayTurn).toBeNull();
    expect(awayQuestion(bo)).toBeNull();

    host.now = 60_000;
    host.settle();
    bo = host.deliver(1, bo);
    cy = host.deliver(2, cy);
    expect(awayQuestion(bo)).toEqual({ seat: 0, agreed: false, waitingFor: [2] });

    bo = sent(host, 1, sendAwayVote(bo, true));
    bo = host.deliver(1, bo);
    cy = host.deliver(2, cy);
    expect(bo.unanswered).toBe(0);
    expect(awayQuestion(bo)).toEqual({ seat: 0, agreed: true, waitingFor: [2] });
    expect(awayQuestion(cy)).toEqual({ seat: 0, agreed: false, waitingFor: [] });
    expect(host.table.phase === 'playing' && host.table.game.current).toBe(0);

    cy = sent(host, 2, sendAwayVote(cy, true));
    bo = host.deliver(1, bo);
    cy = host.deliver(2, cy);
    ana = host.deliver(0, ana);
    // Ana's half-made turn is taken back, not judged, and she has one tile more.
    expect(shownView(bo)?.current).toBe(1);
    expect(shownView(bo)?.table).toEqual([ts('blue-1-a', 'blue-2-a', 'blue-3-a')]);
    expect(shownView(ana)?.rack).toHaveLength(5);
    expect(bo.awayTurn).toBeNull();
    expect(cy.unanswered).toBe(0);
    expect(bo.replay.at(-1)?.step).toEqual({ kind: 'drew', face: null });
  });

  it('refuses a vote from a seat that is not asked', () => {
    const host = playing();
    let bo = host.deliver(1, newFriends());
    bo = sent(host, 1, sendAwayVote(bo, true));
    expect(host.deliver(1, bo).notes.map(noteText)).toEqual([
      'There is nobody away to draw for now.',
    ]);
  });
});

describe('the scores', () => {
  it('shows another player’s points left only where their score says them', () => {
    const game = layout(
      [{ rack: ['red-1-a', 'red-2-a', 'red-3-a'], hasMelded: true }, { rack: ['black-5-a'] }],
      [],
    );
    const host = new Host(
      { phase: 'playing', names: ['Ana', 'Bo'], bots: [], game, working: null },
      2,
    );
    host.broadcast();
    for (const id of ['red-1-a', 'red-2-a', 'red-3-a']) {
      host.hear(0, {
        type: 'move',
        move:
          id === 'red-1-a'
            ? { kind: 'to-new-set', tileId: id }
            : { kind: 'to-set', tileId: id, set: 0 },
      });
    }
    host.hear(0, { type: 'end-turn' });
    const loser = host.deliver(1, newFriends());
    expect(friendsBoard(loser)?.left).toEqual([0, 5]);
  });
});

describe('bots at a friends’ table', () => {
  /** Ana and two bots, Bo able to lay down a first meld and Cy only able to draw. */
  function withBots(): Host {
    const game = layout(
      [
        { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'], hasMelded: true },
        { rack: ['black-10-a', 'black-11-a', 'black-12-a', 'orange-1-a'] },
        { rack: ['orange-7-a', 'orange-8-a'] },
      ],
      [['blue-1-a', 'blue-2-a', 'blue-3-a']],
    );
    const bots = [
      { seat: 1, level: 'medium' as const },
      { seat: 2, level: 'medium' as const },
    ];
    const host = new Host(
      { phase: 'playing', names: ['Ana', 'Erik', 'Cowthey Fuzzy'], bots, game, working: null },
      3,
    );
    host.broadcast();
    return host;
  }

  it('are seated by the first seat, as the next of their level not at the table', () => {
    const host = new Host(newTable(), 2);
    for (const name of ['Ana', 'Bo']) {
      const sat = sitDown(host.table, name);
      if (!sat.ok) throw new Error('could not sit');
      host.table = sat.value.table;
    }
    host.broadcast();
    let ana = host.deliver(0, newFriends());
    let bo = host.deliver(1, newFriends());
    const added = sendAddBot(ana, 'medium');
    expect(added.send).toEqual([{ type: 'add-bot', level: 'medium', name: 'Erik' }]);
    ana = host.deliver(0, sent(host, 0, added));
    ana = host.deliver(0, sent(host, 0, sendAddBot(ana, 'medium')));
    expect(ana.host?.names).toEqual(['Ana', 'Bo', 'Erik', 'Cowthey Fuzzy']);
    expect(ana.host?.bots).toEqual([
      { seat: 2, level: 'medium' },
      { seat: 3, level: 'medium' },
    ]);

    bo = host.deliver(1, sent(host, 1, sendAddBot(host.deliver(1, bo), 'easy')));
    expect(bo.notes.map(noteText)).toEqual([
      'The first player to sit down adds and removes the bots.',
    ]);
  });

  it('are taken off by the first seat, and the page learns its new seat from the host (KUB-54)', () => {
    const host = new Host(newTable(), 3);
    const first = sitDown(host.table, 'Ana');
    if (!first.ok) throw new Error('could not sit');
    host.table = first.value.table;
    host.broadcast();
    let ana = host.deliver(0, newFriends());
    ana = host.deliver(0, sent(host, 0, sendAddBot(ana, 'medium')));
    const second = sitDown(host.table, 'Bo');
    if (!second.ok) throw new Error('could not sit');
    host.table = second.value.table;
    host.broadcast();
    let bo = host.deliver(2, newFriends());
    expect(bo.host?.you).toBe(2);

    const removing = sendRemoveBot(host.deliver(0, ana), 1);
    expect(removing.send).toEqual([{ type: 'remove-bot', seat: 1 }]);
    ana = host.deliver(0, sent(host, 0, removing));
    expect(ana.host?.names).toEqual(['Ana', 'Bo']);
    expect(ana.host?.bots).toEqual([]);
    bo = host.deliver(1, bo);
    expect(bo.host?.you).toBe(1);

    bo = host.deliver(1, sent(host, 1, sendRemoveBot(bo, 0)));
    expect(bo.notes.map(noteText)).toEqual([
      'The first player to sit down adds and removes the bots.',
    ]);
  });

  it('are never shown away and have their faces', () => {
    const host = withBots();
    host.here = [true, false, false];
    host.settle();
    const ana = host.deliver(0, newFriends());
    expect([0, 1, 2].map((seat) => isAway(ana, seat))).toEqual([false, false, false]);
    expect(friendsBoard(ana)?.faces).toEqual([null, 'erik', 'fuzzy']);
  });

  it('play after the person, each played back in turn, never showing a bot’s rack', () => {
    const host = withBots();
    let ana = host.deliver(0, newFriends());
    ana = host.deliver(0, sent(host, 0, sendTurn(ana, { type: 'draw', pick: null })));

    // Ana's draw, Erik's first meld tile by tile, then Fuzzy's draw, in the order they played.
    expect(ana.replay.map((frame) => [frame.name, frame.step.kind])).toEqual([
      ['Ana', 'drawing'],
      ['Ana', 'drew'],
      ['Erik', 'placed'],
      ['Erik', 'placed'],
      ['Erik', 'placed'],
      ['Erik', 'done'],
      ['Cowthey Fuzzy', 'drawing'],
      ['Cowthey Fuzzy', 'drew'],
    ]);
    const placed = ana.replay.flatMap((f) => (f.step.kind === 'placed' ? [f] : []));
    expect(placed.map((f) => f.counts[1])).toEqual([3, 2, 1]);
    expect(placed.at(-1)?.table.at(-1)).toEqual(ts('black-10-a', 'black-11-a', 'black-12-a'));
    expect(ana.notes.map((note) => note.kind)).toEqual(['drew', 'played']);
    expect(shownView(ana)?.current).toBe(0);
    // Erik's tile he kept, and the one Fuzzy drew, are nowhere on Ana's page.
    expect(JSON.stringify(ana)).not.toContain('orange-1-a');
    expect(JSON.stringify(ana)).not.toContain('orange-7-a');
  });

  it('start the chain afresh on the next turn, not replaying the last one', () => {
    const host = withBots();
    let ana = host.deliver(0, newFriends());
    ana = host.deliver(0, sent(host, 0, sendTurn(ana, { type: 'draw', pick: null })));
    ana = host.deliver(0, sent(host, 0, placeTile(ana, { kind: 'to-new-set', tileId: 'red-1-a' })));
    expect(ana.chain).toBeNull();
    ana = host.deliver(0, sent(host, 0, takeBackTurn(ana)));
    ana = host.deliver(0, sent(host, 0, sendTurn(ana, { type: 'draw', pick: null })));
    expect(ana.replay[0]).toMatchObject({ name: 'Ana', step: { kind: 'drawing' } });
    expect(ana.replay.filter((f) => f.name === 'Ana')).toHaveLength(2);
  });
});
