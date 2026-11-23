import { z } from 'zod';

/**
 * Who a bot plays as (KUB-43): Nora's people and dogs, drawn from photos she attached to the
 * ticket. A character is a face and a name and nothing else. How a bot plays is its level, picked
 * separately, so Tatum can be hard and Michael easy; the engine never sees who is who.
 *
 * The order is the order the picker shows them, and the order a seat is given one by default.
 * The ids are in saved games, so one is never renamed; a new face is a new id at the end.
 */
export const CAST = ['tatum', 'edward', 'erik', 'fuzzy', 'michael', 'asabo', 'nora'] as const;
export const whoSchema = z.enum(CAST);
export type Who = z.infer<typeof whoSchema>;

export const CAST_NAMES: Readonly<Record<Who, string>> = {
  tatum: 'Tatum',
  edward: 'Edward',
  erik: 'Erik',
  fuzzy: 'Cowthey Fuzzy',
  michael: 'Michael',
  asabo: 'Asa & Bo',
  nora: 'Lumber Jill Nora',
};

/** The first of the cast no seat in `taken` already has: two seats never share a face. */
export function firstFree(taken: readonly Who[]): Who {
  return CAST.find((who) => !taken.includes(who)) ?? 'tatum';
}
