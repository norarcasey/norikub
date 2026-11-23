import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { awayOffer, settleAway, voteAway } from '../../../packages/core/src/away.ts';
import { parse } from '../../../packages/core/src/parse.ts';
import {
  CLOSE_GONE_QUIET,
  CLOSE_UNKNOWN_SEAT,
  joinRequestSchema,
  PING,
  PONG,
  tableClientMessageSchema,
  type JoinResponse,
  type TableMessage,
} from '../../../packages/core/src/protocol.ts';
import { apply, cancel, deal, tableViewFor, type Drew } from '../../../packages/core/src/table.ts';
import { isStale, presence, SWEEP_EVERY_MS, type OpenSeat } from './presence.ts';
import { joinRoom, readRoom, seatOf, type Room } from './room.ts';

/**
 * A socket's seat and when it was accepted, set by the host when it accepted the socket. A
 * deploy closes every socket, so none from before `since` was added is left to parse.
 */
const attachmentSchema = z.object({
  seat: z.number().int().nonnegative(),
  since: z.number(),
});

/**
 * One friends' table. Cloudflare runs one instance per name (`idFromName('table:<code>')`)
 * and hands it one event at a time, so two messages sent at once are judged one after the
 * other against the table the first left behind, with no lock written here (invariant 1).
 *
 * Sockets are accepted with the Hibernation API: between messages the object is evicted from
 * memory and not billed, and the seat rides on each socket as its attachment, so it is still
 * known when the object wakes. Nothing is kept in a field.
 *
 * The room, the table with the turn in progress and the tokens, is one row in the object's
 * SQLite storage, written before anything is sent, so a reload, an eviction or a deploy finds
 * the turn exactly as it was reworked (invariant 3).
 *
 * Who is here (`KUB-35`, as Hanora's `HAN-5`): every socket accepted or closed sends each seat
 * the new presence, and while any socket is open an alarm sweeps out those that have gone
 * quiet (`presence.ts`), since a phone that loses signal rarely says goodbye. A table nobody
 * is connected to sets no alarm, so it costs nothing.
 *
 * A seat away on its turn (`KUB-37`): every change of presence, time or turn goes through
 * `settle`, which hands the core who is here and the time (`settleAway`); the core decides
 * when the others are asked to draw for it and when they have all agreed. The sweep is what
 * notices the minute has passed, so the question opens within 15 s of it.
 */
export class Table extends DurableObject<object> {
  // The object reads nothing of the Worker's environment yet: keeping finished games
  // (`KUB-38`) is when it first will.
  constructor(ctx: DurableObjectState, env: object) {
    super(ctx, env);
    // Answered by the runtime itself, without waking the object or billing it.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK (id = 1), body TEXT NOT NULL)',
    );
  }

  private load(): Room {
    const [row] = this.ctx.storage.sql.exec('SELECT body FROM room WHERE id = 1').toArray();
    return readRoom(row?.['body']);
  }

  private save(room: Room): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO room (id, body) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body',
      JSON.stringify(room),
    );
  }

  /** The Worker sends only a table's requests (`/tables/<code>/…`), to `table:<code>`. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/join')) return this.join(await readBody(request));
    if (url.pathname.endsWith('/socket')) return this.openSocket(url.searchParams.get('token'));
    return new Response('not found', { status: 404 });
  }

  private join(body: unknown): Response {
    const request = parse(joinRequestSchema, body);
    if (!request.ok) return Response.json({ refused: 'not a name' }, { status: 400 });
    const token = crypto.randomUUID();
    const joined = joinRoom(this.load(), token, request.value.name);
    if (!joined.ok) return Response.json({ refused: joined.refusal }, { status: 409 });
    this.save(joined.value.room);
    this.broadcast(joined.value.room);
    // A new seat is away until its device connects, and the others should see that it is.
    this.settle(joined.value.room, null);
    const response: JoinResponse = { seat: joined.value.seat, token };
    return Response.json(response);
  }

  /**
   * A token this table never gave out is still answered with a socket, closed at once with a
   * code of its own: a browser shows a refused upgrade only as a bare failure, and the page
   * needs to tell "sit down again" from "try again".
   */
  private async openSocket(token: string | null): Promise<Response> {
    const [client, server] = Object.values(new WebSocketPair());
    if (client === undefined || server === undefined) throw new Error('WebSocketPair gave no pair');
    const room = this.load();
    const seat = seatOf(room, token);
    if (seat === null) {
      server.accept();
      server.close(CLOSE_UNKNOWN_SEAT, 'unknown seat');
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ seat, since: Date.now() });
    sendView(server, room, seat);
    this.settle(room, null);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_EVERY_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * A refused message goes back to its sender alone and changes nothing. An accepted one is
   * stored before anyone hears of it; then a draw's place in the pool goes to every seat, so
   * each page's pile loses the same tile, and every seat is sent its own view.
   */
  override webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): void {
    // The seat comes from the socket the host accepted, never from what was sent on it.
    const attached = parse(attachmentSchema, ws.deserializeAttachment());
    if (!attached.ok) throw new Error(`socket has no seat: ${attached.issues.join('; ')}`);
    const seat = attached.value.seat;
    const message = parse(tableClientMessageSchema, readJson(data));
    if (!message.ok) return send(ws, { type: 'refused', refusal: { kind: 'not-a-message' } });
    const room = this.load();
    const m = message.value;
    if (m.type === 'deal') {
      const dealt = deal(room.table, seat, freshSeed());
      if (!dealt.ok) return send(ws, { type: 'refused', refusal: dealt.refusal });
      const saved = { ...room, table: dealt.value };
      this.save(saved);
      return this.broadcast(saved);
    }
    if (m.type === 'cancel') {
      const cancelled = cancel(room.table, seat);
      if (!cancelled.ok) return send(ws, { type: 'refused', refusal: cancelled.refusal });
      const saved = { ...room, table: cancelled.value, stall: null };
      this.save(saved);
      this.broadcast(saved);
      return this.settle(saved, null);
    }
    if (m.type === 'draw-for-away') {
      const voted = voteAway(
        room.table,
        room.stall,
        this.here(room, null),
        Date.now(),
        seat,
        m.yes,
      );
      if (!voted.ok) return send(ws, { type: 'refused', refusal: voted.refusal });
      const saved = { ...room, table: voted.value.table, stall: voted.value.stall };
      this.save(saved);
      // Every message is answered to its sender with one view or one refusal (KUB-34): a vote
      // that did not carry changed no table, so its answer is the sender's view alone.
      if (voted.value.drew === null) sendView(ws, saved, seat);
      else this.tellDraw(saved, voted.value.drew);
      return this.settle(saved, null);
    }
    const applied = apply(room.table, seat, m);
    if (!applied.ok) return send(ws, { type: 'refused', refusal: applied.refusal });
    const saved = { ...room, table: applied.value.table };
    this.save(saved);
    if (applied.value.drew === null) this.broadcast(saved);
    else this.tellDraw(saved, applied.value.drew);
    // The turn may have passed to a seat that is away, whose minute starts now.
    this.settle(saved, null);
  }

  override webSocketClose(ws: WebSocket): void {
    this.settle(this.load(), ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.settle(this.load(), ws);
  }

  /**
   * The sweep: closes every socket that has not pinged for too long, tells the table, and
   * comes back while anyone is still connected.
   */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const quiet = this.open(null).filter((o) => isStale(now, o));
    for (const { ws } of quiet) ws.close(CLOSE_GONE_QUIET, 'gone quiet');
    const room = this.load();
    // While a turn is held up the sweep tells it every time, so the question opens on time
    // and a page that missed a frame catches up: one small frame a seat each 15 s.
    const held = room.stall !== null && awayOffer(room.stall, this.here(room, null), now) !== null;
    if (quiet.length > 0 || held) this.settle(room, null);
    if (this.open(null).length > 0) await this.ctx.storage.setAlarm(now + SWEEP_EVERY_MS);
  }

  /**
   * The open sockets, each with the seat it was accepted for and when it last pinged, leaving
   * out `except` (one that is closing in this same event).
   */
  private open(except: WebSocket | null): ({ ws: WebSocket } & OpenSeat)[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      if (ws === except || ws.readyState !== WebSocket.OPEN) return [];
      const attached = parse(attachmentSchema, ws.deserializeAttachment());
      if (!attached.ok) return [];
      const heard = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? null;
      return [{ ws, ...attached.value, heard }];
    });
  }

  /** Which seats have a device connected, leaving out `except`, which is closing. */
  private here(room: Room, except: WebSocket | null): boolean[] {
    return presence(room.table.names.length, this.open(except));
  }

  /**
   * After anything that may change who is here, the time or whose turn it is: the core
   * settles the stall (and may draw for an away seat, which is stored before it is told),
   * then every open socket is told who is here and whether a turn is held up.
   */
  private settle(room: Room, except: WebSocket | null): void {
    const now = Date.now();
    const here = this.here(room, except);
    const settled = settleAway(room.table, room.stall, here, now);
    let saved = room;
    if (settled.table !== room.table || settled.stall !== room.stall) {
      saved = { ...room, table: settled.table, stall: settled.stall };
      this.save(saved);
    }
    if (settled.drew !== null) this.tellDraw(saved, settled.drew, except);
    const offer = awayOffer(saved.stall, here, now);
    for (const { ws } of this.open(except)) {
      send(ws, { type: 'presence', here });
      send(ws, { type: 'away-turn', offer });
    }
  }

  /** A draw's place in the pool to every seat, so each page's pile loses the same tile; then views. */
  private tellDraw(room: Room, drew: Drew, except: WebSocket | null = null): void {
    for (const open of this.open(except)) send(open.ws, { type: 'drew', ...drew });
    this.broadcast(room, except);
  }

  /** Invariant 2: each socket is sent the view for its own seat, built by the core, one by one. */
  private broadcast(room: Room, except: WebSocket | null = null): void {
    for (const { ws, seat } of this.open(except)) sendView(ws, room, seat);
  }
}

function sendView(ws: WebSocket, room: Room, seat: number): void {
  send(ws, { type: 'view', table: tableViewFor(room.table, seat) });
}

function send(ws: WebSocket, message: TableMessage): void {
  ws.send(JSON.stringify(message));
}

/** The deal's seed: from the platform's CSPRNG, never stored or sent, so no seat can predict it. */
function freshSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

/** A request's JSON body, or undefined for none or not JSON, which no schema accepts. */
async function readBody(request: Request): Promise<unknown> {
  if (request.method !== 'POST') return undefined;
  return readJson(await request.text());
}

function readJson(data: string | ArrayBuffer): unknown {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data);
  } catch {
    // Not JSON is one more way of not being a message; the schema refuses `undefined`.
    return undefined;
  }
}
