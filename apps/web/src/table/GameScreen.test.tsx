import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
import type { Game } from '../../../../packages/core/src/game.ts';
import { GameScreen } from './GameScreen.tsx';
import { fromGame } from './session.ts';
import type { Session } from './session.ts';

function Harness() {
  const [session, setSession] = useState<Session>(() =>
    fromGame(
      layout(
        [
          { rack: ['red-13-a', 'blue-13-a', 'black-13-a'], hasMelded: true },
          { rack: ['red-1-b'] },
          { rack: ['blue-1-b'] },
        ],
        [['orange-10-a', 'orange-11-a', 'orange-12-a', 'orange-13-a']],
      ),
      [],
    ),
  );
  return <GameScreen session={session} onChange={setSession} onNewGame={noop} />;
}

function RunHarness() {
  const [session, setSession] = useState<Session>(() =>
    fromGame(
      layout(
        [
          { rack: ['red-7-a', 'red-5-a', 'red-6-a'], hasMelded: true },
          { rack: ['blue-1-b'] },
          { rack: ['black-1-b'] },
        ],
        [],
      ),
      [],
    ),
  );
  return <GameScreen session={session} onChange={setSession} onNewGame={noop} />;
}

const noop = () => undefined;

/** One slot of the rack, by row and column from 0. */
function slotAt(row: number, col: number): HTMLElement {
  const slot = document.querySelector<HTMLElement>(`[data-drop="rack-${row}-${col}"]`);
  if (slot === null) throw new Error(`no rack slot ${row}-${col}`);
  return slot;
}

const rack = () => within(screen.getByRole('region', { name: 'Your rack' }));
const newSetZone = () => screen.getByText('New set');

/**
 * jsdom lays nothing out, so `elementFromPoint` is not there to find what is under the
 * pointer. The stand-in answers with one element wherever the pointer is.
 */
function pointAt(element: Element) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => element,
  });
}

function dragTile(tile: Element, over: Element, drop = true) {
  pointAt(over);
  fireEvent.pointerDown(tile, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(tile, { pointerId: 1, clientX: 80, clientY: 90 });
  if (drop) fireEvent.pointerUp(tile, { pointerId: 1, clientX: 80, clientY: 90 });
}

afterEach(() => {
  Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('the table screen', () => {
  it('moves a tile by tapping it, then tapping where it goes, and takes it back', () => {
    render(<Harness />);
    fireEvent.click(rack().getByRole('button', { name: 'red 13' }));
    fireEvent.click(newSetZone());
    const set = screen.getByRole('group', { name: 'Set 2' });
    expect(within(set).getByRole('button', { name: 'red 13' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }));
    expect(screen.queryByRole('group', { name: 'Set 2' })).toBeNull();
    expect(rack().getAllByRole('button')).toHaveLength(3);
  });

  it('drops a dragged tile where the pointer lets go', () => {
    render(<Harness />);
    dragTile(rack().getByRole('button', { name: 'blue 13' }), newSetZone());
    expect(screen.getByRole('group', { name: 'Set 2' }).textContent).toContain('13');
    expect(rack().getAllByRole('button')).toHaveLength(2);
  });

  it('shows the engine’s refusal while a table tile is held over the rack', () => {
    render(<Harness />);
    const set = screen.getByRole('group', { name: 'Set 1' });
    const tile = within(set).getByRole('button', { name: 'orange 13' });
    const slot = slotAt(0, 3);
    dragTile(tile, slot, false);
    expect(screen.getByRole('status').textContent).toMatch(/stays on the table/);
    expect(slot.dataset.zone).toBe('refused');
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 80, clientY: 90 });
    expect(within(set).getByRole('button', { name: 'orange 13' })).toBeDefined();
  });

  it('says why a turn cannot end, and draws the face-down tile picked', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(screen.getByRole('status').textContent).toMatch(/Play at least one tile/);
    expect(screen.queryByRole('button', { name: 'Draw' })).toBeNull();
    const faceDown = screen.getAllByRole('button', { name: 'Face-down tile' });
    const fourth = faceDown[3];
    if (fourth === undefined) throw new Error('no fourth face-down tile');
    fireEvent.click(fourth);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('status').textContent).toMatch(/You drew the/);
    expect(rack().getAllByRole('button')).toHaveLength(4);
    // One for the person's pick, then one each for the two bots, which cannot play and draw.
    expect(screen.getAllByRole('button', { name: 'Face-down tile' })).toHaveLength(
      faceDown.length - 3,
    );
  });

  it('says nothing in the page about what a face-down tile is', () => {
    render(<Harness />);
    const pool = screen.getByRole('region', { name: /Face-down tiles/ });
    expect(pool.innerHTML).not.toMatch(/red|blue|orange|black|joker|\d+-[ab]/);
  });

  it('lets the player put a tile in any slot of the rack, gaps and columns included', () => {
    render(<Harness />);
    // Red 13 to row 3, slot 5: across and down, leaving a gap after black 13.
    dragTile(rack().getByRole('button', { name: 'red 13' }), slotAt(2, 4));
    expect(slotAt(2, 0).textContent).toContain('13');
    expect(slotAt(2, 4).querySelector('[aria-label="red 13"]')).not.toBeNull();
    expect(slotAt(2, 1).childElementCount).toBe(0);
    expect(
      within(screen.getByRole('group', { name: 'Rack row 1' })).queryAllByRole('button'),
    ).toHaveLength(0);
    // Then blue 13 straight up above it, in the same column.
    dragTile(rack().getByRole('button', { name: 'blue 13' }), slotAt(1, 4));
    expect(slotAt(1, 4).querySelector('[aria-label="blue 13"]')).not.toBeNull();
  });

  it('shows a run in order, whatever order its tiles were dropped in', () => {
    render(<RunHarness />);
    for (const name of ['red 7', 'red 5', 'red 6']) {
      fireEvent.click(rack().getByRole('button', { name }));
      fireEvent.click(screen.queryByRole('group', { name: 'Set 1' }) ?? newSetZone());
    }
    const set = screen.getByRole('group', { name: 'Set 1' });
    expect(
      within(set)
        .getAllByRole('button')
        .map((tile) => tile.getAttribute('aria-label')),
    ).toEqual(['red 5', 'red 6', 'red 7']);
  });

  it('does not treat the click after a drag as a tap', () => {
    render(<Harness />);
    const tile = rack().getByRole('button', { name: 'red 13' });
    dragTile(tile, newSetZone());
    const moved = within(screen.getByRole('group', { name: 'Set 2' })).getByRole('button');
    fireEvent.click(moved);
    expect(moved.getAttribute('aria-pressed')).toBe('false');
  });
});

// A red 3-4-5-6-7 on the table and a second red 5 in the rack: the split the ticket is about.
function SplitHarness() {
  const [session, setSession] = useState<Session>(() =>
    fromGame(
      layout(
        [
          { rack: ['red-5-b', 'red-8-a'], hasMelded: true },
          { rack: ['blue-1-b'] },
          { rack: ['black-1-b'] },
        ],
        [['red-3-a', 'red-4-a', 'red-5-a', 'red-6-a', 'red-7-a']],
      ),
      [],
    ),
  );
  return <GameScreen session={session} onChange={setSession} onNewGame={noop} />;
}

const setLabels = (n: number) =>
  within(screen.getByRole('group', { name: `Set ${n}` }))
    .getAllByRole('button')
    .map((tile) => tile.getAttribute('aria-label'));

describe('splitting a run', () => {
  it('shows where the run will be cut while the tile is held over it', () => {
    render(<SplitHarness />);
    const run = screen.getByRole('group', { name: 'Set 1' });
    dragTile(rack().getByRole('button', { name: 'red 5' }), run, false);
    expect(run.dataset.zone).toBe('split');
    expect(screen.getByRole('status').textContent).toMatch(/split the run/);
    const cut = run.querySelector('.set-cut');
    expect(cut?.previousElementSibling?.getAttribute('aria-label')).toBe('red 4');
    expect(cut?.nextElementSibling?.getAttribute('aria-label')).toBe('red 5');
  });

  it('splits the run when the tile is let go on it, and takes it back whole', () => {
    render(<SplitHarness />);
    dragTile(
      rack().getByRole('button', { name: 'red 5' }),
      screen.getByRole('group', { name: 'Set 1' }),
    );
    expect(setLabels(1)).toEqual(['red 3', 'red 4', 'red 5']);
    expect(setLabels(2)).toEqual(['red 5', 'red 6', 'red 7']);
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }));
    expect(setLabels(1)).toEqual(['red 3', 'red 4', 'red 5', 'red 6', 'red 7']);
    expect(screen.queryByRole('group', { name: 'Set 2' })).toBeNull();
  });

  it('splits by tapping the tile, then the run', () => {
    render(<SplitHarness />);
    fireEvent.click(rack().getByRole('button', { name: 'red 5' }));
    fireEvent.click(screen.getByRole('group', { name: 'Set 1' }));
    expect(setLabels(2)).toEqual(['red 5', 'red 6', 'red 7']);
  });

  it('only extends a run the tile extends, with no cut shown', () => {
    render(<SplitHarness />);
    const run = screen.getByRole('group', { name: 'Set 1' });
    dragTile(rack().getByRole('button', { name: 'red 8' }), run, false);
    expect(run.dataset.zone).toBe('over');
    expect(run.querySelector('.set-cut')).toBeNull();
    fireEvent.pointerUp(rack().getByRole('button', { name: 'red 8' }), { pointerId: 1 });
    expect(setLabels(1)).toEqual(['red 3', 'red 4', 'red 5', 'red 6', 'red 7', 'red 8']);
  });
});

// Seat 1 has melded and lays a red 4-5-6, then adds the orange 9 to the run on the table; seat 2
// has not melded and draws. Then it is the person's turn.
function BotsFirstHarness() {
  const [session, setSession] = useState<Session>(() =>
    fromGame(
      {
        ...layout(
          [
            { rack: ['black-2-a', 'black-3-a'] },
            { rack: ['red-4-a', 'red-5-a', 'red-6-a', 'orange-9-a', 'blue-1-b'], hasMelded: true },
            { rack: ['blue-2-b'] },
          ],
          [['orange-10-a', 'orange-11-a', 'orange-12-a']],
        ),
        current: 1,
      },
      [],
    ),
  );
  return <GameScreen session={session} onChange={setSession} onNewGame={noop} />;
}

const status = () => screen.getByRole('status').textContent;
const opponents = () => screen.getByRole('list', { name: 'Opponents' }).textContent;
const wait = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

describe('a bot turn on screen', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the bot’s moves one at a time, then the draw, then hands the turn over', () => {
    render(<BotsFirstHarness />);
    expect(status()).toBe('P1 plays the red 4.');
    expect(opponents()).toContain('P1: 4 tiles');
    expect(screen.queryByRole('group', { name: 'Set 2' })?.textContent).toContain('4');
    expect(screen.queryByRole('button', { name: 'End turn' })).toBeNull();
    const pool = () => screen.getAllByRole('button', { name: 'Face-down tile' });
    const before = pool().length;
    expect(pool()[0]?.getAttribute('aria-disabled')).toBe('true');

    wait(500);
    expect(status()).toBe('P1 plays the red 5.');
    wait(500);
    expect(status()).toBe('P1 plays the red 6.');
    wait(500);
    expect(status()).toBe('P1 plays the orange 9.');
    expect(opponents()).toContain('P1: 1 tiles');
    wait(500);
    expect(status()).toBe('P1 played 4 tiles.');
    wait(800);
    // The tile leaves the pool's last place and is in flight: the counts are still the old ones.
    expect(status()).toBe('P2 draws a tile.');
    expect(opponents()).toContain('P2: 1 tiles');
    expect(pool().at(-1)?.dataset.lifted).toBe('true');
    expect(document.querySelector('.flyer')?.textContent).toBe('');
    wait(600);
    expect(status()).toBe('P2 drew a tile.');
    expect(opponents()).toContain('P2: 2 tiles');
    expect(pool()).toHaveLength(before - 1);
    expect(document.querySelector('.flyer')).toBeNull();
    wait(400);
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End turn' })).toBeDefined();
    expect(status()).toBe('P1 played 4 tiles. P2 drew a tile.');
  });

  it('shows the person’s own draw landing in the rack before the bots play', () => {
    render(<Harness />);
    act(() => {
      fireEvent.click(
        screen.getAllByRole('button', { name: 'Face-down tile' })[2] ?? document.body,
      );
    });
    expect(status()).toBe('You draw a tile.');
    const arriving = document.querySelector('.rack [data-arriving]');
    expect(arriving).not.toBeNull();
    const name = arriving?.getAttribute('aria-label') ?? '';
    expect(document.querySelector('.flyer')?.textContent).not.toBe('');
    wait(600);
    expect(status()).toBe(`You drew the ${name}.`);
    expect(document.querySelector('.rack [data-arriving]')).toBeNull();
    expect(rack().getByRole('button', { name }).dataset.fresh).toBe('true');
    wait(400);
    expect(status()).toBe('P1 draws a tile.');
  });

  it('takes no move, and no pick, while a bot’s turn is playing', () => {
    render(<BotsFirstHarness />);
    const faceDown = screen.getAllByRole('button', { name: 'Face-down tile' });
    fireEvent.click(faceDown[0] ?? document.body);
    expect(screen.getAllByRole('button', { name: 'Face-down tile' })).toHaveLength(faceDown.length);
    fireEvent.click(rack().getByRole('button', { name: 'black 2' }));
    fireEvent.click(screen.getByRole('group', { name: 'Set 1' }));
    expect(rack().getAllByRole('button')).toHaveLength(2);
    expect(rack().getByRole('button', { name: 'black 2' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('skips to the end, and stays there', () => {
    render(<BotsFirstHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('button', { name: 'End turn' })).toBeDefined();
    expect(screen.getByRole('group', { name: 'Set 1' }).textContent).toContain('9');
    wait(5000);
    expect(status()).toBe('P1 played 4 tiles. P2 drew a tile.');
  });
});

/**
 * Two passes in already, with the pool empty: the person's pass is the third in a row, so the
 * game ends on the lowest rack. The pool's tiles are in P2's rack, which makes P2's the
 * highest by far.
 */
function exhausted(): Game {
  const game = layout([{ rack: ['red-1-a'] }, { rack: ['blue-2-a', 'blue-3-a'] }, { rack: [] }]);
  return {
    ...game,
    players: game.players.map((player, seat) =>
      seat === 2 ? { ...player, rack: game.pool } : player,
    ),
    pool: [],
    passes: 2,
  };
}

function ScoresHarness({ game, onNewGame }: { game: Game; onNewGame: () => void }) {
  const [session, setSession] = useState<Session>(() => fromGame(game, []));
  return <GameScreen session={session} onChange={setSession} onNewGame={onNewGame} />;
}

const scoreRows = () =>
  within(screen.getByRole('region', { name: 'Scores' }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.textContent);

describe('the end of the game', () => {
  it('shows the score screen when the person plays their last tile', () => {
    render(<Harness />);
    expect(screen.queryByRole('region', { name: 'Scores' })).toBeNull();
    for (const name of ['red 13', 'blue 13', 'black 13']) {
      fireEvent.click(rack().getByRole('button', { name }));
      fireEvent.click(screen.queryByRole('group', { name: 'Set 2' }) ?? newSetZone());
    }
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    const scores = screen.getByRole('region', { name: 'Scores' });
    expect(within(scores).getByRole('heading').textContent).toBe('You won.');
    expect(scores.textContent).toContain('You played your last tile.');
    // P1 holds a red 1 and P2 a blue 1: each loses 1, and the winner takes the 2.
    expect(scoreRows()).toEqual(['You00+2', 'P111-1', 'P211-1']);
    expect(screen.queryByRole('button', { name: 'End turn' })).toBeNull();
    expect(screen.queryByRole('region', { name: /Face-down tiles/ })).toBeNull();
  });

  it('ends on the lowest rack when the pool has run out and nobody can play', () => {
    render(<ScoresHarness game={exhausted()} onNewGame={noop} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    const skip = screen.queryByRole('button', { name: 'Skip' });
    if (skip !== null) fireEvent.click(skip);
    const scores = screen.getByRole('region', { name: 'Scores' });
    expect(within(scores).getByRole('heading').textContent).toBe('You won.');
    expect(scores.textContent).toContain('The pool ran out');
    const [you, p1, p2] = scoreRows();
    expect(you).toMatch(/^You11\+\d+$/);
    expect(p1).toBe('P125-5');
    expect(p2).toMatch(/^P2\d+\d+-\d+$/);
  });

  it('starts again from the score screen', () => {
    const onNewGame = vi.fn();
    render(<ScoresHarness game={exhausted()} onNewGame={onNewGame} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    const skip = screen.queryByRole('button', { name: 'Skip' });
    if (skip !== null) fireEvent.click(skip);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    expect(onNewGame).toHaveBeenCalledOnce();
  });
});

describe('tapping several tiles (KUB-2)', () => {
  it('plays the tiles tapped as a new set with one tap of New set', () => {
    render(<Harness />);
    for (const name of ['red 13', 'blue 13', 'black 13']) {
      fireEvent.click(rack().getByRole('button', { name }));
    }
    expect(screen.getByRole('status').textContent).toMatch(/3 tiles picked/);
    fireEvent.click(newSetZone());
    expect(setLabels(2)).toEqual(['red 13', 'blue 13', 'black 13']);
    expect(rack().queryAllByRole('button')).toHaveLength(0);
  });

  it('lets a tapped tile go again with a second tap', () => {
    render(<Harness />);
    const red = rack().getByRole('button', { name: 'red 13' });
    fireEvent.click(red);
    fireEvent.click(rack().getByRole('button', { name: 'blue 13' }));
    fireEvent.click(red);
    expect(red.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(newSetZone());
    expect(setLabels(2)).toEqual(['blue 13']);
  });

  it('lets the tapped tiles go on Take back', () => {
    render(<Harness />);
    fireEvent.click(rack().getByRole('button', { name: 'red 13' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take back' }));
    expect(rack().getByRole('button', { name: 'red 13' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('plays on a set when any tile of it is tapped, not only its edge', () => {
    render(<SplitHarness />);
    fireEvent.click(rack().getByRole('button', { name: 'red 8' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Set 1' })).getByRole('button', { name: 'red 3' }),
    );
    expect(setLabels(1)).toEqual(['red 3', 'red 4', 'red 5', 'red 6', 'red 7', 'red 8']);
  });

  it('gathers tiles from one set, then plays them on another', () => {
    render(<SplitHarness />);
    const run = () => within(screen.getByRole('group', { name: 'Set 1' }));
    fireEvent.click(rack().getByRole('button', { name: 'red 5' }));
    fireEvent.click(rack().getByRole('button', { name: 'red 8' }));
    fireEvent.click(newSetZone());
    fireEvent.click(run().getByRole('button', { name: 'red 6' }));
    fireEvent.click(run().getByRole('button', { name: 'red 7' }));
    expect(run().getByRole('button', { name: 'red 7' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Set 2' })).getByRole('button', { name: 'red 8' }),
    );
    expect(setLabels(1)).toEqual(['red 3', 'red 4', 'red 5']);
    expect(setLabels(2)).toEqual(['red 5', 'red 6', 'red 7', 'red 8']);
  });
});

describe('a held tile (KUB-2)', () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const runFrame = (now: number) => {
    const due = frames;
    frames = [];
    due.forEach((callback) => callback(now));
  };

  it('moves the held tile with the pointer while the target stays the same', () => {
    render(<Harness />);
    const tile = rack().getByRole('button', { name: 'red 13' });
    dragTile(tile, newSetZone(), false);
    const ghost = document.querySelector<HTMLElement>('.ghost');
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 140, clientY: 60 });
    expect(document.querySelector('.ghost')).toBe(ghost);
    expect(ghost?.style.transform).toBe('translate(130px, 50px)');
    expect(newSetZone().dataset.zone).toBe('over');
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 140, clientY: 60 });
    expect(document.querySelector('.ghost')).toBeNull();
  });

  it('scrolls the table when held at its top, once it has stayed there', () => {
    render(<Harness />);
    const table = screen.getByRole('region', { name: 'Table' });
    Object.defineProperty(table, 'scrollHeight', { configurable: true, value: 900 });
    Object.defineProperty(table, 'clientHeight', { configurable: true, value: 300 });
    table.scrollTop = 200;
    table.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 100, width: 400, height: 300 });
    const tile = rack().getByRole('button', { name: 'red 13' });
    pointAt(table);
    fireEvent.pointerDown(tile, { button: 0, pointerId: 1, clientX: 50, clientY: 600 });
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 50, clientY: 90 });
    runFrame(1000);
    expect(table.scrollTop).toBe(200);
    runFrame(1200);
    expect(table.scrollTop).toBeLessThan(200);
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 50, clientY: 250 });
    const still = table.scrollTop;
    runFrame(1300);
    expect(table.scrollTop).toBe(still);
    expect(frames).toHaveLength(0);
    fireEvent.pointerCancel(tile);
  });
});

describe('a finger on a full table (KUB-27)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tableTile = (name: string) =>
    within(screen.getByRole('group', { name: 'Set 1' })).getByRole('button', { name });
  const touch = { button: 0, pointerId: 1, pointerType: 'touch' };
  const ghost = () => document.querySelector('.ghost');
  const wait = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  /** Whether the page's scroll was refused for a finger moving now. */
  const touchMove = () => {
    const event = new Event('touchmove', { bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };

  it('scrolls, and lifts nothing, when it moves up or down first', () => {
    render(<Harness />);
    const tile = tableTile('orange 11');
    pointAt(newSetZone());
    fireEvent.pointerDown(tile, { ...touch, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 52, clientY: 70 });
    expect(touchMove()).toBe(false);
    wait(1000);
    expect(ghost()).toBeNull();
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 52, clientY: 70 });
    fireEvent.click(tile);
    expect(tile.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Set 2' })).toBeNull();
  });

  it('lifts a tile rested on, which then holds the page still and drops where it goes', () => {
    render(<Harness />);
    const tile = tableTile('orange 13');
    pointAt(newSetZone());
    fireEvent.pointerDown(tile, { ...touch, clientX: 50, clientY: 100 });
    wait(299);
    expect(ghost()).toBeNull();
    wait(1);
    expect(ghost()).not.toBeNull();
    expect(touchMove()).toBe(true);
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 50, clientY: 300 });
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 50, clientY: 300 });
    expect(ghost()).toBeNull();
    expect(touchMove()).toBe(false);
    const set = screen.getByRole('group', { name: 'Set 2' });
    expect(within(set).getByRole('button', { name: 'orange 13' })).toBeDefined();
  });

  it('lifts at once when it moves sideways first', () => {
    render(<Harness />);
    const tile = tableTile('orange 13');
    pointAt(newSetZone());
    fireEvent.pointerDown(tile, { ...touch, clientX: 50, clientY: 100 });
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 80, clientY: 105 });
    expect(ghost()).not.toBeNull();
    expect(newSetZone().dataset.zone).toBe('over');
    fireEvent.pointerCancel(tile);
    expect(ghost()).toBeNull();
  });

  it('puts a rested-on tile back when let go where it was, without splitting its run', () => {
    render(<Harness />);
    const tile = tableTile('orange 11');
    pointAt(screen.getByRole('group', { name: 'Set 1' }));
    fireEvent.pointerDown(tile, { ...touch, clientX: 50, clientY: 100 });
    wait(300);
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 52, clientY: 101 });
    fireEvent.click(tile);
    expect(ghost()).toBeNull();
    expect(screen.queryByRole('group', { name: 'Set 2' })).toBeNull();
    const set = screen.getByRole('group', { name: 'Set 1' });
    expect(set.querySelectorAll('.tile')).toHaveLength(4);
    expect(tableTile('orange 11').getAttribute('aria-pressed')).toBe('false');
  });

  it('still lifts a rack tile at once, whichever way it moves', () => {
    render(<Harness />);
    const tile = rack().getByRole('button', { name: 'red 13' });
    expect(tile.dataset.scrolls).toBeUndefined();
    expect(tableTile('orange 13').dataset.scrolls).toBe('true');
    pointAt(newSetZone());
    fireEvent.pointerDown(tile, { ...touch, clientX: 50, clientY: 600 });
    fireEvent.pointerMove(tile, { pointerId: 1, clientX: 50, clientY: 400 });
    expect(ghost()).not.toBeNull();
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 50, clientY: 400 });
    expect(screen.getByRole('group', { name: 'Set 2' }).textContent).toContain('13');
  });

  it('lets a quick tap still pick a table tile', () => {
    render(<Harness />);
    const tile = tableTile('orange 13');
    fireEvent.pointerDown(tile, { ...touch, clientX: 50, clientY: 100 });
    wait(100);
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 50, clientY: 100 });
    fireEvent.click(tile);
    wait(1000);
    expect(ghost()).toBeNull();
    expect(tile.getAttribute('aria-pressed')).toBe('true');
  });
});
