import { parse } from '@norikub/core/parse';
import { tableCodeSchema } from '@norikub/core/protocol';
import { z } from 'zod';

/**
 * Letters and digits a friend can read aloud and type without asking which one it was: no
 * 0/o, no 1/l/i. 31 of them, so a code of 12 is one of about 8 × 10^17, which nobody guesses;
 * a table is reached by its code and nothing else (non-goal 2, docs/online.md "Invites").
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const CODE_LENGTH = 12;

/**
 * A new table's code. `bytes` is the platform's CSPRNG by default; a byte at or past the last
 * whole multiple of the alphabet is thrown away rather than folded in, so every letter is as
 * likely as every other.
 */
export function newTableCode(
  bytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const limit = 256 - (256 % ALPHABET.length);
  let code = '';
  while (code.length < CODE_LENGTH) {
    for (const byte of bytes(CODE_LENGTH * 2)) {
      if (byte < limit && code.length < CODE_LENGTH) code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

/** The table a path names, `/t/<code>`, or null for any other path. */
export function tableCodeOf(pathname: string): string | null {
  const match = /^\/t\/([^/]+)\/?$/.exec(pathname);
  if (match === null) return null;
  const code = parse(tableCodeSchema, match[1]?.toLowerCase());
  return code.ok ? code.value : null;
}

/** Whether a path is a table's at all, so a mistyped code is told so rather than sent to the bots. */
export function isTablePath(pathname: string): boolean {
  return /^\/t(\/|$)/.test(pathname);
}

const rowsSchema = z.array(z.array(z.string().min(1).nullable()).readonly()).readonly();

/**
 * What this device keeps for one table, under its code: the token that proves its seat, and
 * how it has laid out its rack, which is the device's and never the host's (KUB-20). The token
 * is the seat: a device that loses it (cleared site data) sits down again as someone new
 * (docs/online.md, "Who you are").
 */
const seatSchema = z
  .object({
    token: z.string().min(16),
    seat: z.number().int().min(0),
    rows: rowsSchema.nullable(),
    startRows: rowsSchema.nullable(),
  })
  .readonly();
export type KeptSeat = z.infer<typeof seatSchema>;

const key = (code: string) => `norikub.table.${code}`;
/** The table this device last kept a seat at, for the way back from the bot game (`KUB-35`). */
const LAST_KEY = 'norikub.lastTable';

/**
 * localStorage, which a private window or blocked site data can take away: every read and
 * write is allowed to fail, and a failed read is no seat.
 */
export function keptSeat(
  code: string,
  storage: Storage | null = localStorageOrNull(),
): KeptSeat | null {
  try {
    const raw = storage?.getItem(key(code));
    if (raw === null || raw === undefined) return null;
    const parsed = parse(seatSchema, JSON.parse(raw));
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

export function keepSeat(
  code: string,
  seat: KeptSeat,
  storage: Storage | null = localStorageOrNull(),
): void {
  try {
    storage?.setItem(key(code), JSON.stringify(seat));
    storage?.setItem(LAST_KEY, code);
  } catch {
    // Storage full or refused: the seat lasts as long as this page, which is all it can.
  }
}

export function forgetSeat(code: string, storage: Storage | null = localStorageOrNull()): void {
  try {
    storage?.removeItem(key(code));
  } catch {
    // Nothing kept is nothing to forget.
  }
}

/**
 * The last table this device holds a seat at, or null. An installed app opens at `/`, the bot
 * game, so a player who closed it mid-game would otherwise need the link again.
 */
export function lastTable(storage: Storage | null = localStorageOrNull()): string | null {
  try {
    const code = parse(tableCodeSchema, storage?.getItem(LAST_KEY));
    return code.ok && keptSeat(code.value, storage) !== null ? code.value : null;
  } catch {
    return null;
  }
}

function localStorageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
