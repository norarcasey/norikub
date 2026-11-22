/**
 * Covers the page while it is hidden, so an app's lock can decide on the way back before
 * anything is drawn.
 *
 * It does not hide the app switcher's card, and nothing a page can do will. It was written
 * for that card, on the belief — carried from Nora Bene's spec, never measured — that iOS
 * takes the snapshot after `visibilitychange`. On Dinora's installed iPhone app, 27 Sep 2026,
 * the card showed the balances; Dinora's `SEC-03` then also covered on the window's `blur`,
 * deployed it, and the card still showed them. An app with something to hide from a person
 * holding the phone needs a lock (a passkey after idle, as Dinora's `SEC-01`), not this.
 *
 * What it does: while hidden, `#root` is not drawn, and it lifts on the event in which the
 * page is visible again. A lock that marks itself in that same event means no frame of the
 * app shows before the lock screen. That is reasoned from the order of the events, not seen.
 * `pagehide` too, because a suspended PWA does not always fire the first.
 */

const ATTRIBUTE = 'data-veiled';

export function watchVisibility(doc: Document = document, win: Window = window): () => void {
  const root = doc.documentElement;
  const cover = (): void => root.setAttribute(ATTRIBUTE, '');
  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') root.removeAttribute(ATTRIBUTE);
    else cover();
  };
  // Back from the bfcache: the page is shown without a visibilitychange to say so.
  const onPageShow = (): void => {
    if (doc.visibilityState === 'visible') root.removeAttribute(ATTRIBUTE);
  };

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', cover);
  win.addEventListener('pageshow', onPageShow);

  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', cover);
    win.removeEventListener('pageshow', onPageShow);
    root.removeAttribute(ATTRIBUTE);
  };
}
