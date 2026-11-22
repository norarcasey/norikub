import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
import { deviceGameStore } from './device/gameStore.ts';
import './pwa/shell.css';
import { watchForStaleChunks } from './pwa/staleChunks.ts';
import { watchForUpdates } from './pwa/updates.ts';
import { watchVisibility } from './pwa/veil.ts';
import { newSession } from './table/session.ts';

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root element');

// Before the first render: a lazy route can be reached as soon as anything is on screen.
watchForStaleChunks();
watchForUpdates();
watchVisibility();

// The saved game is read before the first render, so a resumed game is the first thing shown
// and a new deal is never on screen long enough to be played over the saved one. A new deal is
// saved before it is shown, like every state after it (invariant 3).
const store = deviceGameStore();
void store
  .load()
  // A saved game that breaks the resume is lost, not the app: a white page loses every game.
  .catch((error: unknown) => {
    console.warn('[norikub] the saved game could not be resumed', error);
    return null;
  })
  .then((saved) => {
    const initial = saved ?? newSession(Date.now());
    if (saved === null) store.save(initial);
    createRoot(root).render(
      <StrictMode>
        <App initial={initial} onSave={store.save} />
      </StrictMode>,
    );
  });
