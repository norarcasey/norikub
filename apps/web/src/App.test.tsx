import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Account } from './account/port.ts';
import { App } from './App.tsx';
import { newSession } from './table/session.ts';
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
