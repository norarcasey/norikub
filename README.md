# Norikub

A tile rummy game to play online against bots or friends

Norikub is a tile rummy game for Nora and her friends, played by the classic rules with its own
Nora-branded tiles. It starts as a game against two bot players, in the browser, installed on
the iPhone from Safari and in a Mac window; playing friends online comes later.

## Develop

Node 24 and pnpm 9 (`corepack enable` picks up the version in `package.json`).

```bash
pnpm install
pnpm db:env   # apps/web/.env.local from CruciNora's local stack (docs/supabase.md)
pnpm dev      # the web app
pnpm gate     # what CI runs: format, lint, typecheck, tests with coverage
pnpm format   # the only command that rewrites files
```

## Plan

What is shipped, what is next and why: the tickets in Linora, app `KUB` (`.linora-app`).
