import { readFileSync } from 'node:fs';

import { unstable_readConfig } from 'wrangler';
import { expect, it } from 'vitest';

import { originAllowed } from '../src/origin.ts';

/**
 * The site's origins are written in four places nobody tied together (KUB-46): the Vercel
 * project's domains, the Mac app's `home`, Supabase's redirect list and `SITE_ORIGINS`. CI's
 * `check-origins` holds the Vercel domains to the deployed Worker after every deploy; this
 * holds the Mac app's to the committed list before one (KUB-47). Supabase's list lives in its
 * dashboard, where nothing here can read it.
 *
 * The config is read by wrangler's own reader, the one `wrangler deploy` uses, so a comment or
 * a trailing comma cannot make this disagree with what is deployed.
 */

const repo = new URL('../../../', import.meta.url);

function macHome(swift: string): string | null {
  return /static let home = "([^"]+)"/.exec(swift)?.[1] ?? null;
}

it("lists the Mac app's home among the origins that may open a table", () => {
  const swift = readFileSync(new URL('apps/mac/shell/App.swift', repo), 'utf8');
  const home = macHome(swift);
  expect(home, 'App.swift has no `static let home`').not.toBeNull();
  const origin = new URL(home ?? '').origin;

  const config = unstable_readConfig({
    config: new URL('apps/game/wrangler.jsonc', repo).pathname,
  });
  const sites: unknown = config.vars['SITE_ORIGINS'];
  expect(typeof sites).toBe('string');
  expect(
    originAllowed(origin, typeof sites === 'string' ? sites : ''),
    `${origin}, the Mac app's home, is not in SITE_ORIGINS in apps/game/wrangler.jsonc`,
  ).toBe(true);
});

it('finds the home in the shape App.swift writes it', () => {
  expect(macHome('    static let home = "https://kub.example.com/"\n')).toBe(
    'https://kub.example.com/',
  );
  expect(macHome('let elsewhere = "x"')).toBeNull();
});
