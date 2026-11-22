import { describe, expect, it } from 'vitest';

import { edgeSpeed } from './drag.ts';

const table = { top: 100, bottom: 500, left: 0, right: 400 };

describe('scrolling under a held tile', () => {
  it('is still away from the edges', () => {
    expect(edgeSpeed(table, 200, 300)).toBe(0);
  });

  it('goes up near the top, faster nearer it, and fastest above it', () => {
    const near = edgeSpeed(table, 200, 140);
    const nearer = edgeSpeed(table, 200, 110);
    expect(near).toBeLessThan(0);
    expect(nearer).toBeLessThan(near);
    expect(edgeSpeed(table, 200, 40)).toBe(edgeSpeed(table, 200, 0));
  });

  it('goes down near the bottom, but not below it, where the rack is', () => {
    expect(edgeSpeed(table, 200, 490)).toBeGreaterThan(0);
    expect(edgeSpeed(table, 200, 520)).toBe(0);
  });

  it('only over its own columns', () => {
    expect(edgeSpeed(table, 450, 110)).toBe(0);
  });

  it('keeps a still middle in an area too short for two full edges', () => {
    const short = { top: 100, bottom: 160, left: 0, right: 400 };
    expect(edgeSpeed(short, 200, 130)).toBe(0);
    expect(edgeSpeed({ ...short, bottom: 100 }, 200, 100)).toBe(0);
  });
});
