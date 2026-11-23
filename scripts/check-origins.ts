/**
 * CI's `check-origins`, after `deploy` and `deploy-game` (KUB-47): lists the Vercel project's
 * production domains and holds each to the deployed game host, failing and naming any origin
 * the host would refuse. `node scripts/check-origins.ts`, with the deploy's environment:
 * VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, GAME_SERVER_URL and GITHUB_SHA.
 *
 * `--origin <url>` (repeatable) skips Vercel and probes the origins given, for trying it from
 * a laptop against `pnpm dev`'s host or production's.
 */
import { argv, env, exit } from 'node:process';

import { probeOrigin, siteDomains } from '../apps/game/src/probe.ts';

function required(name: string): string {
  const value = env[name];
  if (value === undefined || value === '') {
    console.error(`check-origins: ${name} is not set`);
    exit(1);
  }
  return value;
}

async function vercelOrigins(): Promise<string[]> {
  const token = required('VERCEL_TOKEN');
  const project = required('VERCEL_PROJECT_ID');
  const org = required('VERCEL_ORG_ID');
  const url = new URL(`https://api.vercel.com/v9/projects/${project}/domains`);
  url.searchParams.set('limit', '100');
  // A personal account's id is not a team's, and the API refuses it as a teamId.
  if (org.startsWith('team_')) url.searchParams.set('teamId', org);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const body: unknown = await res.json();
  const domains = res.ok ? siteDomains(body) : null;
  if (domains === null) {
    console.error(`check-origins: Vercel's domain list answered ${res.status}`, body);
    exit(1);
  }
  if (domains.skipped.length > 0)
    console.log(`Not serving production, not checked: ${domains.skipped.join(', ')}`);
  return domains.serving.map((name) => `https://${name}`);
}

const given = argv.flatMap((arg, i) => (argv[i - 1] === '--origin' ? [arg] : []));
const origins = given.length > 0 ? given : await vercelOrigins();
if (origins.length === 0) {
  console.error('check-origins: the Vercel project has no production domain to check');
  exit(1);
}
const server = new URL(required('GAME_SERVER_URL'));
// Lower-case letters and digits, as a table code must be; a commit's own, so no player's.
const sha = (env['GITHUB_SHA'] ?? 'local')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')
  .slice(0, 12);

// A Worker version takes a moment to reach every edge after `wrangler deploy` returns, so an
// origin the deploy has just added is asked again before it fails. Three tries, ten seconds
// apart: headroom, not a measurement.
async function probe(origin: string, code: string): Promise<string | null> {
  let problem: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 10_000));
    problem = await probeOrigin(server, origin, code);
    if (problem === null) return null;
  }
  return problem;
}

let failed = 0;
for (const [i, origin] of origins.entries()) {
  const problem = await probe(origin, `ciprobe${sha}${i}`);
  if (problem === null) console.log(`ok  ${origin}`);
  else {
    failed++;
    console.error(`::error title=Site origin refused::${problem}`);
  }
}
if (failed > 0) exit(1);
