import { describe, expect, it } from 'vitest';

import { parse } from './parse.ts';
import {
  joinRequestSchema,
  joinResponseSchema,
  tableClientMessageSchema,
  tableCodeSchema,
  tableMessageSchema,
} from './protocol.ts';
import { apply, deal, newTable, sitDown, tableViewFor } from './table.ts';
import type { Table } from './table.ts';

function table(): Table {
  const one = sitDown(newTable(), 'Nora');
  const two = one.ok ? sitDown(one.value.table, 'Ana') : one;
  const dealt = two.ok ? deal(two.value.table, 0, 11) : two;
  if (!dealt.ok) throw new Error('could not deal');
  return dealt.value;
}

describe('what a page sends', () => {
  it('takes every message a seat can send', () => {
    for (const message of [
      { type: 'deal' },
      { type: 'move', move: { kind: 'onto-set', tileId: 'red-1-a', set: 2 } },
      { type: 'take-back' },
      { type: 'end-turn' },
      { type: 'draw', pick: 4 },
      { type: 'draw', pick: null },
    ]) {
      expect(parse(tableClientMessageSchema, message)).toEqual({ ok: true, value: message });
    }
    expect(parse(joinRequestSchema, { name: '  Nora ' })).toEqual({
      ok: true,
      value: { name: 'Nora' },
    });
  });

  it('refuses what no page of ours sends', () => {
    for (const junk of [
      { type: 'sit-down', name: 'Nora' },
      { type: 'move', move: { kind: 'to-set', tileId: 'red-1-a', set: -1 } },
      { type: 'move', move: { kind: 'swap', tileId: 'red-1-a' } },
      { type: 'draw', pick: 1.5 },
      { type: 'draw' },
      'ping',
    ]) {
      expect(parse(tableClientMessageSchema, junk).ok).toBe(false);
    }
    expect(parse(joinRequestSchema, { name: 'a\u0007b' }).ok).toBe(false);
    expect(parse(tableCodeSchema, 'Ab12').ok).toBe(false);
    expect(parse(tableCodeSchema, 'ab12').ok).toBe(true);
    expect(parse(joinResponseSchema, { seat: 0, token: 'short' }).ok).toBe(false);
  });
});

describe('what the host sends', () => {
  it('parses every view, refusal and draw the table produces', () => {
    const t = table();
    const seat = t.phase === 'playing' ? t.game.current : 0;
    const messages: unknown[] = [
      { type: 'view', table: tableViewFor(newTable(), 0) },
      { type: 'view', table: tableViewFor(t, 0) },
      { type: 'view', table: tableViewFor(t, 1) },
      { type: 'presence', here: [true, false] },
      { type: 'refused', refusal: { kind: 'not-a-message' } },
      { type: 'bot-turn', seat: 1, moves: [{ kind: 'to-new-set', tileId: 'red-1-a' }] },
    ];
    for (const result of [
      apply(t, 1 - seat, { type: 'end-turn' }),
      apply(t, seat, { type: 'end-turn' }),
      apply(t, seat, { type: 'move', move: { kind: 'to-rack', tileId: 'nope' } }),
      apply(t, seat, { type: 'draw', pick: 999 }),
    ]) {
      if (!result.ok) messages.push({ type: 'refused', refusal: result.refusal });
    }
    const drew = apply(t, seat, { type: 'draw', pick: 0 });
    if (drew.ok && drew.value.drew !== null) messages.push({ type: 'drew', ...drew.value.drew });
    expect(messages).toHaveLength(11);
    for (const message of messages) {
      expect(parse(tableMessageSchema, message)).toEqual({ ok: true, value: message });
    }
  });
});
