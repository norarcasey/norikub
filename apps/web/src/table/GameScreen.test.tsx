import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { layout } from '../../../../packages/core/src/fixtures.test-helpers.ts';
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
  return <GameScreen session={session} onChange={setSession} />;
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
  return <GameScreen session={session} onChange={setSession} />;
}

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
  return <GameScreen session={session} onChange={setSession} />;
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
    expect(screen.queryByRole('region', { name: /Face-down tiles/ })).toBeNull();

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
    expect(status()).toBe('P2 draws a tile.');
    expect(opponents()).toContain('P2: 2 tiles');
    wait(900);
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End turn' })).toBeDefined();
    expect(status()).toBe('P1 played 4 tiles. P2 drew a tile.');
  });

  it('takes no move while a bot’s turn is playing', () => {
    render(<BotsFirstHarness />);
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
