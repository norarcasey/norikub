import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLOSE_UNKNOWN_SEAT,
  PING,
  PING_EVERY_MS,
  PONG,
  PONG_WITHIN_MS,
} from '../../../../packages/core/src/protocol.ts';
import type { TableMessage } from '../../../../packages/core/src/protocol.ts';
import { TableLink } from './link.ts';
import type { Link, LinkSocket, OpenSocket, SocketEvents } from './link.ts';

/** A socket the test drives by hand: it opens, speaks and closes when told to. */
class FakeSocket implements LinkSocket {
  open = false;
  closed = false;
  readonly sent: string[] = [];
  constructor(readonly on: SocketEvents) {}
  isOpen = () => this.open && !this.closed;
  send = (data: string) => {
    this.sent.push(data);
  };
  close = () => {
    this.closed = true;
  };
  accept() {
    this.open = true;
    this.on.opened();
    this.on.message(JSON.stringify({ type: 'presence', here: [true] }));
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const links: Link[] = [];
  const messages: TableMessage[] = [];
  let reconnects = 0;
  let lostSeat = false;
  const open: OpenSocket = (_url, on) => {
    const socket = new FakeSocket(on);
    sockets.push(socket);
    return socket;
  };
  const link = new TableLink(
    new URL('ws://localhost/tables/abcd/socket'),
    {
      link: (l) => links.push(l),
      reconnected: () => reconnects++,
      message: (m) => messages.push(m),
      lostSeat: () => (lostSeat = true),
    },
    open,
  );
  const last = () => {
    const socket = sockets.at(-1);
    if (socket === undefined) throw new Error('no socket opened');
    return socket;
  };
  return {
    link,
    sockets,
    links,
    messages,
    last,
    reconnects: () => reconnects,
    lostSeat: () => lostSeat,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a seat’s link to its table', () => {
  it('opens, passes the host’s messages on, and pings without passing on the pong', () => {
    const h = harness();
    h.link.start();
    expect(h.links).toEqual(['connecting']);
    h.last().accept();
    expect(h.links.at(-1)).toBe('open');
    expect(h.reconnects()).toBe(1);
    expect(h.messages).toEqual([{ type: 'presence', here: [true] }]);

    vi.advanceTimersByTime(PING_EVERY_MS);
    expect(h.last().sent).toEqual([PING]);
    h.last().on.message(PONG);
    vi.advanceTimersByTime(PONG_WITHIN_MS);
    expect(h.messages).toHaveLength(1);
    expect(h.sockets).toHaveLength(1);
    expect(h.links.at(-1)).toBe('open');
  });

  it('sends only on an open socket', () => {
    const h = harness();
    h.link.start();
    expect(h.link.send([{ type: 'deal' }])).toBe(false);
    h.last().accept();
    expect(h.link.send([{ type: 'deal' }, { type: 'take-back' }])).toBe(true);
    expect(h.last().sent).toEqual(['{"type":"deal"}', '{"type":"take-back"}']);
  });

  it('drops a socket whose ping meets silence, says so, and connects again', () => {
    const h = harness();
    h.link.start();
    h.last().accept();
    vi.advanceTimersByTime(PING_EVERY_MS + PONG_WITHIN_MS);
    expect(h.sockets[0]?.closed).toBe(true);
    expect(h.links.at(-1)).toBe('lost');
    vi.advanceTimersByTime(500);
    expect(h.sockets).toHaveLength(2);
    h.last().accept();
    expect(h.links.at(-1)).toBe('open');
    expect(h.reconnects()).toBe(2);
  });

  it('gives up on a socket that never says anything, as one opened offline can', () => {
    const h = harness();
    h.link.start();
    vi.advanceTimersByTime(PONG_WITHIN_MS);
    expect(h.sockets[0]?.closed).toBe(true);
    expect(h.links).toEqual(['connecting', 'lost']);
  });

  it('backs off while the host stays away, and starts again from the shortest wait once back', () => {
    const h = harness();
    h.link.start();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      h.last().on.closed(1006);
      const before = h.sockets.length;
      let waited = 0;
      while (h.sockets.length === before) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 10_000]);
    h.last().accept();
    h.last().on.closed(1006);
    vi.advanceTimersByTime(500);
    expect(h.sockets).toHaveLength(8);
  });

  it('on waking, retries at once instead of waiting out the backoff', () => {
    const h = harness();
    h.link.start();
    for (let i = 0; i < 4; i++) {
      h.last().on.closed(1006);
      vi.advanceTimersByTime(10_000);
    }
    h.last().on.closed(1006);
    expect(h.sockets).toHaveLength(5);
    h.link.wake();
    expect(h.sockets).toHaveLength(6);
  });

  it('on waking with a socket up, checks it with a ping now', () => {
    const h = harness();
    h.link.start();
    h.last().accept();
    h.link.wake();
    expect(h.last().sent).toEqual([PING]);
    vi.advanceTimersByTime(PONG_WITHIN_MS);
    expect(h.links.at(-1)).toBe('lost');
  });

  it('hears that the seat is gone, and stops trying', () => {
    const h = harness();
    h.link.start();
    h.last().on.closed(CLOSE_UNKNOWN_SEAT);
    expect(h.lostSeat()).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('ignores a dropped socket that speaks late, and anything that is not a message', () => {
    const h = harness();
    h.link.start();
    const first = h.last();
    first.accept();
    vi.advanceTimersByTime(PING_EVERY_MS + PONG_WITHIN_MS);
    first.on.message(JSON.stringify({ type: 'presence', here: [false] }));
    first.on.closed(1000);
    expect(h.messages).toHaveLength(1);
    vi.advanceTimersByTime(500);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.last().on.message('not json');
    h.last().on.message(new ArrayBuffer(2));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(h.messages).toHaveLength(1);
  });

  it('closes its socket and sets no timer once stopped', () => {
    const h = harness();
    h.link.start();
    h.last().accept();
    h.link.stop();
    expect(h.last().closed).toBe(true);
    h.link.wake();
    vi.advanceTimersByTime(120_000);
    expect(h.sockets).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
