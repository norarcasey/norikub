import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

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
