import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, PointerEvent as ReactPointerEvent } from 'react';

import { arrangeSet, judgeSet, splitFor } from '@norikub/core/sets';
import type { Game, Status } from '@norikub/core/game';
import { rackPenalty } from '@norikub/core/tiles';
import type { Tile } from '@norikub/core/tiles';

import { dropAttribute, ghostTransform, toMove, useDrag } from './drag.ts';
import type { Drag, DropTarget } from './drag.ts';
import {
  frameText,
  noteText,
  overText,
  pickedText,
  refusalText,
  splitText,
  tileName,
  winnerText,
} from './messages.ts';
import { fitPile, pileSpot } from './pile.ts';
import { FLIGHT_MS, usePlayback } from './playback.ts';
import { PERSON, drawTile, finishTurn, moveTile, moveTiles, probe, undoTurn } from './session.ts';
import type { Session } from './session.ts';
import './table.css';

type TileEvents = {
  readonly onPointerDown: (
    tileId: string,
    event: ReactPointerEvent<HTMLElement>,
    scrolls: boolean,
  ) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
  readonly onTap: (tileId: string) => void;
};

// A shape beside each colour, so the tiles can be told apart without telling the colours
// apart.
const MARKS = { red: '●', blue: '■', orange: '▲', black: '◆' } as const;

function TileFace({ tile }: { tile: Tile }) {
  if (tile.kind === 'joker') {
    return (
      <>
        <span className="tile-value">★</span>
        <span className="tile-mark">joker</span>
      </>
    );
  }
  return (
    <>
      <span className="tile-value">{tile.value}</span>
      <span className="tile-mark" aria-hidden="true">
        {MARKS[tile.colour]}
      </span>
    </>
  );
}

function TileButton({ tile, events, lifted, selected, fresh, arriving, scrolls }: TileProps) {
  return (
    <button
      type="button"
      className="tile"
      data-tile={tile.id}
      data-colour={tile.kind === 'joker' ? 'joker' : tile.colour}
      data-lifted={lifted || undefined}
      data-arriving={arriving || undefined}
      data-selected={selected || undefined}
      data-fresh={fresh || undefined}
      data-scrolls={scrolls || undefined}
      aria-label={tileName(tile)}
      aria-pressed={selected}
      onPointerDown={(event) => events.onPointerDown(tile.id, event, scrolls)}
      onPointerMove={events.onPointerMove}
      onPointerUp={events.onPointerUp}
      onPointerCancel={events.onPointerCancel}
      onClick={(event) => {
        event.stopPropagation();
        events.onTap(tile.id);
      }}
    >
      <TileFace tile={tile} />
    </button>
  );
}

function sameTarget(a: DropTarget | null, b: DropTarget): boolean {
  return a !== null && dropAttribute(a) === dropAttribute(b);
}

type TileProps = {
  tile: Tile;
  events: TileEvents;
  lifted: boolean;
  selected: boolean;
  fresh: boolean;
  arriving: boolean;
  /** On the table, which a finger scrolls: a touch lifts the tile by resting on it (KUB-27). */
  scrolls: boolean;
};

/**
 * One row of the rack, as slots. Every slot is its own drop target, empty or not, so a tile
 * lands in exactly the slot under the finger and columns line up across the rows. The slots
 * touch, with the spacing inside them, so there is no gap between two where a drop finds
 * nothing.
 */
function RackRow({
  row,
  slots,
  byId,
  zoneOf,
  tileProps,
  onTap,
}: {
  row: number;
  slots: readonly (string | null)[];
  byId: ReadonlyMap<string, Tile>;
  zoneOf: (target: DropTarget) => string | undefined;
  tileProps: (tile: Tile) => TileProps;
  onTap: (target: DropTarget) => () => void;
}) {
  return (
    <div
      className="rack-row"
      role="group"
      aria-label={`Rack row ${row + 1}`}
      // Every row has the same slots, so a column is one width all the way down. A slot is at
      // most a tile wide and shrinks with the screen, so a rack that has grown still fits.
      style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 48px))` }}
    >
      {slots.map((id, col) => {
        const target: DropTarget = { kind: 'rack', row, col };
        const tile = id === null ? undefined : byId.get(id);
        return (
          <div
            key={col}
            className="rack-slot"
            data-drop={dropAttribute(target)}
            data-zone={zoneOf(target)}
            onClick={onTap(target)}
          >
            {tile !== undefined && <TileButton {...tileProps(tile)} />}
          </div>
        );
      })}
    </div>
  );
}

type Over = Extract<Status, { kind: 'over' }>;

/**
 * The end of the game: who won, why it ended, and what each rack cost. Every number is the
 * engine's (`finish`); the points left are shown beside the score so a reader can see where
 * the score came from. Highest score first, the winner always at the top.
 */
function ScoreScreen({ game, over, onNewGame }: { game: Game; over: Over; onNewGame: () => void }) {
  const rows = game.players
    .map((player, seat) => ({
      seat,
      name: seat === PERSON ? 'You' : player.name,
      tiles: player.rack.length,
      left: rackPenalty(player.rack),
      score: over.scores[seat] ?? 0,
    }))
    .sort((a, b) => (a.seat === over.winner ? -1 : b.seat === over.winner ? 1 : b.score - a.score));
  return (
    <section className="scores" aria-label="Scores">
      <h2>{winnerText(game, over)}</h2>
      <p>{overText(over)}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Tiles left</th>
            <th scope="col">Points left</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.seat} data-winner={row.seat === over.winner || undefined}>
              <th scope="row">{row.name}</th>
              <td>{row.tiles}</td>
              <td>{row.left}</td>
              <td>{row.score > 0 ? `+${row.score}` : row.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="primary" onClick={onNewGame}>
        New game
      </button>
    </section>
  );
}

export function GameScreen({
  session,
  onChange,
  onNewGame,
}: {
  session: Session;
  onChange: (next: Session) => void;
  onNewGame: () => void;
}) {
  const { game, turn, notes, rows } = session;
  // The tiles tapped, in the order tapped: one to move like a drop, or several to send
  // somewhere together (KUB-2).
  const [selected, setSelected] = useState<readonly string[]>([]);
  // While a bot's turn plays back, the screen shows the frame and takes no moves: the game
  // underneath is already at the person's turn, and a move made now would be made on a table
  // they cannot see.
  const playback = usePlayback(session.replay);
  const watching = playback.frame;

  const place = useCallback(
    (tileId: string, target: DropTarget) => {
      setSelected([]);
      const spot = target.kind === 'rack' ? { row: target.row, col: target.col } : undefined;
      onChange(moveTile(session, toMove(tileId, target), spot));
    },
    [session, onChange],
  );

  const drag = useDrag({ onDrop: place });
  const table = watching?.table ?? turn?.table ?? game.table;

  const send = (target: DropTarget) => {
    setSelected([]);
    onChange(moveTiles(session, selected, target));
  };
  // A turn's buttons and a draw let the picked tiles go: they were picked for the table as it
  // was, and a take-back or a new turn has put them somewhere else.
  const act = (next: Session) => {
    setSelected([]);
    onChange(next);
  };

  const live: TileEvents = {
    onPointerDown: drag.onPointerDown,
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.onPointerUp,
    onPointerCancel: drag.onPointerCancel,
    // A tap on a tile picks it, or lets it go again. With tiles picked, a tap on a tile of
    // another set plays them on that set: a full set is nearly all tiles, and its own few
    // pixels of edge were the only place a tap could reach it (Nora, 22 Nov 2026). A tile of a
    // set the picked tiles come from is picked too, so tiles can be gathered from one set.
    onTap: (tileId) => {
      if (drag.swallowClick()) return;
      if (selected.includes(tileId)) {
        setSelected(selected.filter((id) => id !== tileId));
        return;
      }
      const set = table.findIndex((tiles) => tiles.some((tile) => tile.id === tileId));
      const pickedHere = table[set]?.some((tile) => selected.includes(tile.id)) ?? false;
      if (set !== -1 && selected.length > 0 && !pickedHere) send({ kind: 'set', set });
      else setSelected([...selected, tileId]);
    },
  };
  const events = watching === null ? live : INERT;

  // Tap tiles, then tap where they go: the same moves as a drag, for a keyboard or a hand
  // that would rather not drag, and the one way to play several tiles at once.
  const tapTarget = (target: DropTarget) => () => {
    if (watching === null && selected.length > 0) send(target);
  };

  // While a tile is in flight the engine is asked what it would say to letting go here, so a
  // refusal shows before the drop and not after it (invariant 1: asked, not decided).
  const hovering = drag.drag?.target ?? null;
  const refusal =
    drag.drag !== null && hovering !== null
      ? probe(session, toMove(drag.drag.tileId, hovering))
      : null;

  const zoneState = (target: DropTarget) =>
    sameTarget(hovering, target)
      ? refusal !== null
        ? 'refused'
        : split !== null
          ? 'split'
          : 'over'
      : undefined;

  const startIds = new Set(turn?.start.table.flat().map((tile) => tile.id) ?? []);
  const invalid = new Set(
    notes.flatMap((note) =>
      note.kind === 'fault' && note.fault.kind === 'invalid-set' ? [note.fault.set] : [],
    ),
  );
  const rack = turn?.rack ?? game.players[PERSON]?.rack ?? [];
  const byId = new Map(rack.map((tile) => [tile.id, tile]));
  const lifted = drag.drag?.tileId ?? null;
  // Held over a run it would split, the engine says where (`splitFor`), and the set shows the
  // cut before the drop (KUB-23).
  const held = drag.drag === null ? undefined : findTile(drag.drag, rack, table);
  const split =
    held !== undefined && hovering?.kind === 'set' && refusal === null
      ? splitFor(
          (table[hovering.set] ?? []).filter((tile) => tile.id !== held.id),
          held,
        )
      : null;
  // A tile on the table that was not there when the turn began came from the rack this turn.
  const tileProps = (tile: Tile, onTable: boolean): TileProps => ({
    tile,
    events,
    lifted: tile.id === lifted,
    selected: selected.includes(tile.id),
    fresh:
      watching === null
        ? onTable && turn !== null && !startIds.has(tile.id)
        : (watching.step.kind === 'placed' && watching.step.tile.id === tile.id) ||
          (watching.step.kind === 'drew' && watching.step.face?.id === tile.id),
    // The person's drawn tile is already in the rack; it stays out of sight until its flight
    // lands there.
    arriving: watching?.step.kind === 'drawing' && watching.step.face?.id === tile.id,
    scrolls: onTable,
  });
  const pile = watching?.pile ?? fitPile(session.pile, game.pool.length);
  const poolCount = pile.length;
  const flyingFrom = watching?.step.kind === 'drawing' ? watching.step.pick : null;

  const opponents = game.players.flatMap((player, seat) =>
    seat === PERSON
      ? []
      : [
          {
            seat,
            name: player.name,
            count: watching?.counts[seat] ?? player.rack.length,
            playing: watching?.seat === seat,
          },
        ],
  );
  const status = game.status;

  return (
    <div className="game">
      <header className="game-bar">
        <ul className="opponents" aria-label="Opponents">
          {opponents.map((o) => (
            <li key={o.seat} data-seat={o.seat} data-playing={o.playing || undefined}>
              {o.name}: {o.count} tiles
            </li>
          ))}
        </ul>
        <span>Pool: {poolCount}</span>
      </header>

      <section className="table" aria-label="Table" data-autoscroll>
        {table.map((set, index) => {
          const target: DropTarget = { kind: 'set', set: index };
          const verdict = judgeSet(set);
          return (
            <div
              key={index}
              className="set"
              role="group"
              aria-label={`Set ${index + 1}`}
              data-drop={dropAttribute(target)}
              data-zone={zoneState(target)}
              data-valid={verdict.valid || undefined}
              data-faulted={invalid.has(index) || undefined}
              onClick={tapTarget(target)}
            >
              {withCut(
                arrangeSet(set).map((tile) => ({
                  id: tile.id,
                  node: <TileButton key={tile.id} {...tileProps(tile, true)} />,
                })),
                hovering?.kind === 'set' && hovering.set === index ? (split?.at ?? null) : null,
                lifted,
              )}
            </div>
          );
        })}
        {turn !== null && watching === null && (
          <div
            className="set new-set"
            role="button"
            tabIndex={-1}
            data-drop="new-set"
            data-zone={zoneState({ kind: 'new-set' })}
            onClick={tapTarget({ kind: 'new-set' })}
          >
            New set
          </div>
        )}
      </section>

      {(watching !== null || status.kind === 'playing') && poolCount > 0 && (
        // Face down, as at a real table: the buttons carry their place in the pool and nothing
        // else, so the page itself never says what a tile is before it is drawn. It stays on
        // screen while a turn plays back, as the place a drawn tile leaves from, but takes no
        // pick then. Each lies at its own spot in a scattered pile, keyed by the spot, so a
        // draw takes one tile away and leaves the rest where they lie (KUB-25).
        <section className="pool" aria-label="Face-down tiles: pick one to draw">
          {pile.map((spot, pick) => {
            const { x, y, turn: angle } = pileSpot(spot);
            return (
              <button
                key={spot}
                type="button"
                className="face-down"
                aria-label="Face-down tile"
                aria-disabled={watching !== null || undefined}
                data-pick={pick}
                data-lifted={pick === flyingFrom || undefined}
                style={{
                  left: `calc(${x.toFixed(4)} * (100% - var(--back-w)))`,
                  top: `calc(${y.toFixed(4)} * (100% - var(--back-h)))`,
                  transform: `rotate(${angle}deg)`,
                }}
                onClick={() => {
                  if (watching === null) act(drawTile(session, pick));
                }}
              />
            );
          })}
        </section>
      )}

      {watching?.step.kind === 'drawing' && (
        <Flight
          key={playback.index}
          pick={watching.step.pick}
          to={
            watching.step.face === null
              ? `[data-seat="${watching.seat}"]`
              : `.rack [data-tile="${watching.step.face.id}"]`
          }
          face={watching.step.face}
        />
      )}

      {/* The status line and the actions share a row, so the buttons cost the table and the
          rack no room of their own (KUB-24). End turn comes last, where the thumb is. */}
      <div className="turn-bar">
        <p className="notes" role="status">
          {watching !== null
            ? frameText(watching)
            : drag.drag !== null && refusal !== null
              ? refusalText(refusal)
              : split !== null && held !== undefined
                ? splitText(held)
                : drag.drag === null && selected.length > 1
                  ? pickedText(selected.length)
                  : notes.map(noteText).join(' ')}
        </p>

        {watching !== null ? (
          <div className="actions">
            <button type="button" onClick={playback.skip}>
              Skip
            </button>
          </div>
        ) : status.kind === 'over' ? null : (
          <div className="actions">
            <button type="button" onClick={() => act(undoTurn(session))}>
              Take back
            </button>
            {game.pool.length === 0 && (
              <button type="button" onClick={() => act(drawTile(session))}>
                Pass
              </button>
            )}
            <button type="button" className="primary" onClick={() => act(finishTurn(session))}>
              End turn
            </button>
          </div>
        )}
      </div>

      {watching === null && status.kind === 'over' && (
        <ScoreScreen game={game} over={status} onNewGame={onNewGame} />
      )}

      <section className="rack" aria-label="Your rack">
        {rows.map((slots, row) => (
          <RackRow
            key={row}
            row={row}
            slots={slots}
            byId={byId}
            zoneOf={zoneState}
            tileProps={(tile) => tileProps(tile, false)}
            onTap={tapTarget}
          />
        ))}
      </section>

      {drag.drag !== null && (
        <Ghost drag={drag.drag} tile={findTile(drag.drag, rack, table)} ghostRef={drag.ghostRef} />
      )}
    </div>
  );
}

const INERT: TileEvents = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onTap: () => {},
};

/**
 * A set's tiles with the mark of a cut before the `at`th of them, counted among the tiles that
 * stay put, as `splitFor` counts them: the held tile, if it is one of these, is not.
 */
function withCut(
  tiles: readonly { id: string; node: ReactNode }[],
  at: number | null,
  lifted: string | null,
): ReactNode[] {
  const out: ReactNode[] = [];
  let staying = 0;
  for (const tile of tiles) {
    if (tile.id !== lifted) {
      if (staying === at) out.push(<span key="cut" className="set-cut" aria-hidden="true" />);
      staying++;
    }
    out.push(tile.node);
  }
  return out;
}

function findTile(
  drag: Drag,
  rack: readonly Tile[],
  table: readonly (readonly Tile[])[],
): Tile | undefined {
  return [...rack, ...table.flat()].find((tile) => tile.id === drag.tileId);
}

/**
 * A drawn tile on its way from the pool to whoever drew it: to the person's rack, turning face
 * up as it lands, or to a bot's place in the bar, face down all the way. It is only for the
 * eye. The playback's timer, not this, decides when the tile has landed, so a browser that
 * cannot animate, or a person who asked for less motion, sees the tile appear where it lands.
 */
function Flight({ pick, to, face }: { pick: number; to: string; face: Tile | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const flyer = ref.current;
    const from = document.querySelector(`.pool [data-pick="${pick}"]`);
    const dest = document.querySelector(to);
    if (flyer === null || from === null || dest === null) return;
    if (typeof flyer.animate !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const a = from.getBoundingClientRect();
    const b = dest.getBoundingClientRect();
    // The flyer is drawn at a rack tile's size and scaled down to the pool tile it leaves.
    const width = face === null ? a.width * 1.6 : b.width;
    const height = face === null ? a.height * 1.6 : b.height;
    flyer.style.width = `${width}px`;
    flyer.style.height = `${height}px`;
    const at = (rect: DOMRect, scale: number) =>
      `translate(${rect.left + rect.width / 2 - width / 2}px, ${rect.top + rect.height / 2 - height / 2}px) scale(${scale})`;
    const animations = [
      flyer.animate(
        [
          { transform: at(a, a.width / width), opacity: 1 },
          { transform: at(a, (a.width / width) * 1.25), opacity: 1, offset: 0.15 },
          // A bot's tile reaches its name whole, then goes into it; fading on the way, it was
          // gone before it got there (seen 22 Nov 2026, Chromium at 430 px wide).
          ...(face === null
            ? [
                { transform: at(b, 0.9), opacity: 1, offset: 0.8 },
                { transform: at(b, 0.4), opacity: 0 },
              ]
            : [{ transform: at(b, 1), opacity: 1 }]),
        ],
        { duration: FLIGHT_MS, easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)', fill: 'forwards' },
      ),
    ];
    const back = flyer.querySelector('.flyer-back');
    if (face !== null && back !== null) {
      // Turned over at the end of the flight: squeezed to an edge, the back taken away, opened
      // out face up.
      animations.push(
        flyer.animate(
          [
            { scale: '1 1', offset: 0 },
            { scale: '1 1', offset: 0.7 },
            { scale: '0 1', offset: 0.85 },
            { scale: '1 1', offset: 1 },
          ],
          { duration: FLIGHT_MS, fill: 'forwards' },
        ),
        back.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.85 },
            { opacity: 0, offset: 0.851 },
            { opacity: 0, offset: 1 },
          ],
          { duration: FLIGHT_MS, fill: 'forwards' },
        ),
      );
    }
    return () => animations.forEach((animation) => animation.cancel());
  }, [pick, to, face]);
  return (
    <div
      ref={ref}
      className="tile flyer"
      data-colour={face === null ? undefined : face.kind === 'joker' ? 'joker' : face.colour}
      aria-hidden="true"
    >
      {face !== null && <TileFace tile={face} />}
      <span className="flyer-back" />
    </div>
  );
}

/**
 * The tile under the finger. It takes no pointer events, so the drop target is found under it.
 * Between renders the drag moves it through `ghostRef`.
 */
function Ghost({
  drag,
  tile,
  ghostRef,
}: {
  drag: Drag;
  tile: Tile | undefined;
  ghostRef: (element: HTMLElement | null) => void;
}) {
  if (tile === undefined) return null;
  return (
    <div
      ref={ghostRef}
      className="tile ghost"
      data-colour={tile.kind === 'joker' ? 'joker' : tile.colour}
      aria-hidden="true"
      style={{
        width: drag.width,
        height: drag.height,
        transform: ghostTransform(drag),
      }}
    >
      <TileFace tile={tile} />
    </div>
  );
}
