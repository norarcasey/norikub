# Norikub

A tile rummy game to play online against bots or friends

<!-- APP-01 replaces this comment and the Invariants below: what the app does, who it is for,
     what it will not do. Write it before any feature. -->

---

## Invariants

The short list. Violating one is a bug even if every test passes. Each says why it exists.

1. _Written in `APP-01`._

- **CI is the only way to production.** Vercel's own deploys of `main` are off in `vercel.json`.
- **The service worker caches the shell and nothing else.** `runtimeCaching` is empty in
  `apps/web/pwa.config.ts`, so every data request reaches the network or fails; rows kept for
  offline are the app's own, in IndexedDB, under an owner. The first runtime route turns this off.
- **The Mac app decides nothing the web app decides.** It loads `apps/web`; a rule written in
  Swift is a second copy that a stale bundle keeps enforcing after the page has changed.

## Non-goals

- _Written in `APP-01`._

## Shape

```
packages/core     framework-free domain: rules, parsing, anything with an opinion
apps/web          Vite + React SPA over it
apps/web/pwa.config.ts
                  installable: the manifest, the service worker's rules,
apps/web/src/pwa/ the stale-chunk reload, the iOS shell
apps/mac          the Mac app: a native window onto the same apps/web build. Swift, built by
                  `pnpm app:install`, never by the gate or CI. `shell/App.swift` is the one
                  file the app edits
api/              Vercel functions — every .ts is one, except under a `_` path
```

A function imports the core by relative path, never by package name; a package it uses at
runtime is a root dependency.

`packages/core` imports no React, no DOM, no database client and no Node built-ins. Its
tsconfig has no DOM and no ambient types, and lint bans the imports, so this holds by
construction rather than by memory. It is the layer the coverage gate (90/90/85/90) measures
and the layer worth testing exhaustively.

## Conventions

- **Strict TS, no `as`, no `!`.** Parse at every boundary with Zod through
  `packages/core/src/parse.ts` and infer the type from the schema; narrow at runtime. A cast
  is how unvalidated data gets into the type system while still being whatever it was.
  `as const` is fine.
- **Discriminated unions over optional-field soup** in the domain.
- **No barrel files; named exports; import from the file that defines the thing.** Every
  relative import ends in `.ts` or `.tsx`.
- **Comments record the argument, not the mechanics.** If a comment would restate the line
  below it, delete it. If it records a decision, keep it and date it.
- **Numbers in comments are measured, and say against what.**

## Working style

- **The plan is in Linora**, the app `.linora-app` names (the `runway` skill). Take work with
  `get_next_ticket` → `claim_ticket`, log findings with `log_progress`, and finish with
  `complete_run` and a summary of what was built, what was found and what the plan got wrong.
  Work found on the way is filed with `create_tickets`, not done unasked. Never move a ticket
  to done: Nora does, after review.
- **Every commit carries a `Runway:` trailer** — the ticket key, or `none`. The global hook
  checks it against Linora and refuses a commit without one.
- Commit attribution comes from the harness's own instructions. Never copy a model name
  from an old commit or a template.
- `pnpm gate` while working. It is the command CI runs, in CI's order, and it never
  rewrites a file: `pnpm format` does that, separately. `pnpm verify` before pushing.

## Ship it

Every ticket ends the same way, before `complete_run` (`~/src/linora/docs/ship-it.md`):

1. **Merge to main.** From the ticket's worktree, rebase onto `main` and fast-forward `main` to
   it. No pull request, no merge commit.
2. **Verify.** `pnpm verify` on the merged result: the gate, then the build. A suite too slow
   for the gate, end-to-end included, joins `verify` here, not CI. Red stops here: fix it, or
   hand the ticket back with the reason. A failure is never shipped as flaky.
3. **Push.** `git push origin main`. Refused because `main` moved: rebase, verify, push again.
4. **Deploy.** CI deploys on push. Watch the run with `gh run watch --exit-status` until the
   `deploy` job has succeeded on this commit: a push is not a deploy. A skipped deploy job
   (`ENABLE_VERCEL_DEPLOY` not yet `true`) is not live; say so in the summary.
5. **Fast-forward the main checkout.** This repo has project hooks, and Claude Code runs the
   main checkout's copy of `scripts/`, so a pushed change reaches the next session only once
   it is pulled. Leave the worktree (`ExitWorktree`, `keep`) and run `git pull --ff-only` in
   the main checkout. Change nothing there by hand. If the pull will not fast-forward, stop and
   tell Nora.
   A change under `apps/mac` is installed from there with `pnpm app:install`, which refuses in
   a worktree. Until then the window's build line says the sources changed.

Then `complete_run` with `shipped: true`. Stop after verify and ask Nora for a **Shipit**
(Shipit / Hold) first when the change touches production data or schema, access (secrets,
sign-in, DNS, billing), publishes something others install, was held by its ticket or by her,
or you are not sure it is right. On Hold, do not push: `shipped: false`, and a summary that
starts `Not shipped:` and names the branch.

## More than one session at once

Each session that changes code works in its own git worktree — `claude --worktree <name>`, or
a subagent's `isolation: "worktree"` — never in a tree another session is editing. Two
sessions in one tree typecheck and commit each other's half-finished work; two worktrees can
only conflict at merge, where it is visible.

- **They nest under `.claude/worktrees/`, and nothing here walks into them.** Git and Prettier
  read `.gitignore`; ESLint ignores the directory by name. A tool added later that walks `.`
  needs the same.
- **A new worktree installs itself.** A hook on SessionStart and SubagentStart
  (`scripts/session-start.ts`) runs `pnpm install` when `node_modules` was not installed from
  this lockfile, and says so.
  Root `.env` files are copied in by `.worktreeinclude`; nothing else is.
- **A new worktree starts from `origin/main`**, Claude Code's default, not from the local
  branch. Push `main` before starting one that needs what just merged.
- **Dev servers do not need arranging.** Vite takes the next free port when 5173 is taken.
  Never set `strictPort`.
- **Anything that touches production or this machine's installed copy runs from the main
  checkout**, after the branch has merged. The scripts that do it refuse in a worktree.
- **Merging** is Ship it, above. Two sessions finishing two tickets do not conflict: the
  tickets are in Linora, and a claim is one transaction there, not a file in this tree.
