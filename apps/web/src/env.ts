import { parse } from '@norikub/core/parse';
import { z } from 'zod';

/**
 * The two values the browser needs to reach Supabase, parsed at the boundary like any
 * other untyped input. Both are public: CruciNora's project URL and its publishable key,
 * the project Norikub shares (KUB-9).
 *
 * Locally they come from apps/web/.env.local, which `pnpm db:env` writes from CruciNora's
 * running stack, the one local stack for the shared project. In production the deploy job
 * sets them from repository secrets at build time — as process env rather than through
 * `vercel pull`, which pulls a variable marked sensitive as the literal string
 * "[SENSITIVE]"; that once shipped a Nora Bene bundle that could not reach its database.
 */
const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
});

/**
 * Null when either value is missing or malformed. A game against the bots needs neither: it
 * is played and kept on the device, and an account is only ever extra. So a build without
 * them plays as before, and a throw here would take the whole page down instead (Nordle's
 * env.ts did, until its NORD-17; Hanora's is the same as this). App checks this before it
 * offers the Account button, the one way the client is loaded (KUB-29).
 */
export const env: z.infer<typeof schema> | null = configured();

function configured(): z.infer<typeof schema> | null {
  const parsed = parse(schema, import.meta.env);
  if (parsed.ok) return parsed.value;
  // Names only, never values: a misplaced secret in one of these would end up in a log.
  console.warn(
    `Supabase is not configured, so accounts are off: ${parsed.issues.map((i) => i.split(':')[0]).join(', ')}`,
  );
  return null;
}
