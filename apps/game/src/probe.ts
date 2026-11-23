import { z } from 'zod';

import { parse } from '../../../packages/core/src/parse.ts';
import { SITE_REFUSED } from '../../../packages/core/src/protocol.ts';

/**
 * Whether every address the site is served from may open a table on the deployed game host
 * (KUB-47). `SITE_ORIGINS` fell behind the Vercel project's domains once (KUB-46): the site
 * moved to norikub.crucinora.com, the list still said only norikub.vercel.app, and every
 * Sit down there failed as if the network had. CI's `check-origins` runs this after both
 * deploys; `scripts/check-origins.ts` is its command, at the root.
 */

/**
 * The Vercel project's domains (`GET /v9/projects/<id>/domains`), only the fields read here.
 * A domain that redirects never serves the page; one tied to a git branch or a custom
 * environment is not production; an unverified one serves nothing yet.
 */
const projectDomainsSchema = z.object({
  domains: z.array(
    z.object({
      name: z.string(),
      verified: z.boolean(),
      redirect: z.string().nullish(),
      gitBranch: z.string().nullish(),
      customEnvironmentId: z.string().nullish(),
    }),
  ),
});

export type SiteDomains = { serving: string[]; skipped: string[] };

export function siteDomains(body: unknown): SiteDomains | null {
  const parsed = parse(projectDomainsSchema, body);
  if (!parsed.ok) return null;
  const serving: string[] = [];
  const skipped: string[] = [];
  for (const d of parsed.value.domains) {
    const production = !d.redirect && !d.gitBranch && !d.customEnvironmentId;
    (production && d.verified ? serving : skipped).push(d.name);
  }
  return { serving, skipped };
}

const refusedSchema = z.object({ refused: z.unknown() });

/**
 * One origin, as a page served from it would ask: a preflight, then a join. The join's body
 * has no name, so a table that answers it refuses `not a name` and seats nobody: that answer
 * can only come from the table's object, which the Worker reaches only for an allowed
 * origin, and it leaves nothing in production's storage. A real seat would, at a probe table
 * per origin on every deploy, kept forever (the host never deletes a table).
 *
 * `null` when the origin may open tables, otherwise what went wrong, naming it.
 */
export async function probeOrigin(
  server: URL,
  origin: string,
  code: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const url = new URL(`/tables/${code}/join`, server);
  const preflight = await fetcher(url, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  if (preflight.status !== 204 || preflight.headers.get('Access-Control-Allow-Origin') !== origin)
    return `${origin}: the preflight answered ${preflight.status}, allowing ${preflight.headers.get('Access-Control-Allow-Origin') ?? 'no origin'}`;

  const join = await fetcher(url, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const text = await join.text();
  const refused = parse(refusedSchema, jsonOrNull(text));
  const reason = refused.ok ? refused.value.refused : null;
  if (reason === SITE_REFUSED)
    return `${origin} is not in the game host's SITE_ORIGINS (apps/game/wrangler.jsonc): every Sit down there is refused`;
  if (join.status !== 400 || reason !== 'not a name')
    return `${origin}: the join answered ${join.status} ${text.slice(0, 200)}, not the table's refusal of a missing name`;
  if (join.headers.get('Access-Control-Allow-Origin') !== origin)
    return `${origin}: the join's answer does not allow ${origin} to read it`;
  return null;
}

function jsonOrNull(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return null;
  }
}
