import { describe, expect, it } from 'vitest';

import { layout, ts } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import type { TableClientMessage, TableMessage } from '../../../../packages/core/src/protocol.ts';
import {
  apply,
  deal,
  newTable,
  sitDown,
  tableViewFor,
} from '../../../../packages/core/src/table.ts';
import type { Table } from '../../../../packages/core/src/table.ts';
import { noteText } from '../table/messages.ts';
import {
  friendsBoard,
  newFriends,
  placeTile,
  received,
  sendDeal,
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
  constructor(
    public table: Table,
    seats: number,
  ) {
    this.inbox = Array.from({ length: seats }, () => []);
  }

  hear(seat: number, message: TableClientMessage): void {
    if (message.type === 'deal') {
      const dealt = deal(this.table, seat, 7);
      if (!dealt.ok)
        return void this.inbox[seat]?.push({ type: 'refused', refusal: dealt.refusal });
      this.table = dealt.value;
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

function playing(): Host {
  const game = layout(
    [
      { rack: ['red-1-a', 'red-2-a', 'red-3-a', 'blue-9-a'], hasMelded: true },
      { rack: ['black-5-a', 'black-6-a'] },
      { rack: ['orange-7-a', 'orange-8-a'] },
    ],
    [['blue-1-a', 'blue-2-a', 'blue-3-a']],
  );
  const host = new Host({ phase: 'playing', names: ['Ana', 'Bo', 'Cy'], game, working: null }, 3);
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

describe('the scores', () => {
  it('shows another player’s points left only where their score says them', () => {
    const game = layout(
      [{ rack: ['red-1-a', 'red-2-a', 'red-3-a'], hasMelded: true }, { rack: ['black-5-a'] }],
      [],
    );
    const host = new Host({ phase: 'playing', names: ['Ana', 'Bo'], game, working: null }, 2);
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
