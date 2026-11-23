import { describe, expect, it } from 'vitest';

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

  it('throws on a stored row that is not a room, rather than starting over on top of it', () => {
    expect(() => readRoom(JSON.stringify({ table: { phase: 'nonsense' }, tokens: [] }))).toThrow(
      /does not parse/,
    );
    expect(() => readRoom(42)).toThrow(/not text/);
  });
});
