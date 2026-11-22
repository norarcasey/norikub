import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

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
    const row = screen.getByRole('group', { name: 'Rack row 1' });
    dragTile(tile, row, false);
    expect(screen.getByRole('status').textContent).toMatch(/stays on the table/);
    expect(row.dataset.zone).toBe('refused');
    expect(document.querySelector('.rack-marker')).toBeNull();
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

  it('lets the player move a tile along the rack to another row', () => {
    render(<Harness />);
    const red = rack().getByRole('button', { name: 'red 13' });
    const row3 = screen.getByRole('group', { name: 'Rack row 3' });
    dragTile(red, row3);
    const labels = within(screen.getByRole('group', { name: 'Rack row 3' }))
      .getAllByRole('button')
      .map((tile) => tile.getAttribute('aria-label'));
    expect(labels).toEqual(['black 13', 'red 13']);
    expect(
      within(screen.getByRole('group', { name: 'Rack row 1' })).queryAllByRole('button'),
    ).toHaveLength(0);
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
