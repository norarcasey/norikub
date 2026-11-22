# Supabase for Norikub

Norikub has no Supabase project of its own. Its tables are the `norikub` schema in
**CruciNora's** project, beside Nordle's `nordle`, Hanora's `hanora` and Principalities of
Nora's `principalities` (Nora, 22 Nov 2026, `KUB-9`: "It should use the crucinora supabase
project like we did with hanora"). One project is one bill, and one account for a player on
every site. Everything outside `norikub` — CruciNora's tables in `public`, the other games'
schemas, the auth settings, the signup switch, the email templates — belongs to someone else,
and a change there is a `CRU` ticket (or that game's).

A game against the bots needs none of it: it is played and kept on the device
(`apps/web/src/device/`). Supabase is for what is worth keeping beyond one device — games
against friends, results, a leaderboard between friends — and only for a player who signs in.

## Where Norikub's migrations live: CruciNora's repository

Not here. Since `CRU/CRU-24` (17 Nov 2026), `~/src/crucinora` is the one place the shared
project's migrations live and the only repository that pushes them: `db push` refuses while
the database holds a version the pushing repo has no file for, so a second repo pushing would
have to carry every other app's migrations byte for byte. CruciNora's `docs/supabase.md` is the
map of the whole project: which schemas exist, whose they are, and the rule — checked there —
that a game's migration touches only its own schema.

So Norikub has no local stack, no migrations, no schema CI job and no deploy-time schema check
of its own. The supabase layer's closed-signup check is not here either: signup is CruciNora's
setting, and it is open.

## Every schema change

A schema change for Norikub is worked as a Norikub ticket, in CruciNora's repository:

```bash
cd ~/src/crucinora               # a worktree of it, as for any change
npm run db:new -- norikub_<what> # <timestamp>_norikub_<what>.sql, the CLI's timestamp
# write it from supabase/patterns/owned_table.sql — in norikub, the policy in the same file;
# new checks go in supabase/tests/norikub_schema_invariants.sql and norikub_rls_behaviour.sql
npm run db:reset && npm run db:verify
```

The commit there carries `Runway: KUB/KUB-x`. Then CruciNora's Ship it: a Shipit from Nora,
since it changes production schema in a project five apps share; the push to its `main`; and
Nora runs `npm run db:push` from CruciNora's main checkout. Schema first, always: nothing
checks it at deploy time, so Norikub's code that needs it is pushed only after, from here. A
bundle that ships ahead of its schema fails for players instead of failing the deploy.

Migrations are append-only and reach production by `db push`, never the SQL editor (Nora,
21 Oct 2026, `CRU/CRU-10`). A mistake is fixed by the next migration.

## One-time setup — Nora

In this order; none of it can be done from the repo.

1. **The `norikub` schema**: `20261122222136_norikub_schema.sql` in CruciNora's
   `supabase/migrations`, which creates it and touches nothing else. Pushed with
   `npm run db:push` from CruciNora's main checkout.
2. **CruciNora's dashboard → Project Settings → Data API → Exposed schemas**: add `norikub`
   **after** `public`. Until then the API answers every Norikub request with `PGRST106`
   (schema not exposed). The first schema listed is the one a request gets when it names
   none, which is every request crucinora.com makes, so `public` stays first. The list
   applies only on **Save**.
3. **Check it**: `SUPABASE_DB_URL=… npm run db:verify:remote` in `~/src/crucinora` —
   read-only, the structural checks of every schema, Norikub's among them (the session pooler
   connection string; CruciNora's `docs/supabase.md` has it).
4. **GitHub → norarcasey/norikub → Settings → Environments → `production`**:
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, the same two values crucinora.com, Nordle
   and Hanora are built with (Project Settings → API). Both are public, in every bundle; they
   are secrets only so they live in one place, beside the Vercel ones the deploy job reads
   from the same environment. Until they exist the build has no Supabase and the page plays
   as before (`apps/web/src/env.ts`).

**Not needed while sign-in is by code**: Norikub's origin in Authentication → URL
Configuration. A code is typed, not followed, so no redirect lands on Norikub's site.

**Accounts.** The account is the player's CruciNora account. CruciNora's signup is open and
sign-in is by emailed code, so a friend makes their own by typing their email. What they are
sent is CruciNora's template ("Your CruciNora sign-in code"); wording that names every game
would be a `CRU` ticket. The session is per site, in localStorage, so a player who also plays
CruciNora types a code once on each.

## Locally

```bash
(cd ~/src/crucinora && npm run db:start)   # CruciNora's stack, the one local stack
pnpm db:env                                # apps/web/.env.local pointing at it
pnpm dev
```

CruciNora's stack is built from every migration, so it has the `norikub` schema beside
everyone else's, as production has; its main checkout's API is on `54721`. `db:env` asks
CruciNora's own scripts for the status, so with `CRUCINORA_DIR` set to a CruciNora worktree it
points at that worktree's stack instead: the way to run Norikub against a migration not yet on
CruciNora's `main`. Two seeded users, `one@example.test` and `two@example.test`; the code
arrives in the local mailbox at the Mailpit URL `supabase status` prints (`54724` for the main
checkout).
