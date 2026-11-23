import { LEVELS } from '@norikub/core/bot';
import type { Level } from '@norikub/core/bot';
import { z } from 'zod';

/**
 * Who a bot plays as (KUB-43): Nora's people and animals, drawn from photos she attached to the
 * ticket. A character is a face and a name and nothing else; the engine never sees who is who.
 *
 * The ids are in saved games, so one is never renamed; a new face is a new id at the end.
 */
export const CAST = [
  'tatum',
  'edward',
  'erik',
  'fuzzy',
  'michael',
  'asabo',
  'nora',
  'roscoe',
  'reilly',
] as const;
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
  roscoe: 'Roscoe',
  reilly: 'Reilly',
};

/**
 * Three characters to each level (Nora, 22 Nov 2026, on KUB-43): Michael is always hard and
 * Tatum always easy, so choosing who is choosing how hard (KUB-49). The order is the picker's,
 * and the order a game saved with only levels is given them in.
 */
export const ROSTER: Readonly<Record<Level, readonly [Who, Who, Who]>> = {
  easy: ['tatum', 'edward', 'roscoe'],
  medium: ['erik', 'fuzzy', 'asabo'],
  hard: ['michael', 'nora', 'reilly'],
};

/** The level a character plays at: the roster row it is in. */
export function levelOf(who: Who): Level {
  return LEVELS.find((level) => ROSTER[level].includes(who)) ?? 'medium';
}
