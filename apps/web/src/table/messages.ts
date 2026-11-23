import type { Status } from '@norikub/core/game';
import type { MatchFormat, Standing } from '@norikub/core/match';
import type { Placement, SetShape, TurnSummary } from '@norikub/core/summary';
import type { Refusal, TableRefusal } from '@norikub/core/table';
import type { Tile } from '@norikub/core/tiles';
import type { MoveRefusal, TurnFault } from '@norikub/core/turn';

import type { Frame } from './replay.ts';
import { botNames } from './session.ts';
import type { Note, Setup } from './session.ts';

export function tileName(tile: Tile): string {
  return tile.kind === 'joker' ? 'joker' : `${tile.colour} ${tile.value}`;
}

export function splitText(tile: Tile): string {
  return `Let go to split the run and put the ${tileName(tile)} on the end of the first half.`;
}

export function pickedText(count: number): string {
  return `${count} tiles picked. Tap New set, a set, or a place in your rack to put them there.`;
}

export function refusalText(refusal: MoveRefusal): string {
  switch (refusal.kind) {
    case 'table-tile-to-rack':
      return 'That tile was on the table when your turn began, so it stays on the table.';
    case 'table-joker-to-rack':
      return 'A joker taken from the table must be played again this turn. It cannot go to your rack.';
    case 'no-such-tile':
    case 'no-such-set':
      return 'That move is not possible.';
  }
}

export function faultText(fault: TurnFault): string {
  switch (fault.kind) {
    case 'game-over':
      return 'The game is over.';
    case 'nothing-played':
      return 'Play at least one tile from your rack, or draw.';
    case 'invalid-set':
      return `Set ${fault.set + 1} is not a run or a group yet.`;
    case 'table-touched-before-first-meld':
      return 'Before your first meld, leave the sets already on the table as they were.';
    case 'first-meld-under-30':
      return `Your first meld counts ${fault.points} points. It needs 30.`;
  }
}

export function noteText(note: Note): string {
  switch (note.kind) {
    case 'refused':
      return refusalText(note.refusal);
    case 'fault':
      return faultText(note.fault);
    case 'drew':
      return note.tile === null
        ? 'The pool is empty, so you passed.'
        : `You drew the ${tileName(note.tile)}.`;
    case 'played':
      return turnText(note.name, note.summary);
    case 'host':
      return hostRefusalText(note.refusal);
  }
}

/** What a friends' table's host refused, in words. A move or a fault reads as against the bots. */
export function hostRefusalText(refusal: Refusal): string {
  switch (refusal.kind) {
    case 'not-a-message':
      return 'The table did not understand that. Reload to catch up.';
    case 'table':
      return tableRefusalText(refusal.refusal);
    case 'move':
      return refusalText(refusal.refusal);
    case 'end-turn':
      return refusal.faults.map(faultText).join(' ');
    case 'draw':
      return refusal.refusal === 'game-over'
        ? 'The game is over.'
        : 'That tile has already been drawn. Pick another.';
  }
}

export function tableRefusalText(refusal: TableRefusal): string {
  switch (refusal.kind) {
    case 'table-full':
      return 'This table is full: four players have sat down.';
    case 'already-dealt':
      return 'The game at this table has already been dealt.';
    case 'not-dealt':
      return 'The tiles have not been dealt yet.';
    case 'waiting-for-players':
      return 'Wait for at least one more player to sit down.';
    case 'only-the-first-seat-deals':
      return 'The first player to sit down deals.';
    case 'only-the-first-seat-adds-bots':
      return 'The first player to sit down adds the bots.';
    case 'no-such-seat':
      return 'You have no seat at this table.';
    case 'not-your-turn':
      return 'It is not your turn.';
    case 'game-over':
      return 'The game is over.';
    case 'cancelled':
      return 'This table has been cancelled.';
    case 'no-away-turn':
      return 'There is nobody away to draw for now.';
  }
}

/** `you` is the seat this screen plays from: 0 against the bots, any seat at a friends' table. */
export function frameText(frame: Frame, you: number): string {
  switch (frame.step.kind) {
    case 'placed':
      return turnText(frame.name, frame.step.summary);
    case 'drawing':
      return frame.seat === you ? 'You draw a tile.' : `${frame.name} draws a tile.`;
    case 'drew':
      return frame.step.face === null
        ? `${frame.name} drew a tile.`
        : `You drew the ${tileName(frame.step.face)}.`;
    case 'passed':
      return frame.seat === you
        ? 'The pool is empty, so you passed.'
        : `The pool is empty, so ${frame.name} passed.`;
    case 'done':
      return turnText(frame.name, frame.step.summary);
  }
}

// Past two sets the sentence no longer fits the status line, and the table shows the rest.
const NAMED_PLACEMENTS = 2;
// "the red 4, red 5 and red 6" still reads; a fourth tile is better counted.
const NAMED_TILES = 3;

/**
 * Another player's turn as its result (KUB-51): "Tatum laid down red 4–6 and added the orange
 * 9 to orange 9–12." Sets laid down come before sets added to, the way a person would tell
 * it. A turn that played nothing drew.
 *
 * Short on purpose: the status line is two lines tall, and on a 390 px phone, measured in the
 * dev build at 15 px system-ui, it is about 275 px wide beside Skip, so 520 px of text. "a run
 * of red 4 to 6 and added the orange 9 to a run of orange 9 to 12" measured 571 px; the
 * wording here, 432.
 */
export function turnText(name: string, summary: TurnSummary): string {
  const { placements, reworked } = summary;
  if (placements.length === 0) return `${name} drew a tile.`;
  const clauses =
    placements.length <= NAMED_PLACEMENTS
      ? [...placements].sort((a, b) => Number(b.fresh) - Number(a.fresh)).map(placementText)
      : [`played ${tileCount(placements)} tiles into ${placements.length} sets`];
  const rework = reworked > 0 ? [`reworked ${reworked} set${reworked === 1 ? '' : 's'}`] : [];
  return `${name} ${listed([...rework, ...clauses])}.`;
}

function placementText(placement: Placement): string {
  const { into, tiles } = placement;
  if (placement.fresh) {
    return `laid down ${into.kind === 'group' ? groupText(into) : shapeText(into)}`;
  }
  const what =
    tiles.length <= NAMED_TILES ? `the ${listed(tiles.map(tileName))}` : `${tiles.length} tiles`;
  return `added ${what} to ${shapeText(into)}`;
}

/** A set as it is added to: "orange 9–12", "the 7s". */
export function shapeText(shape: SetShape): string {
  switch (shape.kind) {
    case 'run':
      return `${shape.colour} ${shape.low}–${shape.high}`;
    case 'group':
      return `the ${shape.value}s`;
    case 'other':
      return 'a set';
  }
}

/** A group as it is laid down: "three 7s". */
function groupText(group: Extract<SetShape, { kind: 'group' }>): string {
  return `${group.size === 4 ? 'four' : 'three'} ${group.value}s`;
}

function tileCount(placements: readonly Placement[]): number {
  return placements.reduce((sum, placement) => sum + placement.tiles.length, 0);
}

type Over = Extract<Status, { kind: 'over' }>;

export function winnerText(names: readonly string[], over: Over, you: number): string {
  return over.winner === you ? 'You won.' : `${names[over.winner] ?? 'Another player'} won.`;
}

export function overText(over: Over, you: number): string {
  switch (over.reason) {
    case 'rack-emptied':
      return over.winner === you ? 'You played your last tile.' : 'They played their last tile.';
    case 'pool-exhausted':
      return 'The pool ran out and nobody could play, so the lowest rack wins.';
  }
}

/** How long a sitting lasts, as the setup and Play now say it (KUB-42). */
export function formatText(format: MatchFormat): string {
  switch (format.kind) {
    case 'single':
      return 'one game';
    case 'games':
      return `${format.games} games`;
    case 'points':
      return `first to ${format.target} points`;
  }
}

/** What Play now will deal: "Against Tatum (medium) and Edward (hard), one game." */
export function setupText(setup: Setup): string {
  const names = botNames(setup.lineup).map(
    (name, i) => `${name} (${setup.lineup[i]?.level ?? 'medium'})`,
  );
  return `Against ${listed(names)}, ${formatText(setup.format)}.`;
}

/** The game bar's word on the match, or null for a game on its own. */
export function matchLine(format: MatchFormat, standing: Standing): string | null {
  switch (format.kind) {
    case 'single':
      return null;
    case 'games':
      return `Game ${standing.game} of ${format.games}`;
    case 'points':
      return `Game ${standing.game}, to ${format.target}`;
  }
}

/** Under a finished game's scores: where the match stands, or who took it. */
export function standingText(
  format: MatchFormat,
  standing: Standing,
  names: readonly string[],
  you: number,
): string {
  if (standing.over) {
    const [only, ...others] = standing.leaders;
    if (only !== undefined && others.length === 0) {
      return only === you ? 'You won the match.' : `${names[only] ?? ''} won the match.`;
    }
    const who = standing.leaders.map((seat) => (seat === you ? 'you' : (names[seat] ?? '')));
    return `The match is shared by ${listed(who)}.`;
  }
  switch (format.kind) {
    case 'single':
    case 'games':
      return `After game ${standing.game} of ${format.kind === 'games' ? format.games : 1}.`;
    case 'points':
      return `After game ${standing.game}. The first to ${format.target} points takes the match.`;
  }
}

/** "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  const last = names.at(-1) ?? '';
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${last}` : last;
}
