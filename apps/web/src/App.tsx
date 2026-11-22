import { useState } from 'react';

import { UpdateNotice } from './pwa/UpdateNotice.tsx';
import { GameScreen } from './table/GameScreen.tsx';
import { newSession } from './table/session.ts';
import type { Session } from './table/session.ts';

/** A test passes `seed` to play a known deal; otherwise each load deals a new one. */
export function App({ seed }: { seed?: number }) {
  const [session, setSession] = useState<Session>(() => newSession(seed ?? Date.now()));
  return (
    <main>
      <UpdateNotice />
      <h1 className="visually-hidden">Norikub</h1>
      <GameScreen session={session} onChange={setSession} />
    </main>
  );
}
