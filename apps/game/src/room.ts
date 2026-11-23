import { z } from 'zod';

import { stallSchema } from '../../../packages/core/src/away.ts';
import { parse } from '../../../packages/core/src/parse.ts';
import { newTable, sitDown, tableSchema, type Outcome } from '../../../packages/core/src/table.ts';

/**
 * What one table's Durable Object stores, as one row: the table (seats, the game, the turn in
 * progress) and the secret each seat was given when it sat down. The rules know nothing of
 * tokens; the host knows nothing of rules.
 *
 * A token is the only thing that says who a device is, so it never goes into a view or a
 * message. A device that loses it (cleared site data) loses the seat: there is no account to
 * recover it from (docs/online.md, "Who you are").
 */
const roomSchema = z.object({
  table: tableSchema,
  /** By seat; null for a bot's seat, which no device holds (`KUB-36`). */
  tokens: z.array(z.string().min(1).nullable()),
  /**
   * The turn held up by a seat that is away, and who has agreed to draw for it (`KUB-37`,
   * `away.ts`). A room stored before it was added has none, which is what it would have been.
   */
  stall: stallSchema.nullable().default(null),
});
export type Room = z.infer<typeof roomSchema>;

export function newRoom(): Room {
  return { table: newTable(), tokens: [], stall: null };
}

/**
 * The room stored as `body`, or a new one when there is none. A row that is there and does
 * not parse is thrown on, not replaced: a fresh room written over it would end a game in
 * progress without a word, and a stored game that fails its own schema is a bug to see.
 */
export function readRoom(body: unknown): Room {
  if (body === undefined || body === null) return newRoom();
  if (typeof body !== 'string') throw new Error('the stored room is not text');
  const parsed = parse(roomSchema, JSON.parse(body));
  if (!parsed.ok) throw new Error(`the stored room does not parse: ${parsed.issues.join('; ')}`);
  return parsed.value;
}

/** Sits `name` down with `token` as the seat's secret; the core decides whether they may. */
export function joinRoom(
  room: Room,
  token: string,
  name: string,
): Outcome<{ room: Room; seat: number }> {
  const sat = sitDown(room.table, name);
  if (!sat.ok) return sat;
  // Filled out to the seat, so a bot's seat before it is a null, never a hole.
  const tokens = sat.value.table.names.map((_, seat) => room.tokens[seat] ?? null);
  tokens[sat.value.seat] = token;
  return {
    ok: true,
    value: { room: { ...room, table: sat.value.table, tokens }, seat: sat.value.seat },
  };
}

/** The seat `token` was given, or null for a token this table never gave out. */
export function seatOf(room: Room, token: string | null): number | null {
  if (token === null || token === '') return null;
  const seat = room.tokens.indexOf(token);
  return seat === -1 ? null : seat;
}
