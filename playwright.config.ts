import { execFileSync } from 'node:child_process';

import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end suite: the page and the game host together, through a real browser, as
 * friends play them (KUB-34). It is in `pnpm verify` and not in CI's gate, as every suite
 * too slow for the gate is (CLAUDE.md, "Ship it").
 *
 * Two servers of its own, on ports free when the run starts, rather than fixed ones: a
 * `pnpm dev` already running, or another worktree's run, must not be the thing under test.
 * The ports are chosen once in the runner and handed to its workers through the environment,
 * which they inherit; a worker that chose again would talk to servers nobody started.
 */
function freePort(): number {
  const found = execFileSync(
    process.execPath,
    [
      '-e',
      "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})",
    ],
    { encoding: 'utf8' },
  );
  return Number(found.trim());
}

process.env['E2E_WEB_PORT'] ??= String(freePort());
process.env['E2E_GAME_PORT'] ??= String(freePort());
const web = `http://localhost:${process.env['E2E_WEB_PORT']}`;
const game = `http://localhost:${process.env['E2E_GAME_PORT']}`;

export default defineConfig({
  testDir: './e2e',
  // A friends' table is three browsers at once already; one test at a time keeps them honest.
  workers: 1,
  forbidOnly: true,
  reporter: 'list',
  use: { baseURL: web, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // workerd, from the committed wrangler.jsonc, with no account: the host as `pnpm dev` runs it.
      command: `pnpm --filter @norikub/game exec wrangler dev --ip 127.0.0.1 --port ${process.env['E2E_GAME_PORT']} --inspector-port 0 --show-interactive-dev-session=false`,
      // The Worker answers 403 to a request with no Origin; any answer means it is up.
      url: `${game}/`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      // `--port` without `--strictPort`: the port was free a moment ago, and if it is not now
      // Vite moves and `url` is never reached, which fails the run with a reason.
      command: `pnpm --filter @norikub/web exec vite --port ${process.env['E2E_WEB_PORT']}`,
      url: web,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_GAME_SERVER: game },
    },
  ],
});
