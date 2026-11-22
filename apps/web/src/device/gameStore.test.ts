import { afterEach, describe, expect, it, vi } from 'vitest';

import { moveTile, newSession } from '../table/session.ts';
import type { Session } from '../table/session.ts';
import { JOURNAL_KEY, createGameStore } from './gameStore.ts';
import type { Durable, Journal } from './gameStore.ts';

afterEach(() => vi.restoreAllMocks());

function memoryJournal(): Journal & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}

/**
 * IndexedDB with its puts held until `settle`, so a test can tear the page down inside one:
 * the window the journal exists for. What it holds survives a "reload" only once settled.
 */
type Held = Durable & { settle: () => Promise<void>; stored: unknown };

function heldDurable(): Held {
  const pending: (() => void)[] = [];
  const fake: Held = {
    stored: undefined,
    read: () => Promise.resolve(fake.stored),
    write: (entry: unknown) =>
      new Promise<void>((resolve) => {
        pending.push(() => {
          fake.stored = JSON.parse(JSON.stringify(entry));
          resolve();
        });
      }),
    settle: async () => {
      for (const done of pending.splice(0)) done();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  return fake;
}

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

function played(): Session {
  const fresh = newSession(11);
  const tile = fresh.turn?.rack[0];
  if (tile === undefined) throw new Error('a deal with no tiles');
  return moveTile(fresh, { kind: 'to-new-set', tileId: tile.id });
}

describe('the game on this device', () => {
  it('is new when nothing was saved', async () => {
    const warn = quiet();
    const store = createGameStore({ journal: memoryJournal(), durable: heldDurable() });
    expect(await store.load()).toBeNull();
    // An empty database is a first game, not something to warn about.
    expect(warn).not.toHaveBeenCalled();
  });

  it('survives a reload inside the IndexedDB put, from the journal', async () => {
    const journal = memoryJournal();
    const durable = heldDurable();
    const session = played();
    createGameStore({ journal, durable }).save(session);
    // Reloaded before the put landed: a new page, the put never settled.
    const back = await createGameStore({ journal, durable }).load();
    expect(back?.turn).toEqual(session.turn);
  });

  it('leaves the journal once IndexedDB holds the save, and resumes from there', async () => {
    const journal = memoryJournal();
    const durable = heldDurable();
    const session = played();
    createGameStore({ journal, durable }).save(session);
    await durable.settle();
    expect(journal.items.has(JOURNAL_KEY)).toBe(false);
    const back = await createGameStore({ journal, durable }).load();
    expect(back?.turn).toEqual(session.turn);
  });

  it('keeps a later save in the journal when an earlier put lands', async () => {
    const journal = memoryJournal();
    const durable = heldDurable();
    const store = createGameStore({ journal, durable });
    const first = newSession(11);
    const second = played();
    store.save(first);
    const settling = durable.settle();
    store.save(second);
    await settling;
    expect(journal.items.has(JOURNAL_KEY)).toBe(true);
    const back = await createGameStore({ journal, durable }).load();
    expect(back?.turn).toEqual(second.turn);
  });

  it('takes the newer of the two, and counts on from it', async () => {
    const journal = memoryJournal();
    const durable = heldDurable();
    const store = createGameStore({ journal, durable });
    store.save(newSession(11));
    await durable.settle();
    const later = played();
    store.save(later);
    // IndexedDB holds save 1, the journal save 2.
    const reopened = createGameStore({ journal, durable });
    expect((await reopened.load())?.turn).toEqual(later.turn);
    reopened.save(later);
    expect(journal.items.get(JOURNAL_KEY)).toContain('"seq":3');
  });

  it('is kept by the journal alone where there is no IndexedDB', async () => {
    const journal = memoryJournal();
    const session = played();
    createGameStore({ journal, durable: null }).save(session);
    expect((await createGameStore({ journal, durable: null }).load())?.turn).toEqual(session.turn);
  });

  it('is kept by IndexedDB alone where the journal refuses it', async () => {
    quiet();
    const durable = heldDurable();
    const full: Journal = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {},
    };
    const session = played();
    createGameStore({ journal: full, durable }).save(session);
    await durable.settle();
    expect((await createGameStore({ journal: full, durable }).load())?.turn).toEqual(session.turn);
  });

  it('keeps the journal when IndexedDB refuses the put', async () => {
    quiet();
    const journal = memoryJournal();
    const refusing: Durable = {
      read: () => Promise.reject(new Error('gone')),
      write: () => Promise.reject(new Error('refused')),
    };
    const session = played();
    createGameStore({ journal, durable: refusing }).save(session);
    await Promise.resolve();
    expect(journal.items.has(JOURNAL_KEY)).toBe(true);
    const back = await createGameStore({ journal, durable: refusing }).load();
    expect(back?.turn).toEqual(session.turn);
  });

  it('falls back past a save that cannot be resumed, and is new past both', async () => {
    const warn = quiet();
    const journal = memoryJournal();
    const durable = heldDurable();
    const session = played();
    createGameStore({ journal, durable }).save(session);
    await durable.settle();
    journal.setItem(JOURNAL_KEY, JSON.stringify({ seq: 99, saved: { version: 0 } }));
    expect((await createGameStore({ journal, durable }).load())?.turn).toEqual(session.turn);
    journal.setItem(JOURNAL_KEY, 'not json');
    durable.stored = { seq: 'one' };
    expect(await createGameStore({ journal, durable }).load()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
});
