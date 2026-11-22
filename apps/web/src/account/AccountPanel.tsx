import { useEffect, useState, type FormEvent } from 'react';

import type { Account, Outcome } from './port.ts';
import './account.css';

type Step =
  | { readonly kind: 'checking' }
  | { readonly kind: 'email' }
  | { readonly kind: 'code'; readonly email: string }
  | { readonly kind: 'in'; readonly email: string };

/**
 * Sign in by emailed code, or see who is signed in. Ported from Hanora (HAN-22 there, itself
 * from Nordle's NORD-17), so the shared account behaves the same on every site that uses it.
 *
 * The copy names CruciNora because the mail does: the project is CruciNora's, so the code
 * arrives as "Your CruciNora sign-in code" (or "sign-up code" for a new address), and a
 * player told only "Norikub" would not expect it. Changing the mail is a CRU ticket.
 *
 * A game against the bots needs no account and is kept on the device either way: signing in
 * or out here changes nothing about the game on the table.
 */
export function AccountPanel({
  account,
  onClose,
}: {
  readonly account: Account;
  readonly onClose: () => void;
}) {
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const show = (signedIn: string | null) => {
      if (live) setStep(signedIn === null ? { kind: 'email' } : { kind: 'in', email: signedIn });
    };
    // Only sign-in and sign-out move the screen; a refresh of the token mid-entry would
    // otherwise throw away a half-typed code.
    const stop = account.watch((signedIn) => {
      if (live)
        setStep((was) =>
          (was.kind === 'in') === (signedIn !== null)
            ? was
            : signedIn === null
              ? { kind: 'email' }
              : { kind: 'in', email: signedIn },
        );
    });
    void account.current().then(show);
    return () => {
      live = false;
      stop();
    };
  }, [account]);

  async function run(action: () => Promise<Outcome>, then: () => void) {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) then();
    else setError(result.message);
  }

  function sendCode(event: FormEvent) {
    event.preventDefault();
    const address = email.trim();
    if (address === '') return;
    void run(
      () => account.sendCode(address),
      () => {
        setCode('');
        setStep({ kind: 'code', email: address });
      },
    );
  }

  function verify(event: FormEvent, address: string) {
    event.preventDefault();
    const token = code.replace(/\s/g, '');
    if (token === '') return;
    void run(
      () => account.verifyCode(address, token),
      () => setStep({ kind: 'in', email: address }),
    );
  }

  return (
    <section className="account" aria-labelledby="account-title">
      <h2 id="account-title">{step.kind === 'in' ? 'Your account' : 'Sign in'}</h2>

      {step.kind === 'checking' && <p>Checking…</p>}

      {step.kind === 'email' && (
        <form onSubmit={sendCode}>
          <p>
            Sign in with your CruciNora account. We’ll email you a code. A new email address makes a
            new CruciNora account.
          </p>
          <label htmlFor="account-email">Email</label>
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      )}

      {step.kind === 'code' && (
        <form onSubmit={(e) => verify(e, step.email)}>
          <p>
            We sent a code to <strong>{step.email}</strong>. It comes from CruciNora: type it here.
          </p>
          <label htmlFor="account-code">Code</label>
          <input
            id="account-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
          <button
            type="button"
            className="account-quiet"
            onClick={() => {
              setError(null);
              setStep({ kind: 'email' });
            }}
          >
            Use a different email
          </button>
        </form>
      )}

      {step.kind === 'in' && (
        <>
          <p>
            Signed in to your CruciNora account as <strong>{step.email}</strong>.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => account.signOut(),
                () => setStep({ kind: 'email' }),
              )
            }
          >
            Sign out
          </button>
        </>
      )}

      {error !== null && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="account-quiet" onClick={onClose}>
        Close
      </button>
    </section>
  );
}
