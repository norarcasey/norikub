import type { Game, Status } from '@norikub/core/game';
import type { Tile } from '@norikub/core/tiles';
import type { MoveRefusal, TurnFault } from '@norikub/core/turn';

import type { Frame } from './replay.ts';
import { PERSON } from './session.ts';
import type { Note } from './session.ts';

export function tileName(tile: Tile): string {
  return tile.kind === 'joker' ? 'joker' : `${tile.colour} ${tile.value}`;
}

export function splitText(tile: Tile): string {
  return `Let go to split the run and put the ${tileName(tile)} on the end of the first half.`;
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
    case 'bot':
      return note.played === 0
        ? `${note.name} drew a tile.`
        : `${note.name} played ${note.played} tile${note.played === 1 ? '' : 's'}.`;
  }
}

export function frameText(frame: Frame): string {
  switch (frame.step.kind) {
    case 'placed':
      return `${frame.name} plays the ${tileName(frame.step.tile)}.`;
    case 'drawing':
      return frame.seat === PERSON ? 'You draw a tile.' : `${frame.name} draws a tile.`;
    case 'drew':
      return frame.step.face === null
        ? `${frame.name} drew a tile.`
        : `You drew the ${tileName(frame.step.face)}.`;
    case 'passed':
      return frame.seat === PERSON
        ? 'The pool is empty, so you passed.'
        : `The pool is empty, so ${frame.name} passed.`;
    case 'done':
      return `${frame.name} played ${frame.step.played} tile${frame.step.played === 1 ? '' : 's'}.`;
  }
}

type Over = Extract<Status, { kind: 'over' }>;

export function winnerText(game: Game, over: Over): string {
  return over.winner === PERSON ? 'You won.' : `${game.players[over.winner]?.name ?? 'A bot'} won.`;
}

export function overText(over: Over): string {
  switch (over.reason) {
    case 'rack-emptied':
      return over.winner === PERSON ? 'You played your last tile.' : 'They played their last tile.';
    case 'pool-exhausted':
      return 'The pool ran out and nobody could play, so the lowest rack wins.';
  }
}
