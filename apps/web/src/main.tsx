import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.tsx';
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

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
