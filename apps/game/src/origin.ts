/**
 * The Worker is a second origin (`*.workers.dev`) beside the site, so any page on the web
 * could open a socket to it unless it checks. A seat token is still what authorises a seat;
 * this keeps other sites' pages from driving the game host with a visitor's browser.
 *
 * `sites` is the Worker's `SITE_ORIGINS` variable, comma-separated. A page served from this
 * machine (`pnpm dev`, any port) is always allowed: it is how the game is worked on, and a
 * localhost page can only be one the visitor is running themselves. Hanora's, as it stands.
 */
export function originAllowed(origin: string, sites: string): boolean {
  const listed = sites
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (listed.includes(origin)) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(origin);
}

/** The headers that let an allowed page read the Worker's response to its `fetch`. */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // A table's join sends its name as JSON, which a browser asks about first.
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
