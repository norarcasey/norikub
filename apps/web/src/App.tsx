import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { AccountPanel } from './account/AccountPanel.tsx';
import type { Account } from './account/port.ts';
import { env } from './env.ts';
import { gameServer } from './online/gameServer.ts';
import { lastTable, newTableCode } from './online/seat.ts';
import './online/friends.css';
import { standing } from '@norikub/core/match';

import { Landing } from './Landing.tsx';
import { UpdateNotice } from './pwa/UpdateNotice.tsx';
import { GameScreen } from './table/GameScreen.tsx';
import { GameSetup } from './table/GameSetup.tsx';
import { matchLine } from './table/messages.ts';
import { FIRST_SETUP, inProgress, newSession, nextGame, setupOf } from './table/session.ts';
import type { Session, Setup } from './table/session.ts';

// auth-js arrives in this chunk, fetched only when the panel is first opened (KUB-29).
const LiveAccountPanel = lazy(() => import('./account/LiveAccountPanel.tsx'));

/**
 * `initial` is the game saved on the device. It is shown first while it is in progress; a
 * finished one, or none, opens on the landing, which offers its setup again (KUB-42). A test
 * passes `seed` instead to start at a known deal. `onSave` is handed every session before it
 * is shown (invariant 3), so the state on the device is never behind the screen. `account`
 * left out is the real one, when the build has the Supabase values; null offers no sign-in.
 */
export function App({
  initial,
  seed,
  onSave = () => {},
  account,
  friends = gameServer(import.meta.env),
}: {
  initial?: Session | undefined;
  seed?: number;
  onSave?: (session: Session) => void;
  account?: Account | null;
  /** The game host, or null for a build that cannot seat friends and so does not offer to. */
  friends?: URL | null;
}) {
  // Null is the landing: nothing in progress to show.
  const [session, setSession] = useState<Session | null>(() =>
    initial !== undefined
      ? inProgress(initial)
        ? initial
        : null
      : seed === undefined
        ? null
        : newSession(seed),
  );
  // What Play now deals: the setup of the game saved, then of each one dealt here.
  const [last, setLast] = useState<Setup>(() =>
    initial === undefined ? FIRST_SETUP : setupOf(initial),
  );
  const [accountOpen, setAccountOpen] = useState(false);
  const [dealOpen, setDealOpen] = useState(false);
  const [tableCode] = useState(() => newTableCode());
  const [backTo] = useState(lastTable);
  const change = (next: Session) => {
    onSave(next);
    setSession(next);
  };
  const deal = (setup: Setup) => {
    setDealOpen(false);
    setLast(setup);
    change(newSession(Date.now(), setup));
  };
  const next = () => {
    const dealt = session === null ? null : nextGame(session, Date.now());
    if (dealt !== null) change(dealt);
  };
  const friendsLink = friends === null ? null : `/t/${tableCode}`;
  // The last friends' table this device sits at (KUB-35): an installed app opens here, not there.
  const backLink = friends === null || backTo === null ? null : `/t/${backTo}`;
  // A build without the values does not offer sign-in at all, and plays as before.
  const offered = account === undefined ? env !== null : account !== null;
  if (session === null) {
    return (
      <main>
        <UpdateNotice />
        <h1 className="visually-hidden">Norikub</h1>
        <Landing last={last} onDeal={deal} friendsLink={friendsLink} backLink={backLink} />
      </main>
    );
  }
  const { game, match } = session;
  const line = matchLine(match.format, standing(match, game.status, game.players.length));
  return (
    <main>
      <UpdateNotice />
      <h1 className="visually-hidden">Norikub</h1>
      <GameScreen
        session={session}
        onChange={change}
        onNewGame={deal}
        onNextGame={next}
        barEnd={
          <>
            {line !== null && <span className="match-line">{line}</span>}
            {game.status.kind === 'playing' && (
              <button type="button" className="account-open" onClick={() => setDealOpen(true)}>
                New game
              </button>
            )}
            {backLink !== null && (
              <a className="play-friends" href={backLink}>
                Back to your game
              </a>
            )}
            {friendsLink !== null && (
              // A new table is a new link; going there leaves this game saved as it is.
              <a className="play-friends" href={friendsLink}>
                Play friends
              </a>
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
            <p>
              {match.format.kind === 'single'
                ? 'This game is given up, and a new one dealt as set up here.'
                : 'This match is given up, and a new one dealt as set up here.'}
            </p>
            <GameSetup initial={setupOf(session)} action="Deal a new game" onDeal={deal} />
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
