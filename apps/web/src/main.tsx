import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { deviceGameStore } from './device/gameStore.ts';
import { FriendsPage } from './online/FriendsTable.tsx';
import { gameServer } from './online/gameServer.ts';
import { isTablePath } from './online/seat.ts';
import { UpdateNotice } from './pwa/UpdateNotice.tsx';
import './pwa/shell.css';
import { watchForStaleChunks } from './pwa/staleChunks.ts';
import { watchForUpdates } from './pwa/updates.ts';
import { watchVisibility } from './pwa/veil.ts';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

// Before the first render: a lazy route can be reached as soon as anything is on screen.
watchForStaleChunks();
watchForUpdates();
watchVisibility();

// A friends' table is its own page: it plays on the game host, not on the device, so it
// reads nothing of the saved bot game and leaves it as it was (KUB-34).
if (isTablePath(window.location.pathname)) {
  createRoot(root).render(
    <StrictMode>
      <UpdateNotice />
      <h1 className="visually-hidden">Norikub</h1>
      <FriendsPage pathname={window.location.pathname} server={gameServer(import.meta.env)} />
    </StrictMode>,
  );
} else {
  playTheBots(root);
}

function playTheBots(root: HTMLElement) {
  // The saved game is read before the first render, so a resumed game is the first thing shown
  // and the landing is never on screen long enough to deal over the saved one. With nothing
  // saved the app opens on the landing (KUB-42); the deal made there is saved before it is
  // shown, like every state after it (invariant 3).
  const store = deviceGameStore();
  void store
    .load()
    // A saved game that breaks the resume is lost, not the app: a white page loses every game.
    .catch((error: unknown) => {
      console.warn('[norikub] the saved game could not be resumed', error);
      return null;
    })
    .then((saved) => {
      createRoot(root).render(
        <StrictMode>
          <App initial={saved ?? undefined} onSave={store.save} />
        </StrictMode>,
      );
    });
}
