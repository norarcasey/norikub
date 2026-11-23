import { describe, expect, it } from 'vitest';

import { addBot } from '../../../packages/core/src/table.ts';
import { isStale, presence, STALE_AFTER_MS } from '../src/presence.ts';
import { joinRoom, newRoom, readRoom, seatOf, type Room } from '../src/room.ts';

function sat(room: Room, token: string, name: string): Room {
  const joined = joinRoom(room, token, name);
  if (!joined.ok) throw new Error(`refused: ${JSON.stringify(joined.refusal)}`);
  return joined.value.room;
}

describe('the room', () => {
  it('starts empty when nothing is stored', () => {
    expect(readRoom(undefined)).toEqual(newRoom());
    expect(readRoom(null)).toEqual(newRoom());
  });

  it('gives each seat its own token, and knows a seat only by it', () => {
    const room = sat(sat(newRoom(), 't-nora', 'Nora'), 't-kit', 'Kit');
    expect(seatOf(room, 't-nora')).toBe(0);
    expect(seatOf(room, 't-kit')).toBe(1);
    expect(seatOf(room, 't-nobody')).toBeNull();
    expect(seatOf(room, '')).toBeNull();
    expect(seatOf(room, null)).toBeNull();
  });

  it('passes on the core refusing a seat, and gives out no token for it', () => {
    let room = newRoom();
    for (const name of ['A', 'B', 'C', 'D']) room = sat(room, `t-${name}`, name);
    const fifth = joinRoom(room, 't-E', 'E');
    expect(fifth.ok).toBe(false);
    expect(seatOf(room, 't-E')).toBeNull();
  });

  it('reads back exactly what it stored', () => {
    const room = sat(newRoom(), 't-nora', 'Nora');
    expect(readRoom(JSON.stringify(room))).toEqual(room);
  });

  it('reads a room stored before the stall was kept (KUB-37) as one with none', () => {
    const room = sat(newRoom(), 't-nora', 'Nora');
    const before = { table: room.table, tokens: room.tokens };
    expect(readRoom(JSON.stringify(before))).toEqual({ ...room, stall: null });
  });

  it('keeps a bot’s seat with no token, between friends’ seats, and reads it back (KUB-36)', () => {
    const nora = sat(newRoom(), 't-nora', 'Nora');
    const withBot = addBot(nora.table, 0, 'medium', 'Erik');
    if (!withBot.ok) throw new Error('no bot');
    const room = sat({ ...nora, table: withBot.value }, 't-kit', 'Kit');
    expect(room.tokens).toEqual(['t-nora', null, 't-kit']);
    expect(seatOf(room, 't-kit')).toBe(2);
    expect(readRoom(JSON.stringify(room))).toEqual(room);
    // A room stored before bots could sit has none.
    const before = { table: { phase: 'seating', names: ['Nora'] }, tokens: nora.tokens };
    expect(readRoom(JSON.stringify(before))).toEqual(nora);
  });

  it('throws on a stored row that is not a room, rather than starting over on top of it', () => {
    expect(() => readRoom(JSON.stringify({ table: { phase: 'nonsense' }, tokens: [] }))).toThrow(
      /does not parse/,
    );
    expect(() => readRoom(42)).toThrow(/not text/);
  });
});

describe('who is here', () => {
  it('marks a seat here while any device holds it open', () => {
    const open = [
      { seat: 0, since: 0, heard: null },
      { seat: 2, since: 0, heard: null },
      { seat: 2, since: 5, heard: null },
    ];
    expect(presence(4, open)).toEqual([true, false, true, false]);
    expect(presence(0, open)).toEqual([]);
  });

  it('calls a socket stale once it has been quiet too long since it opened or last pinged', () => {
    const since = 1_000;
    expect(isStale(since + STALE_AFTER_MS, { seat: 0, since, heard: null })).toBe(false);
    expect(isStale(since + STALE_AFTER_MS + 1, { seat: 0, since, heard: null })).toBe(true);
    const heard = since + 60_000;
    expect(isStale(heard + STALE_AFTER_MS, { seat: 0, since, heard })).toBe(false);
    expect(isStale(heard + STALE_AFTER_MS + 1, { seat: 0, since, heard })).toBe(true);
  });
});
