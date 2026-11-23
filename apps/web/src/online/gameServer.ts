/**
 * Where the game host is (`apps/game`, docs/online.md). A build is told by `VITE_GAME_SERVER`
 * (CI passes the repository variable `GAME_SERVER_URL`); `pnpm dev` runs `wrangler dev` beside
 * Vite on its default port, so a dev build that was told nothing uses that. A production build
 * told nothing has no game host, and says so rather than guessing one. Hanora's, as it stands.
 */
export function gameServer(env: {
  readonly VITE_GAME_SERVER?: unknown;
  readonly DEV: boolean;
}): URL | null {
  const given = env.VITE_GAME_SERVER;
  if (typeof given === 'string' && given !== '') return URL.canParse(given) ? new URL(given) : null;
  return env.DEV ? new URL('http://localhost:8787') : null;
}

/** A table's join (`POST` with a name), on the game host. */
export function tableJoinUrl(server: URL, code: string): URL {
  return new URL(`/tables/${code}/join`, server);
}

/** A seat's socket at a table, `wss:` when the host is served over https. */
export function tableSocketUrl(server: URL, code: string, token: string): URL {
  const url = new URL(`/tables/${code}/socket`, server);
  url.searchParams.set('token', token);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url;
}
