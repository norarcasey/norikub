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
    dragTile(tile, screen.getByRole('region', { name: 'Your rack' }), false);
    expect(screen.getByRole('status').textContent).toMatch(/stays on the table/);
    expect(screen.getByRole('region', { name: 'Your rack' }).dataset.zone).toBe('refused');
    fireEvent.pointerUp(tile, { pointerId: 1, clientX: 80, clientY: 90 });
    expect(within(set).getByRole('button', { name: 'orange 13' })).toBeDefined();
  });

  it('says why a turn cannot end, and draws instead', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
    expect(screen.getByRole('status').textContent).toMatch(/Play at least one tile/);
    fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
    expect(screen.getByRole('status').textContent).toMatch(/You drew the/);
    expect(rack().getAllByRole('button')).toHaveLength(4);
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
