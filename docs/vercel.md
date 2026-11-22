# Vercel for norikub

CI is the only way to production. `vercel.json` turns off Vercel's own deploys of `main`, and
the `deploy` job in `.github/workflows/ci.yml` runs only after the gate passes.

## One-time setup

From a laptop with no Vercel on it to the app live on its own domain, in this order. There is
no global `vercel` here, and `pnpm vercel` finds none either (_Command "vercel" not found_), so
every command runs the CLI that CI pins, through `pnpm dlx` (Nordle's first cut, 21 Oct 2026).

1. **Log in and link**, from the repo root:

   ```bash
   pnpm dlx vercel@58.9.5 login     # once per laptop
   pnpm dlx vercel@58.9.5 link      # makes the project and writes .vercel/
   git diff .gitignore              # link's two lines, and nothing else...
   git checkout -- .gitignore       # ...so undo them, below
   ```

   The project's name is what `link` offers, the directory's: `norikub`. The domain command
   in step 5 needs it.

   **`link` appends `.vercel` and `.env*` to `.gitignore`. Undo it.** `.env*` comes after the
   base's `!.env.example`, so it ignores `.env.example` again; and the lines already there
   (`.vercel/`, `.env`, `.env.*`) cover everything else it adds.

2. **Environment variables.** In **Project → Settings → Environment Variables**, for Production:

   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` — only if a function or `middleware.ts` reads the
     database at runtime. The `VITE_` values are baked in at build time by CI and are not read
     from here.
   - `CRON_SECRET` — only with a cron job: 16 characters or more. Vercel sends it as the
     bearer, and `api/_lib/cron.ts` refuses every call while it is unset.
   - Any key a function needs, never prefixed `VITE_` — a `VITE_` variable is in the bundle.

3. **GitHub.** A token from **Account Settings → Tokens**, scoped to the team (below), and the
   two ids from `.vercel/project.json` (`orgId`, `projectId`), as repository secrets; a
   `production` environment, which the deploy job names; and last the repository **variable**
   that turns the job on. Until it is set the deploy job is skipped, not failed.

   ```bash
   gh secret set VERCEL_TOKEN          # pasted at the prompt, never on the command line
   gh secret set VERCEL_ORG_ID --body <orgId>
   gh secret set VERCEL_PROJECT_ID --body <projectId>
   gh api --method PUT 'repos/{owner}/{repo}/environments/production'
   gh variable set ENABLE_VERCEL_DEPLOY --body true
   ```

   **Scope the token to the team, not the project.** `vercel pull` cannot use a project-scoped
   token — Nora Bene measured `Error: Could not retrieve Project Settings.` with correct ids, CLI
   58.9.5. And pass no `--scope`: the two ids in the environment are how the CLI finds the
   project.

4. **The first deploy.** Push to `main`, or re-run the last CI run, and watch the `deploy` job
   to the end.

   **The name you asked for may not be the one you get.** Dinora's `dinora.vercel.app` answered
   `DEPLOYMENT_NOT_FOUND` before the first deploy, which looks exactly like a free name, and
   belonged to someone else; Vercel aliased the project to `dinora-zeta.vercel.app` instead
   (24 Sep 2026). Read the production alias off the first deploy. Without a domain of its own,
   that alias is `SITE_URL`: make it follow everywhere it was written — the Mac and iPhone
   bundles, Supabase's Site URL and redirect list — before anyone signs in.

5. **A domain of its own.** A subdomain is added to the project by name:

   ```bash
   pnpm dlx vercel@58.9.5 domains add <sub>.<domain> norikub
   pnpm dlx vercel@58.9.5 domains verify <sub>.<domain>
   ```

   Without the project, `add` refuses: _Only apex domains can be added without a project_. When
   the domain's DNS is hosted elsewhere — Gandi, for crucinora.com — nothing changes there by
   itself: `verify` prints the record to add at that host (a `CNAME` for a subdomain) and
   explains what is still wrong. Add it, and run `verify` again until it passes; then the
   domain serves production, and it is `SITE_URL`, everywhere step 4 says.

## Functions

Every `.ts` under `api/` is a function, except paths starting with `_`. Tests sit beside the
code and `.vercelignore` keeps them from deploying — measured: without it, `x.test.ts` became
a function.

- **Import the core by relative path**, `../packages/core/src/<file>.ts`. By package name
  (`@norikub/core/…`) it is not found at runtime, and lint refuses it.
- **A package a function uses at runtime is a dependency of the root `package.json`** — the
  root is Vercel's project, and a package declared only in `packages/core` or `apps/web` was
  not found when the built function ran.
- Runtime is Node 24, from `engines` in `package.json`, and CI's `node-version` says the
  same. An open range such as `>=24` moves on its own at the next major, so the range is
  closed and a major is a change made on purpose.
- **`undici-types` is held at `@types/node`'s own range, copied verbatim**, and `@types/node`
  by a tilde so a bump cannot move that range underneath it. A root copy pnpm cannot dedupe
  with the one `@types/node` resolves is the missing-`Response` failure below.
- **`vercel build` typechecks every function a second time, and the deploy refuses on an
  error** (`EXPERIMENTAL_NODE_TYPESCRIPT_ERRORS` in `ci.yml`). Its compiler is not ours, in
  two ways measured on Dinora, 24 Sep 2026, with `@vercel/node` 58.9.5. It reads the root
  `tsconfig.json` without resolving `extends`, and finding no `module` there it forces
  `NodeNext` and `strict: false` — so the root file sets `module` itself. And it follows no
  symlinks, so a package pnpm keeps only beside another, not in the root `node_modules`, is
  missing — which is why `undici-types` is a root dev dependency: without it `@types/node`'s
  `Response` has no members. A new error only this build reports is almost certainly
  another of these, not the code.
- To see what it reports without deploying, write `.vercel/project.json` with `settings`
  copied from `vercel.json` rather than running `vercel pull`, which writes production's
  variables to disk. Then build with placeholder public values:

  ```bash
  EXPERIMENTAL_NODE_TYPESCRIPT_ERRORS=1 VITE_SUPABASE_URL=https://placeholder.supabase.co \
    VITE_SUPABASE_ANON_KEY=sb_publishable_placeholder npx vercel@58.9.5 build --prod
  ```

  `npx` runs the CLI on the first `node` it finds, which need not be 24: check that the build
  prints _Node.js 24_, or call the CLI's `dist/vc.js` with Node 24 directly.

## Scheduled jobs

A cron is a function plus an entry in `vercel.json`:

```json
"crons": [{ "path": "/api/cron/nightly", "schedule": "0 5 * * *" }]
```

```ts
import { isCronRequest } from '../_lib/cron.ts';

export async function GET(request: Request): Promise<Response> {
  if (!isCronRequest(request, process.env.CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }
  // reconcile everything since the last run that succeeded, then record this one
  return Response.json({ ok: true });
}
```

From Vercel's docs, read 24 Sep 2026: 100 crons per project on every plan. On Hobby, at most
once a day, fired anywhere inside the hour named. A failed run is not retried; delivery is
best effort, so a run can be missed or arrive twice. Write a job to reconcile, never to
increment, and keep its last success somewhere the app can show — a job that quietly stopped
is otherwise indistinguishable from one with nothing to do. Durations are the function
limits; nothing here runs continuously.
