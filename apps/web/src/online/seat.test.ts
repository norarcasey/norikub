import { describe, expect, it } from 'vitest';

import { tableCodeSchema } from '../../../../packages/core/src/protocol.ts';
import {
  CODE_LENGTH,
  forgetSeat,
  isTablePath,
  keepSeat,
  keptSeat,
  newTableCode,
  tableCodeOf,
} from './seat.ts';

describe('a table’s code', () => {
  it('is one the host accepts, of letters that cannot be misread', () => {
    for (let i = 0; i < 50; i++) {
      const code = newTableCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(tableCodeSchema.safeParse(code).success).toBe(true);
      expect(code).not.toMatch(/[01ilo]/);
    }
  });

  it('throws away the bytes that would favour the first letters', () => {
    // 248 and above would fold onto a–h; only the bytes under it are used.
    let calls = 0;
    const code = newTableCode((n) => {
      calls++;
      return Uint8Array.from({ length: n }, (_, i) => (calls === 1 && i % 2 === 0 ? 250 : i));
    });
    expect(code).toHaveLength(CODE_LENGTH);
    expect(code.startsWith('b')).toBe(true);
  });

  it('is read from a table’s path, and from nothing else', () => {
    expect(tableCodeOf('/t/abcd2345efgh')).toBe('abcd2345efgh');
    expect(tableCodeOf('/t/ABCD2345efgh/')).toBe('abcd2345efgh');
    expect(tableCodeOf('/t/ab')).toBeNull();
    expect(tableCodeOf('/t/abc-def')).toBeNull();
    expect(tableCodeOf('/')).toBeNull();
    expect(isTablePath('/t/ab')).toBe(true);
    expect(isTablePath('/t')).toBe(true);
    expect(isTablePath('/tables')).toBe(false);
  });
});

describe('the seat kept on this device', () => {
  const seat = { token: 'a'.repeat(32), seat: 1, rows: null, startRows: null };

  it('is kept under the table’s code and forgotten again', () => {
    keepSeat('abcd2345efgh', seat);
    expect(keptSeat('abcd2345efgh')).toEqual(seat);
    expect(keptSeat('other2345efgh')).toBeNull();
    forgetSeat('abcd2345efgh');
    expect(keptSeat('abcd2345efgh')).toBeNull();
  });

  it('is no seat when storage holds something else or refuses', () => {
    localStorage.setItem('norikub.table.abcd2345efgh', '{"token":1}');
    expect(keptSeat('abcd2345efgh')).toBeNull();
    const refusing: Storage = {
      ...localStorage,
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(keptSeat('abcd2345efgh', refusing)).toBeNull();
    expect(() => keepSeat('abcd2345efgh', seat, refusing)).not.toThrow();
    expect(() => forgetSeat('abcd2345efgh', refusing)).not.toThrow();
  });
});
