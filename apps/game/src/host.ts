import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';

import { parse } from '../../../packages/core/src/parse.ts';
import {
  CLOSE_UNKNOWN_SEAT,
  joinRequestSchema,
  PING,
  PONG,
  tableClientMessageSchema,
  type JoinResponse,
  type TableMessage,
} from '../../../packages/core/src/protocol.ts';
import { apply, deal, tableViewFor } from '../../../packages/core/src/table.ts';
import { joinRoom, readRoom, seatOf, type Room } from './room.ts';

/** A socket's seat, set by the host when it accepted the socket. */
const attachmentSchema = z.object({ seat: z.number().int().nonnegative() });

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
 * Who is here (presence and the sweep of quiet sockets) is `KUB-35`.
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
    const response: JoinResponse = { seat: joined.value.seat, token };
    return Response.json(response);
  }

  /**
   * A token this table never gave out is still answered with a socket, closed at once with a
   * code of its own: a browser shows a refused upgrade only as a bare failure, and the page
   * needs to tell "sit down again" from "try again".
   */
  private openSocket(token: string | null): Response {
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
    server.serializeAttachment({ seat });
    sendView(server, room, seat);
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
    const applied = apply(room.table, seat, m);
    if (!applied.ok) return send(ws, { type: 'refused', refusal: applied.refusal });
    const saved = { ...room, table: applied.value.table };
    this.save(saved);
    const drew = applied.value.drew;
    if (drew !== null) {
      for (const open of this.open()) send(open.ws, { type: 'drew', ...drew });
    }
    this.broadcast(saved);
  }

  /** The open sockets, each with the seat it was accepted for. */
  private open(): { ws: WebSocket; seat: number }[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      if (ws.readyState !== WebSocket.OPEN) return [];
      const attached = parse(attachmentSchema, ws.deserializeAttachment());
      return attached.ok ? [{ ws, seat: attached.value.seat }] : [];
    });
  }

  /** Invariant 2: each socket is sent the view for its own seat, built by the core, one by one. */
  private broadcast(room: Room): void {
    for (const { ws, seat } of this.open()) sendView(ws, room, seat);
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
