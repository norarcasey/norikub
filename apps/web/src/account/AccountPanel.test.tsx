import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountPanel } from './AccountPanel.tsx';
import type { Account, Outcome } from './port.ts';

const OK: Outcome = { ok: true };

/** An account that signs in with the code 123456, and tells its watcher as auth-js does. */
function fake(signedIn: string | null = null) {
  let email = signedIn;
  const listeners = new Set<(email: string | null) => void>();
  const tell = () => listeners.forEach((l) => l(email));
  const account = {
    current: vi.fn(() => Promise.resolve(email)),
    watch: (listener: (email: string | null) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendCode: vi.fn((email: string) =>
      Promise.resolve(email === '' ? { ok: false, message: 'no email' } : OK),
    ),
    verifyCode: vi.fn((address: string, code: string): Promise<Outcome> => {
      if (code !== '123456') {
        return Promise.resolve({ ok: false, message: 'Token has expired or is invalid' });
      }
      email = address;
      tell();
      return Promise.resolve(OK);
    }),
    signOut: vi.fn(() => {
      email = null;
      tell();
      return Promise.resolve(OK);
    }),
  } satisfies Account;
  return account;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function submit(label: string, value: string, button: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: button }));
  await settle();
}

describe('signing in', () => {
  it('names CruciNora, so the mail that follows is no surprise', async () => {
    render(<AccountPanel account={fake()} onClose={() => {}} />);
    await settle();
    expect(screen.getByText(/your CruciNora account/)).toBeTruthy();
  });

  it('takes an email, then the code, then shows the account', async () => {
    const account = fake();
    render(<AccountPanel account={account} onClose={() => {}} />);
    await settle();
    await submit('Email', ' nora@example.com ', 'Email me a code');
    expect(account.sendCode).toHaveBeenCalledWith('nora@example.com');
    expect(screen.getByText('nora@example.com')).toBeTruthy();

    await submit('Code', '123 456', 'Sign in');
    expect(account.verifyCode).toHaveBeenCalledWith('nora@example.com', '123456');
    expect(screen.getByText(/Signed in to your CruciNora account as/)).toBeTruthy();
    expect(screen.getByText('nora@example.com')).toBeTruthy();
  });

  it('says why a code was refused, and keeps the code step', async () => {
    render(<AccountPanel account={fake()} onClose={() => {}} />);
    await settle();
    await submit('Email', 'nora@example.com', 'Email me a code');
    await submit('Code', '000000', 'Sign in');
    expect(screen.getByRole('alert').textContent).toBe('Token has expired or is invalid');
    expect(screen.getByLabelText('Code')).toBeTruthy();
  });

  it('goes back for a different email', async () => {
    render(<AccountPanel account={fake()} onClose={() => {}} />);
    await settle();
    await submit('Email', 'nora@example.com', 'Email me a code');
    fireEvent.click(screen.getByRole('button', { name: 'Use a different email' }));
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });
});

describe('signed in', () => {
  it('shows which account, and signs out', async () => {
    const account = fake('nora@example.com');
    render(<AccountPanel account={account} onClose={() => {}} />);
    await settle();
    expect(screen.getByText('nora@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await settle();
    expect(account.signOut).toHaveBeenCalled();
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });
});

it('closes', async () => {
  const onClose = vi.fn();
  render(<AccountPanel account={fake()} onClose={onClose} />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalled();
});
