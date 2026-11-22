import { useSyncExternalStore } from 'react';

/**
 * Noticing a deploy while the app is open, and saying so. Dinora's `OPS-04`, 25 Sep 2026.
 *
 * A browser looks for a new service worker when a page is navigated to, and an app whose routes
 * are hashes, or that never leaves its first page, never navigates. So a tab or an installed app
 * left open kept the build it opened with until it was closed: the first reload after a deploy
 * was answered from the old worker's cache, and only a second one showed the new build. Chrome
 * looks eagerly enough to hide that. DuckDuckGo on the Mac, Safari's engine underneath, did not:
 * Nora refreshed both after a Dinora deploy and only Chrome changed. `sw.js` served `max-age=0`
 * (vercel.json) is needed for this, and was already so; it is not enough on its own.
 *
 * So the app asks for itself: when it comes back into view and every half hour while it is
 * seen. Each ask is one conditional request, answered 304 until something ships.
 *
 * When a new worker takes over (`skipWaiting` and `clientsClaim`, in pwa.config.ts), the page
 * running is the old build. It says so and offers a reload, and never reloads by itself. The
 * natural moment for that would be while the app is hidden, which is exactly when somebody has
 * switched away to copy something into a half-filled form.
 */

/** Reasoned, not measured: a deploy a day at most, and a 304 costs nothing. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;

let ready = false;
const listeners = new Set<() => void>();

function announce(): void {
  ready = true;
  for (const listener of listeners) listener();
}

/** Whether a newer build than the one running has taken over this page. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => ready,
    () => false,
  );
}

/** For tests: back to the build the page opened with. */
export function forgetUpdate(): void {
  ready = false;
}

/** Returns a teardown. Does nothing where there is no service worker: jsdom, or a Mac WebView without one. */
export function watchForUpdates(target: Window = window): () => void {
  const container: ServiceWorkerContainer | undefined = target.navigator.serviceWorker;
  if (container === undefined) return () => {};

  // The first worker to install also takes control, by `clientsClaim`. That is this build's
  // own worker arriving, not a newer build.
  let controlled = container.controller !== null;
  const onControllerChange = (): void => {
    if (controlled) announce();
    controlled = true;
  };

  const check = (): void => {
    container
      .getRegistration()
      .then((registration) => registration?.update())
      // Offline, or the worker file answered badly: the next check tries again.
      .catch(() => {});
  };
  const onVisibility = (): void => {
    if (target.document.visibilityState === 'visible') check();
  };
  const timer = target.setInterval(() => {
    if (target.document.visibilityState === 'visible') check();
  }, CHECK_EVERY_MS);

  container.addEventListener('controllerchange', onControllerChange);
  target.document.addEventListener('visibilitychange', onVisibility);
  return () => {
    container.removeEventListener('controllerchange', onControllerChange);
    target.document.removeEventListener('visibilitychange', onVisibility);
    target.clearInterval(timer);
  };
}
