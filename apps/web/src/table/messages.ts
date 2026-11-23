import type { Status } from '@norikub/core/game';
import type { Refusal, TableRefusal } from '@norikub/core/table';
import type { Tile } from '@norikub/core/tiles';
import type { MoveRefusal, TurnFault } from '@norikub/core/turn';

import type { Frame } from './replay.ts';
import type { Note } from './session.ts';

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
      return note.played === 0
        ? `${note.name} drew a tile.`
        : `${note.name} played ${note.played} tile${note.played === 1 ? '' : 's'}.`;
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
    case 'no-such-seat':
      return 'You have no seat at this table.';
    case 'not-your-turn':
      return 'It is not your turn.';
    case 'game-over':
      return 'The game is over.';
  }
}

/** `you` is the seat this screen plays from: 0 against the bots, any seat at a friends' table. */
export function frameText(frame: Frame, you: number): string {
  switch (frame.step.kind) {
    case 'placed':
      return `${frame.name} plays the ${tileName(frame.step.tile)}.`;
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
      return `${frame.name} played ${frame.step.played} tile${frame.step.played === 1 ? '' : 's'}.`;
  }
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
