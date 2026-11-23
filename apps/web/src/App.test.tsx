import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Account } from './account/port.ts';
import { App } from './App.tsx';
import { newSession, seatsFor } from './table/session.ts';
import type { Session } from './table/session.ts';

// A smoke test, and the cheapest one there is: an app that throws on first render ships a
// white page, and this catches it without a browser.
it('renders without throwing', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Norikub');
});

it('hands every change to be saved before it is shown (invariant 3)', () => {
  const shown: string[] = [];
  const onSave = vi.fn((session: Session) => {
    // On screen at the moment of saving is still the state before this one.
    shown.push(screen.getByRole('status').textContent);
    expect(session.notes).toHaveLength(1);
  });
  render(<App initial={newSession(7)} onSave={onSave} />);
  fireEvent.click(screen.getByRole('button', { name: 'End turn' }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(shown).toEqual(['']);
  expect(screen.getByRole('status').textContent).not.toBe('');
});

describe('picking the bots (KUB-41)', () => {
  it('deals a new game mid-game against the bots picked, and saves it first', () => {
    const onSave = vi.fn();
    render(<App initial={newSession(7)} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('dialog', { name: 'New game' });
    const first = within(dialog).getByRole('group', { name: 'First bot' });
    const second = within(dialog).getByRole('group', { name: 'Second bot' });
    fireEvent.click(within(first).getByRole('radio', { name: 'Hard' }));
    fireEvent.click(within(second).getByRole('radio', { name: 'Hard' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deal a new game' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ lineup: seatsFor(['hard', 'hard']) });
    const opponents = screen.getByRole('list', { name: 'Opponents' }).textContent;
    expect(opponents).toContain('Tatum');
    expect(opponents).toContain('Edward');
  });

  it('plays each bot as the character picked, swapping one another seat already has (KUB-43)', () => {
    const onSave = vi.fn();
    render(<App initial={newSession(7)} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    const dialog = screen.getByRole('dialog', { name: 'New game' });
    const first = within(dialog).getByRole('group', { name: 'First bot' });
    const second = within(dialog).getByRole('group', { name: 'Second bot' });
    fireEvent.click(within(first).getByRole('radio', { name: 'Michael' }));
    // Michael is the first bot's now; picking him for the second hands the first its Edward.
    fireEvent.click(within(second).getByRole('radio', { name: 'Michael' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Deal a new game' }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      lineup: [
        { level: 'medium', who: 'edward' },
        { level: 'medium', who: 'michael' },
      ],
    });
    const bar = screen.getByRole('list', { name: 'Opponents' });
    expect(bar.textContent).toContain('Edward');
    expect(bar.textContent).toContain('Michael');
    expect(bar.querySelectorAll('img.avatar')).toHaveLength(2);
  });

  it('leaves the game as it was when the picker is closed', () => {
    const onSave = vi.fn();
    render(<App initial={newSession(7)} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'New game' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('the landing (KUB-42)', () => {
  const finished = (s: Session, scores: readonly number[]): Session => ({
    ...s,
    game: { ...s.game, status: { kind: 'over', reason: 'rack-emptied', winner: 0, scores } },
    turn: null,
  });

  it('opens when nothing is saved, and Play now deals the first setup, saved first', () => {
    const onSave = vi.fn();
    render(<App onSave={onSave} account={null} friends={null} />);
    const start = screen.getByRole('region', { name: 'Start' });
    expect(start.textContent).toContain('Against Tatum (medium) and Edward (medium), one game.');
    fireEvent.click(screen.getByRole('button', { name: 'Play now' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ lineup: seatsFor(['medium', 'medium']) });
    expect(screen.getByRole('button', { name: 'End turn' })).toBeTruthy();
  });

  it('sets up three bots for a few games, and the bar counts the games', () => {
    const onSave = vi.fn();
    render(<App onSave={onSave} account={null} friends={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up a game' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Bots' })).getByRole('radio', { name: '3' }),
    );
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Third bot' })).getByRole('radio', {
        name: 'Easy',
      }),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'A few games' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Games' })).getByRole('radio', { name: '5' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deal' }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      lineup: seatsFor(['medium', 'medium', 'easy']),
      match: { format: { kind: 'games', games: 5 }, played: [] },
    });
    expect(screen.getByText('Game 1 of 5')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Opponents' }).children).toHaveLength(3);
  });

  it('goes back from the setup without dealing', () => {
    const onSave = vi.fn();
    render(<App onSave={onSave} account={null} friends={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up a game' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Play now' })).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('opens on a finished game, offering what it was played as', () => {
    const last = newSession(7, {
      lineup: seatsFor(['hard']),
      format: { kind: 'points', target: 200 },
    });
    render(<App initial={finished(last, [200, -200])} account={null} friends={null} />);
    expect(screen.getByRole('region', { name: 'Start' }).textContent).toContain(
      'Against Tatum (hard), first to 200 points.',
    );
  });

  it('resumes a match between games on the table, and deals its next game', () => {
    const onSave = vi.fn();
    const first = newSession(7, {
      lineup: seatsFor(['hard']),
      format: { kind: 'games', games: 3 },
    });
    render(
      <App initial={finished(first, [30, -30])} onSave={onSave} account={null} friends={null} />,
    );
    expect(screen.queryByRole('region', { name: 'Start' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Next game' }));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ match: { played: [[30, -30]] } });
    expect(screen.getByText('Game 2 of 3')).toBeTruthy();
  });

  it('offers a friends’ table when the build knows a game host', () => {
    render(<App account={null} friends={new URL('http://localhost:8787')} />);
    const link = screen.getByRole('link', { name: 'Play friends' });
    expect(link.getAttribute('href')).toMatch(/^\/t\/[a-z0-9]{12}$/);
  });
});

describe('the account', () => {
  const signedOut: Account = {
    current: () => Promise.resolve(null),
    watch: () => () => {},
    sendCode: () => Promise.resolve({ ok: true }),
    verifyCode: () => Promise.resolve({ ok: true }),
    signOut: () => Promise.resolve({ ok: true }),
  };

  async function settle() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('is not offered by a build without the Supabase values, and the game is as before', () => {
    // The test build has none, as a deploy missing its secrets would not: the game must load.
    render(<App initial={newSession(7)} />);
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
    expect(screen.getByRole('button', { name: 'End turn' })).toBeTruthy();
  });

  it('is not offered when sign-in is switched off', () => {
    render(<App initial={newSession(7)} account={null} />);
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
  });

  it('opens over the game, which stays where it was, and closes', async () => {
    render(<App initial={newSession(7)} account={signedOut} />);
    const rack = screen.getByRole('region', { name: 'Your rack' });
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    await settle();
    expect(screen.getByRole('dialog', { name: 'Account' })).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    // The same game screen, not a new one: a bot's turn mid-playback would restart otherwise.
    expect(screen.getByRole('region', { name: 'Your rack' })).toBe(rack);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on Escape and on a tap beside the panel, not on one inside it', async () => {
    render(<App initial={newSession(7)} account={signedOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    await settle();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    await settle();
    fireEvent.click(screen.getByLabelText('Email'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('playing friends', () => {
  it('offers a new table at its own link when the build knows a game host', () => {
    render(<App seed={7} account={null} friends={new URL('http://localhost:8787')} />);
    const link = screen.getByRole('link', { name: 'Play friends' });
    expect(link.getAttribute('href')).toMatch(/^\/t\/[a-z0-9]{12}$/);
  });

  it('offers the way back to the last table this device sits at, on the start screen and in a game', () => {
    localStorage.setItem(
      'norikub.table.abcd2345efgh',
      JSON.stringify({ token: 'c'.repeat(32), seat: 1, rows: null, startRows: null }),
    );
    localStorage.setItem('norikub.lastTable', 'abcd2345efgh');
    const host = new URL('http://localhost:8787');
    const landing = render(<App account={null} friends={host} />);
    expect(screen.getByRole('region', { name: 'Start' })).toBeTruthy();
    const back = screen.getByRole('link', { name: 'Back to your game' });
    expect(back.getAttribute('href')).toBe('/t/abcd2345efgh');
    landing.unmount();
    render(<App seed={7} account={null} friends={host} />);
    expect(screen.getByRole('link', { name: 'Back to your game' }).getAttribute('href')).toBe(
      '/t/abcd2345efgh',
    );
    localStorage.clear();
  });

  it('offers nothing in a build with no game host', () => {
    render(<App seed={7} account={null} friends={null} />);
    expect(screen.queryByRole('link', { name: 'Play friends' })).toBeNull();
  });
});
