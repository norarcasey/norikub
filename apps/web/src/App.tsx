import { useState } from 'react';

import { UpdateNotice } from './pwa/UpdateNotice.tsx';
import { GameScreen } from './table/GameScreen.tsx';
import { newSession } from './table/session.ts';
import type { Session } from './table/session.ts';

/**
 * `initial` is the game to show first: the one resumed from the device, or a new deal. A test
 * passes `seed` instead to play a known deal. `onSave` is handed every session before it is
 * shown (invariant 3), so the state on the device is never behind the screen.
 */
export function App({
  initial,
  seed,
  onSave = () => {},
}: {
  initial?: Session;
  seed?: number;
  onSave?: (session: Session) => void;
}) {
  const [session, setSession] = useState<Session>(() => initial ?? newSession(seed ?? Date.now()));
  const change = (next: Session) => {
    onSave(next);
    setSession(next);
  };
  return (
    <main>
      <UpdateNotice />
      <h1 className="visually-hidden">Norikub</h1>
      <GameScreen
        session={session}
        onChange={change}
        onNewGame={() => change(newSession(Date.now()))}
      />
    </main>
  );
}
