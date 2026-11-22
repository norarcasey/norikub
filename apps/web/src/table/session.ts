import { takeBotTurn } from '@norikub/core/bot';
import { newGame } from '@norikub/core/game';
import type { Game } from '@norikub/core/game';
import type { Tile } from '@norikub/core/tiles';
import { drawInstead, endTurn, move, startTurn, takeBack } from '@norikub/core/turn';
import type { Move, MoveRefusal, Turn, TurnFault } from '@norikub/core/turn';

/** The seat the person plays from; the other seats are bots. */
export const PERSON = 0;

/**
 * What the person is told after an action. Every one of these carries what the engine said,
 * not a judgement of the screen's own (invariant 1): a refusal, a fault, a draw or a bot's
 * turn.
 */
export type Note =
  | { readonly kind: 'refused'; readonly refusal: MoveRefusal }
  | { readonly kind: 'fault'; readonly fault: TurnFault }
  | { readonly kind: 'drew'; readonly tile: Tile | null }
  | { readonly kind: 'bot'; readonly name: string; readonly played: number };

/**
 * The screen's whole state: the game, the person's turn in progress over it (none once the
 * game is over), and what to tell them. Saving it across a reload is KUB-6's, not this.
 */
export type Session = {
  readonly game: Game;
  readonly turn: Turn | null;
  readonly notes: readonly Note[];
};

export function newSession(seed: number): Session {
  return fromGame(newGame({ names: ['You', 'Bot A', 'Bot B'], seed }), []);
}

/** A session at the person's turn, after any bots due before it have played. */
export function fromGame(game: Game, notes: readonly Note[]): Session {
  const played = playBots(game);
  const turn = played.game.status.kind === 'playing' ? startTurn(played.game) : null;
  return { game: played.game, turn, notes: [...notes, ...played.notes] };
}

/** The bots take their turns, instantly, until it is the person's turn or the game is over. */
function playBots(game: Game): { game: Game; notes: Note[] } {
  const notes: Note[] = [];
  let current = game;
  while (current.status.kind === 'playing' && current.current !== PERSON) {
    const seat = current.current;
    const before = current.players[seat]?.rack.length ?? 0;
    const next = takeBotTurn(current).game;
    const after = next.players[seat]?.rack.length ?? 0;
    // A bot that draws ends with one tile more, and has played none.
    const played = Math.max(0, before - after);
    notes.push({ kind: 'bot', name: current.players[seat]?.name ?? '', played });
    current = next;
  }
  return { game: current, notes };
}

/** What the engine would say to a move, without making it: used while a tile is dragged. */
export function probe(session: Session, m: Move): MoveRefusal | null {
  if (session.turn === null) return null;
  const result = move(session.turn, m);
  return result.ok ? null : result.refusal;
}

/** A refused move leaves the turn exactly as it was; the tile goes back where it came from. */
export function moveTile(session: Session, m: Move): Session {
  if (session.turn === null) return session;
  const result = move(session.turn, m);
  if (!result.ok) return { ...session, notes: [{ kind: 'refused', refusal: result.refusal }] };
  return { ...session, turn: result.turn, notes: [] };
}

export function finishTurn(session: Session): Session {
  if (session.turn === null) return session;
  const result = endTurn(session.turn);
  if (!result.ok) {
    return { ...session, notes: result.faults.map((fault): Note => ({ kind: 'fault', fault })) };
  }
  return fromGame(result.game, []);
}

export function undoTurn(session: Session): Session {
  if (session.turn === null) return session;
  return { ...session, turn: takeBack(session.turn), notes: [] };
}

export function drawTile(session: Session): Session {
  if (session.turn === null) return session;
  const result = drawInstead(session.turn);
  if (!result.ok) return session;
  return fromGame(result.game, [{ kind: 'drew', tile: result.drawn }]);
}
