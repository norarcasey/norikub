import { parse } from '@norikub/core/parse';
import { z } from 'zod';

import { fromSaved, toSaved } from '../table/saved.ts';
import type { Session } from '../table/session.ts';

/**
 * Where the game in progress lives on this device, so a reload, a closed tab, the phone
 * killing the installed app or the Mac app quitting resumes it (invariant 3).
 *
 * IndexedDB is the store. A put there takes milliseconds and a page torn down inside them
 * loses it: the offline-write layer measured a write tapped just before a reload gone after it
 * (Chromium, 24 Sep 2026). "Saved before it is shown" cannot rest on that, so every save also
 * goes synchronously into a localStorage journal, and leaves it once IndexedDB has confirmed
 * that save or a later one. Loading reads both and takes the higher `seq`. The journal is
 * normally empty; between a move and its put it holds that one game.
 *
 * One game, under one owner: this device. When games are played with friends online, the
 * owner becomes the account and the key changes with it (invariant 6's "under an owner").
 */
export const OWNER = 'this-device';
export const JOURNAL_KEY = `norikub-game:${OWNER}`;
const DATABASE = 'norikub-game';
const STORE = 'games';

const entrySchema = z.object({ seq: z.number().int().min(0), saved: z.unknown() }).readonly();
type Entry = z.infer<typeof entrySchema>;

/** The durable half: IndexedDB in the app, a fake in tests. */
export type Durable = {
  readonly read: () => Promise<unknown>;
  readonly write: (entry: Entry) => Promise<void>;
};

/** The journal's half of `Storage`; localStorage in the app. */
export type Journal = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type GameStore = {
  /** The game to resume, or null for a new one. Never rejects: a store that fails is empty. */
  readonly load: () => Promise<Session | null>;
  /** Kept before it returns, as far as the journal can; call it before showing `session`. */
  readonly save: (session: Session) => void;
};

export function createGameStore({
  journal,
  durable,
}: {
  journal: Journal | null;
  durable: Durable | null;
}): GameStore {
  let seq = 0;

  const fromJournal = (): Entry | null => {
    try {
      const raw = journal?.getItem(JOURNAL_KEY);
      if (raw === null || raw === undefined) return null;
      return entryOf(JSON.parse(raw), 'journal');
    } catch (error) {
      console.warn('[norikub] the saved game in the journal could not be read', error);
      return null;
    }
  };

  const fromDurable = async (): Promise<Entry | null> => {
    try {
      const stored = await durable?.read();
      // Nothing stored yet is a first game, not a bad entry.
      return stored === undefined ? null : entryOf(stored, 'IndexedDB');
    } catch (error) {
      console.warn('[norikub] the saved game in IndexedDB could not be read', error);
      return null;
    }
  };

  return {
    async load() {
      const entries = [fromJournal(), await fromDurable()].filter((entry) => entry !== null);
      entries.sort((a, b) => b.seq - a.seq);
      seq = entries[0]?.seq ?? 0;
      for (const entry of entries) {
        const session = fromSaved(entry.saved);
        if (session !== null) return session;
        console.warn(`[norikub] saved game ${entry.seq} is not one this build can resume`);
      }
      return null;
    },

    save(session) {
      seq += 1;
      const entry: Entry = { seq, saved: toSaved(session) };
      const raw = JSON.stringify(entry);
      try {
        journal?.setItem(JOURNAL_KEY, raw);
      } catch (error) {
        // Full or refused (a private window): IndexedDB may still take it.
        console.warn('[norikub] the journal refused the game', error);
      }
      if (durable === null) return;
      durable.write(entry).then(
        () => {
          // Only this save's copy leaves: a later one in the journal is not yet in IndexedDB.
          try {
            if (journal?.getItem(JOURNAL_KEY) === raw) journal.removeItem(JOURNAL_KEY);
          } catch {
            // A journal that cannot be read now holds nothing newer than IndexedDB does.
          }
        },
        (error: unknown) => {
          console.warn('[norikub] IndexedDB refused the game; the journal keeps it', error);
        },
      );
    },
  };
}

function entryOf(input: unknown, where: string): Entry | null {
  const parsed = parse(entrySchema, input);
  if (parsed.ok) return parsed.value;
  console.warn(`[norikub] the saved game in ${where} is not an entry`, parsed.issues);
  return null;
}

/** IndexedDB as the durable half: one store, one record, under the owner's key. */
export function indexedDbDurable(factory: IDBFactory): Durable {
  let open: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    open ??= new Promise((resolve, reject) => {
      const request = factory.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const opened = request.result;
        // The browser let go of it, or another tab wants a newer version: reopen next time.
        opened.onclose = () => (open = null);
        opened.onversionchange = () => {
          opened.close();
          open = null;
        };
        resolve(opened);
      };
      request.onerror = () => {
        open = null;
        reject(request.error ?? new Error(`could not open ${DATABASE}`));
      };
    });
    return open;
  };

  const run = async <T>(
    mode: IDBTransactionMode,
    act: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const tx = (await db()).transaction(STORE, mode);
    const request = act(tx.objectStore(STORE));
    return new Promise((resolve, reject) => {
      // A write counts once its transaction has committed, not when the request succeeds.
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error ?? new Error('transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
    });
  };

  return {
    read: () => run('readonly', (store) => store.get(OWNER)),
    write: async (entry) => {
      await run('readwrite', (store) => store.put(entry, OWNER));
    },
  };
}

/** The store over this browser's own storage, either half left out where it is missing. */
export function deviceGameStore(): GameStore {
  let journal: Journal | null = null;
  try {
    journal = globalThis.localStorage;
  } catch {
    // Storage blocked: reading `localStorage` itself throws.
  }
  const factory = 'indexedDB' in globalThis ? globalThis.indexedDB : null;
  return createGameStore({ journal, durable: factory && indexedDbDurable(factory) });
}
