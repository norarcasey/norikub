import { PING_EVERY_MS, PONG_WITHIN_MS } from '../../../packages/core/src/protocol.ts';

/**
 * Who is at the table right now, ported from Hanora's (`HAN/HAN-5`). A seat is here while
 * some device holds an open socket to it, and away otherwise; away is never gone, and the
 * seat waits for its device (invariant 3).
 *
 * A phone that loses signal or is suspended by iOS often never closes its socket, so the host
 * would think it here for as long as the network takes to notice. Pages ping every
 * `PING_EVERY_MS`; a socket silent for `STALE_AFTER_MS` (one missed ping, with room for a slow
 * network) is closed by the host's sweep, and its seat shows as away.
 *
 * Hanora measured, against `wrangler dev` on 17 Nov 2026, a 70 s limit swept every 30 s
 * showing a lost device as away after 89 s, and 50 s swept every 15 s after 59 s. Norikub's
 * own measurement is in docs/online.md, "Who is here". The sweep is an alarm while anyone is
 * connected: four storage writes a minute per live table.
 */
export const STALE_AFTER_MS = PING_EVERY_MS + PONG_WITHIN_MS + 15_000;
export const SWEEP_EVERY_MS = 15_000;

export interface OpenSeat {
  readonly seat: number;
  /** When the socket was accepted, in ms. */
  readonly since: number;
  /** When it last pinged, in ms, or null if it never has. */
  readonly heard: number | null;
}

export function presence(seats: number, open: readonly OpenSeat[]): boolean[] {
  return Array.from({ length: seats }, (_, seat) => open.some((o) => o.seat === seat));
}

export function isStale(now: number, socket: OpenSeat): boolean {
  return now - Math.max(socket.since, socket.heard ?? 0) > STALE_AFTER_MS;
}
