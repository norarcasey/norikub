import { z } from 'zod';

import { awayOfferSchema } from './away.ts';
import { levelSchema } from './bot.ts';
import { displayNameSchema, refusalSchema, tableViewSchema, turnMessageSchema } from './table.ts';
import { moveSchema } from './turn.ts';

/**
 * What the page and a friends' table say to each other, modelled on Hanora's. One copy, here,
 * so the page parses what the host sends with the schema the host was written against, and
 * the host parses what a page sends the same way. Each treats the other's messages as
 * untrusted. No message says who is sending: the host knows the seat from the socket.
 */

/** Lower-case letters and digits, as in Hanora: it is typed by hand and read aloud to friends. */
export const tableCodeSchema = z.string().regex(/^[a-z0-9]{4,32}$/);

/**
 * Sitting down is the page's `POST /tables/<code>/join`, not a socket message, as in Hanora:
 * the answer carries the token that proves the seat, which the socket then presents. The
 * ticket (`KUB-32`) listed it as `sit-down {name}`; it is the same message, sent where the
 * token can be handed back (22 Nov 2026, agreed with the host's `KUB-33`).
 */
export const joinRequestSchema = z.object({ name: displayNameSchema }).readonly();
export type JoinRequest = z.infer<typeof joinRequestSchema>;

export const joinResponseSchema = z
  .object({ seat: z.number().int().min(0), token: z.string().min(16) })
  .readonly();
export type JoinResponse = z.infer<typeof joinResponseSchema>;

/**
 * The Worker's `{ refused }` when the page's origin is not one of the site's (`KUB-47`). The
 * page reads it to say *this site is not allowed* rather than *could not be reached*, which is
 * what a bare 403 looked like to it until 22 Nov 2026 (`KUB-46`).
 */
export const SITE_REFUSED = 'site';

/**
 * What a seat sends over its socket: `deal`, the first seat's once two or more are seated,
 * `cancel`, any seat's, which calls the table off for everyone (`KUB-52`), `add-bot`, the first
 * seat's before the deal (`KUB-36`), and the four
 * messages of a turn being played (`apply` in `table.ts`), from the seat whose turn it is.
 * `draw-for-away` is a seat's answer to "Draw a tile for <name>?" (`KUB-37`, `away.ts`): yes,
 * or no to take back a yes.
 */
export const tableClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('deal') }).readonly(),
  z.object({ type: z.literal('cancel') }).readonly(),
  /**
   * The first seat gives the next empty seat to a bot before the deal (`KUB-36`): how hard it
   * plays, and the name of the character it plays as, which the page picks from its cast.
   */
  z.object({ type: z.literal('add-bot'), level: levelSchema, name: displayNameSchema }).readonly(),
  z.object({ type: z.literal('draw-for-away'), yes: z.boolean() }).readonly(),
  ...turnMessageSchema.options,
]);
export type TableClientMessage = z.infer<typeof tableClientMessageSchema>;

export const tableMessageSchema = z.discriminatedUnion('type', [
  /** The table as this seat may see it, after every change, to every seat. */
  z.object({ type: z.literal('view'), table: tableViewSchema }).readonly(),
  /** Why the host refused what a page sent, told to that page alone. */
  z.object({ type: z.literal('refused'), refusal: refusalSchema }).readonly(),
  /**
   * Where in the pool a seat drew from, to every seat, so each page's scattered pile loses
   * the same tile (`KUB-25`). The tile itself is only in the drawer's view. Null: a pass.
   */
  z
    .object({
      type: z.literal('drew'),
      seat: z.number().int().min(0),
      drewAt: z.number().int().min(0).nullable(),
    })
    .readonly(),
  /**
   * A bot's moves, sent beside the result for the playback (`KUB-17`); empty when it drew.
   * Sent before the `drew` and the view of the same turn, so a page knows the view it is about
   * to get is a bot's turn and plays it back (`KUB-36`).
   */
  z
    .object({
      type: z.literal('bot-turn'),
      seat: z.number().int().min(0),
      moves: z.array(moveSchema).readonly(),
    })
    .readonly(),
  /**
   * Which seats have a device connected, by seat. Its own message rather than a field of the
   * view, as in Hanora, so a page older than it ignores it instead of failing every view.
   */
  z.object({ type: z.literal('presence'), here: z.array(z.boolean()).readonly() }).readonly(),
  /**
   * Whether the others may draw for a seat that is away on its turn, and who has agreed
   * (`KUB-37`); null when nobody is. Sent with every presence, after every change, and on each
   * sweep while it is open. Its own message for the reason presence is.
   */
  z.object({ type: z.literal('away-turn'), offer: awayOfferSchema.nullable() }).readonly(),
]);
export type TableMessage = z.infer<typeof tableMessageSchema>;

/**
 * The heartbeat, as in Hanora: a bare text frame the host's runtime answers without waking
 * the table, so a page that hears nothing back knows its socket is dead.
 */
export const PING = 'ping';
export const PONG = 'pong';
export const PING_EVERY_MS = 25_000;
export const PONG_WITHIN_MS = 10_000;

/** Close codes the page acts on, in the application's own 4000–4999 range. */
export const CLOSE_UNKNOWN_SEAT = 4403;
/**
 * The host's sweep closed a socket that had not pinged for too long (`KUB-35`). The page does
 * nothing special with it: like any other drop, it reconnects with its token.
 */
export const CLOSE_GONE_QUIET = 4408;
