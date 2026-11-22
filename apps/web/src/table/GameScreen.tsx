import { useCallback, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { arrangeSet, judgeSet } from '@norikub/core/sets';
import type { Tile } from '@norikub/core/tiles';

import { dropAttribute, toMove, useDrag } from './drag.ts';
import type { Drag, DropTarget } from './drag.ts';
import { frameText, noteText, refusalText, tileName } from './messages.ts';
import { usePlayback } from './playback.ts';
import { PERSON, drawTile, finishTurn, moveTile, probe, undoTurn } from './session.ts';
import type { Session } from './session.ts';
import './table.css';

type TileEvents = {
  readonly onPointerDown: (tileId: string, event: ReactPointerEvent<HTMLElement>) => void;
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

function TileButton({
  tile,
  events,
  lifted,
  selected,
  fresh,
}: {
  tile: Tile;
  events: TileEvents;
  lifted: boolean;
  selected: boolean;
  fresh: boolean;
}) {
  return (
    <button
      type="button"
      className="tile"
      data-colour={tile.kind === 'joker' ? 'joker' : tile.colour}
      data-lifted={lifted || undefined}
      data-selected={selected || undefined}
      data-fresh={fresh || undefined}
      aria-label={tileName(tile)}
      aria-pressed={selected}
      onPointerDown={(event) => events.onPointerDown(tile.id, event)}
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

export function GameScreen({
  session,
  onChange,
}: {
  session: Session;
  onChange: (next: Session) => void;
}) {
  const { game, turn, notes, rows } = session;
  const [selected, setSelected] = useState<string | null>(null);
  // While a bot's turn plays back, the screen shows the frame and takes no moves: the game
  // underneath is already at the person's turn, and a move made now would be made on a table
  // they cannot see.
  const playback = usePlayback(session.replay);
  const watching = playback.frame;

  const place = useCallback(
    (tileId: string, target: DropTarget) => {
      setSelected(null);
      const spot = target.kind === 'rack' ? { row: target.row, col: target.col } : undefined;
      onChange(moveTile(session, toMove(tileId, target), spot));
    },
    [session, onChange],
  );

  const drag = useDrag({ onDrop: place });

  const live: TileEvents = {
    onPointerDown: drag.onPointerDown,
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.onPointerUp,
    onPointerCancel: drag.onPointerCancel,
    onTap: (tileId) => {
      if (drag.swallowClick()) return;
      setSelected((current) => (current === tileId ? null : tileId));
    },
  };
  const events = watching === null ? live : INERT;

  // Tap a tile, then tap where it goes: the same moves as a drag, for a keyboard or a hand
  // that would rather not drag.
  const tapTarget = (target: DropTarget) => () => {
    if (watching === null && selected !== null) place(selected, target);
  };

  // While a tile is in flight the engine is asked what it would say to letting go here, so a
  // refusal shows before the drop and not after it (invariant 1: asked, not decided).
  const hovering = drag.drag?.target ?? null;
  const refusal =
    drag.drag !== null && hovering !== null
      ? probe(session, toMove(drag.drag.tileId, hovering))
      : null;

  const zoneState = (target: DropTarget) =>
    sameTarget(hovering, target) ? (refusal === null ? 'over' : 'refused') : undefined;

  const startIds = new Set(turn?.start.table.flat().map((tile) => tile.id) ?? []);
  const invalid = new Set(
    notes.flatMap((note) =>
      note.kind === 'fault' && note.fault.kind === 'invalid-set' ? [note.fault.set] : [],
    ),
  );
  const table = watching?.table ?? turn?.table ?? game.table;
  const rack = turn?.rack ?? game.players[PERSON]?.rack ?? [];
  const byId = new Map(rack.map((tile) => [tile.id, tile]));
  const lifted = drag.drag?.tileId ?? null;
  // A tile on the table that was not there when the turn began came from the rack this turn.
  const tileProps = (tile: Tile, onTable: boolean): TileProps => ({
    tile,
    events,
    lifted: tile.id === lifted,
    selected: tile.id === selected,
    fresh:
      watching === null
        ? onTable && turn !== null && !startIds.has(tile.id)
        : watching.step.kind === 'placed' && watching.step.tile.id === tile.id,
  });

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
            <li key={o.seat} data-playing={o.playing || undefined}>
              {o.name}: {o.count} tiles
            </li>
          ))}
        </ul>
        <span>Pool: {watching?.pool ?? game.pool.length}</span>
      </header>

      <section className="table" aria-label="Table">
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
              {arrangeSet(set).map((tile) => (
                <TileButton key={tile.id} {...tileProps(tile, true)} />
              ))}
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

      {watching === null && status.kind === 'playing' && game.pool.length > 0 && (
        // Face down, as at a real table: the buttons carry their place in the pool and nothing
        // else, so the page itself never says what a tile is before it is drawn.
        <section className="pool" aria-label="Face-down tiles: pick one to draw">
          {game.pool.map((_, pick) => (
            <button
              key={pick}
              type="button"
              className="face-down"
              aria-label="Face-down tile"
              onClick={() => onChange(drawTile(session, pick))}
            />
          ))}
        </section>
      )}

      <p className="notes" role="status">
        {watching !== null
          ? frameText(watching)
          : drag.drag !== null && refusal !== null
            ? refusalText(refusal)
            : notes.map(noteText).join(' ')}
      </p>

      {watching !== null ? (
        <div className="actions">
          <button type="button" onClick={playback.skip}>
            Skip
          </button>
        </div>
      ) : status.kind === 'over' ? (
        <p className="over">
          {status.winner === PERSON ? 'You won.' : `${game.players[status.winner]?.name} won.`}
        </p>
      ) : (
        <div className="actions">
          <button type="button" onClick={() => onChange(finishTurn(session))}>
            End turn
          </button>
          <button type="button" onClick={() => onChange(undoTurn(session))}>
            Take back
          </button>
          {game.pool.length === 0 && (
            <button type="button" onClick={() => onChange(drawTile(session))}>
              Pass
            </button>
          )}
        </div>
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

      {drag.drag !== null && <Ghost drag={drag.drag} tile={findTile(drag.drag, rack, table)} />}
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

function findTile(
  drag: Drag,
  rack: readonly Tile[],
  table: readonly (readonly Tile[])[],
): Tile | undefined {
  return [...rack, ...table.flat()].find((tile) => tile.id === drag.tileId);
}

/** The tile under the finger. It takes no pointer events, so the drop target is found under it. */
function Ghost({ drag, tile }: { drag: Drag; tile: Tile | undefined }) {
  if (tile === undefined) return null;
  return (
    <div
      className="tile ghost"
      data-colour={tile.kind === 'joker' ? 'joker' : tile.colour}
      aria-hidden="true"
      style={{
        width: drag.width,
        height: drag.height,
        transform: `translate(${drag.x - drag.grabX}px, ${drag.y - drag.grabY}px)`,
      }}
    >
      <TileFace tile={tile} />
    </div>
  );
}
