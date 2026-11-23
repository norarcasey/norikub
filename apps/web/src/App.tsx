import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { AccountPanel } from './account/AccountPanel.tsx';
import type { Account } from './account/port.ts';
import { env } from './env.ts';
import { UpdateNotice } from './pwa/UpdateNotice.tsx';
import { GameScreen } from './table/GameScreen.tsx';
import { LineupPicker } from './table/LineupPicker.tsx';
import { newSession } from './table/session.ts';
import type { Lineup, Session } from './table/session.ts';

// auth-js arrives in this chunk, fetched only when the panel is first opened (KUB-29).
const LiveAccountPanel = lazy(() => import('./account/LiveAccountPanel.tsx'));

/**
 * `initial` is the game to show first: the one resumed from the device, or a new deal. A test
 * passes `seed` instead to play a known deal. `onSave` is handed every session before it is
 * shown (invariant 3), so the state on the device is never behind the screen. `account` left
 * out is the real one, when the build has the Supabase values; null offers no sign-in.
 */
export function App({
  initial,
  seed,
  onSave = () => {},
  account,
}: {
  initial?: Session;
  seed?: number;
  onSave?: (session: Session) => void;
  account?: Account | null;
}) {
  const [session, setSession] = useState<Session>(() => initial ?? newSession(seed ?? Date.now()));
  const [accountOpen, setAccountOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const change = (next: Session) => {
    onSave(next);
    setSession(next);
  };
  const deal = (lineup: Lineup) => {
    setDealOpen(false);
    change(newSession(Date.now(), lineup));
  };
  // A build without the values does not offer sign-in at all, and plays as before.
  const offered = account === undefined ? env !== null : account !== null;
  return (
    <main>
      <UpdateNotice />
      <h1 className="visually-hidden">Norikub</h1>
      <GameScreen
        session={session}
        onChange={change}
        onNewGame={deal}
        barEnd={
          <>
            {session.game.status.kind === 'playing' && (
              <button type="button" className="account-open" onClick={() => setDealOpen(true)}>
                New game
              </button>
            )}
            {offered && (
              <button type="button" className="account-open" onClick={() => setAccountOpen(true)}>
                Account
              </button>
            )}
          </>
        }
      />
      {dealOpen && (
        <Dialog label="New game" onClose={() => setDealOpen(false)}>
          <section className="account">
            <h2>New game</h2>
            <p>This game is given up, and a new one dealt against the bots picked here.</p>
            <LineupPicker initial={session.lineup} action="Deal a new game" onDeal={deal} />
          </section>
        </Dialog>
      )}
      {accountOpen && (
        <Dialog label="Account" onClose={() => setAccountOpen(false)}>
          {account === undefined || account === null ? (
            <Suspense fallback={<p className="account">Loading…</p>}>
              <LiveAccountPanel onClose={() => setAccountOpen(false)} />
            </Suspense>
          ) : (
            <AccountPanel account={account} onClose={() => setAccountOpen(false)} />
          )}
        </Dialog>
      )}
    </main>
  );
}

/**
 * Over the table rather than in place of it, unlike Hanora's home page: the game screen holds
 * a bot's turn mid-playback and the tiles tapped so far, and unmounting it would lose both
 * (KUB-29). A tap on the veil or Escape closes it, as Close does. The new-game picker opens
 * the same way (KUB-41).
 */
function Dialog({
  label,
  onClose,
  children,
}: {
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="account-veil"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
