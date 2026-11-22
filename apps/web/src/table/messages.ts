import type { Tile } from '@norikub/core/tiles';
import type { MoveRefusal, TurnFault } from '@norikub/core/turn';

import type { Note } from './session.ts';

export function tileName(tile: Tile): string {
  return tile.kind === 'joker' ? 'joker' : `${tile.colour} ${tile.value}`;
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
