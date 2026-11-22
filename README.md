# Norikub

A tile rummy game to play online against bots or friends

## Develop

Node 24 and pnpm 9 (`corepack enable` picks up the version in `package.json`).

```bash
pnpm install
pnpm dev      # the web app
pnpm gate     # what CI runs: format, lint, typecheck, tests with coverage
pnpm format   # the only command that rewrites files
```

## Plan

What is shipped, what is next and why: the tickets in Linora, app `KUB` (`.linora-app`).
