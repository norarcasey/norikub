/**
 * Points the web app at CruciNora's local stack: writes apps/web/.env.local from what
 * `supabase status` prints in a CruciNora checkout.
 *
 *   (in ~/src/crucinora) npm run db:start
 *   pnpm db:env
 *
 * Norikub has no stack of its own (KUB-9, 22 Nov 2026): its data is the `norikub` schema in
 * CruciNora's project, CruciNora's repository holds every migration of that project, and its
 * stack, built from all of them, is the one local stack (CRU/CRU-24). Ported from Hanora's,
 * which has worked this way since HAN-25. The status is asked through CruciNora's own
 * `scripts/db/supabase.ts`, so a CruciNora worktree answers for its own stack (its own project
 * id and ports) rather than the main checkout's. `CRUCINORA_DIR` names that checkout; the main
 * one is the default. Point it at a worktree when the migration Norikub needs is not on
 * CruciNora's `main` yet.
 *
 * The .env.local is gitignored, and holds only the two public values the browser gets anyway.
 * Rewritten rather than edited, because the only thing it is for is this. In a worktree of
 * Norikub it is written there too, which is why .worktreeinclude does not copy the main
 * checkout's.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const crucinora = process.env['CRUCINORA_DIR'] ?? join(homedir(), 'src', 'crucinora');
const script = join(crucinora, 'scripts', 'db', 'supabase.ts');
if (!existsSync(script)) {
  console.error(
    `No CruciNora checkout at ${crucinora}: its local stack is the one Norikub uses.\n` +
      'Clone it there, or set CRUCINORA_DIR to the checkout.',
  );
  process.exit(1);
}

const status = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--no-warnings', script, 'status', '-o', 'env'],
  { cwd: crucinora, encoding: 'utf8' },
);
if (status.status !== 0) {
  // The CLI's own words first: "not running" is the usual cause, not the only one.
  process.stderr.write(status.stderr);
  console.error(
    `\nCould not read CruciNora's stack status. If it is not running, start it with\n` +
      `\`npm run db:start\` in ${crucinora}.`,
  );
  process.exit(1);
}

const values = new Map<string, string>();
for (const line of status.stdout.split('\n')) {
  const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
  if (match?.[1] !== undefined && match[2] !== undefined) values.set(match[1], match[2]);
}

// PUBLISHABLE_KEY since the CLI's move to sb_publishable_ keys; ANON_KEY is the old JWT,
// still printed and still accepted, read only if the new one is missing.
const url = values.get('API_URL');
const key = values.get('PUBLISHABLE_KEY') ?? values.get('ANON_KEY');
if (!url || !key) {
  console.error('`supabase status` printed no API_URL or key. Is the stack fully started?');
  process.exit(1);
}

const target = join(process.cwd(), 'apps', 'web', '.env.local');
writeFileSync(target, `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`);
console.log(`Wrote apps/web/.env.local for ${url}, CruciNora's stack at ${crucinora}.`);
