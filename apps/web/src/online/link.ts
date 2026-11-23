import { parse } from '@norikub/core/parse';
import {
  CLOSE_UNKNOWN_SEAT,
  PING,
  PING_EVERY_MS,
  PONG,
  PONG_WITHIN_MS,
  tableMessageSchema,
} from '@norikub/core/protocol';
import type { TableClientMessage, TableMessage } from '@norikub/core/protocol';

/** The page's own socket: up, down and being tried again, or still on its way. */
export type Link = 'connecting' | 'open' | 'lost';

/** What a socket tells the link. One adapter (`browserSocket`) turns a WebSocket into this. */
export type SocketEvents = {
  readonly opened: () => void;
  readonly message: (data: unknown) => void;
  readonly closed: (code: number) => void;
};
export type LinkSocket = {
  readonly isOpen: () => boolean;
  readonly send: (data: string) => void;
  readonly close: () => void;
};
export type OpenSocket = (url: URL, on: SocketEvents) => LinkSocket;

export const browserSocket: OpenSocket = (url, on) => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => on.opened());
  ws.addEventListener('message', (event) => on.message(event.data));
  ws.addEventListener('close', (event) => on.closed(event.code));
  return {
    isOpen: () => ws.readyState === WebSocket.OPEN,
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
};

export type LinkListener = {
  readonly link: (link: Link) => void;
  /** A new socket is up: whatever was sent on the old one is gone. */
  readonly reconnected: () => void;
  readonly message: (message: TableMessage) => void;
  /** The table never gave out this token: sit down again. */
  readonly lostSeat: () => void;
};

/**
 * One seat's socket to its table, kept open for as long as the page wants it, ported from
 * Hanora's `TableConnection` (`HAN/HAN-5`) for `KUB-35`. Every drop reconnects with the same
 * token, so a reload or a lost signal comes back to the same seat (invariant 3).
 *
 * A socket can be dead without closing: a phone that lost signal, or a page iOS suspended and
 * woke. So the link pings every `PING_EVERY_MS`, and a ping met by nothing at all within
 * `PONG_WITHIN_MS` drops the socket and connects again. A socket that hears nothing within
 * the same wait of being opened never opened (the host sends a view the moment it accepts
 * one): offline, Chromium can leave one connecting for minutes, as Hanora saw. When the page
 * wakes or the network comes back (`wake`), the link checks at once and cuts any backoff
 * short, rather than waiting out a timer that was frozen with the page.
 */
export class TableLink {
  private socket: LinkSocket | null = null;
  /** Every timer that belongs to the current socket, cleared when it is dropped. */
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private tries = 0;
  /** Counts every frame from the current socket, so a probe can tell whether anything came. */
  private heard = 0;
  private stopped = false;

  constructor(
    private readonly url: URL,
    private readonly on: LinkListener,
    private readonly openSocket: OpenSocket = browserSocket,
  ) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearRetry();
    this.drop()?.close();
  }

  /** Sends on the open socket, or not at all: false when it is down. */
  send(messages: readonly TableClientMessage[]): boolean {
    const socket = this.socket;
    if (socket === null || !socket.isOpen()) return false;
    for (const message of messages) socket.send(JSON.stringify(message));
    return true;
  }

  /**
   * The page is back in front of someone, or the network came or went: check the socket now,
   * and if the link is waiting to retry, retry now.
   */
  wake(): void {
    if (this.stopped) return;
    this.tries = 0;
    if (this.retry !== null) {
      this.clearRetry();
      this.connect();
    } else if (this.socket?.isOpen() === true) {
      this.probe();
    }
  }

  private connect(): void {
    this.heard = 0;
    const socket: LinkSocket = this.openSocket(this.url, {
      opened: () => {
        if (this.socket !== socket) return;
        this.tries = 0;
        this.on.link('open');
        this.on.reconnected();
      },
      message: (data) => {
        if (this.socket !== socket) return;
        this.heard++;
        if (data === PONG) return;
        const message = parse(tableMessageSchema, readJson(data));
        if (message.ok) this.on.message(message.value);
        else console.warn('[norikub] the table sent a frame that is not a message', message.issues);
      },
      closed: (code) => {
        if (this.socket !== socket) return;
        this.drop();
        if (code === CLOSE_UNKNOWN_SEAT) return this.on.lostSeat();
        this.lost();
      },
    });
    this.socket = socket;
    this.on.link('connecting');
    // Never heard from at all: it never really opened.
    this.after(PONG_WITHIN_MS, () => {
      if (this.heard === 0) this.abandon();
    });
    this.every();
  }

  private every(): void {
    this.after(PING_EVERY_MS, () => {
      this.probe();
      this.every();
    });
  }

  /** Pings, and drops the socket if nothing at all comes back in time. */
  private probe(): void {
    const socket = this.socket;
    if (socket === null || !socket.isOpen()) return;
    const before = this.heard;
    socket.send(PING);
    this.after(PONG_WITHIN_MS, () => {
      if (this.heard === before) this.abandon();
    });
  }

  private abandon(): void {
    this.drop()?.close();
    this.lost();
  }

  private lost(): void {
    this.on.link('lost');
    // Sooner at first, as a phone coming back into signal usually is; never slower than 10 s.
    const wait = Math.min(10_000, 500 * 2 ** this.tries++);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, wait);
  }

  /** Forgets the current socket and its timers, and hands it back for closing. */
  private drop(): LinkSocket | null {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    const socket = this.socket;
    this.socket = null;
    return socket;
  }

  private after(ms: number, then: () => void): void {
    const socket = this.socket;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.socket === socket && !this.stopped) then();
    }, ms);
    this.timers.add(timer);
  }

  private clearRetry(): void {
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
  }
}

function readJson(data: unknown): unknown {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
