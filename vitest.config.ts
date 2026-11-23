import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'core', include: ['packages/*/src/**/*.test.ts'], environment: 'node' },
      },
      {
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/src/test-setup.ts'],
        },
      },
      {
        test: { name: 'mac', include: ['apps/mac/src/**/*.test.ts'], environment: 'node' },
      },
      {
        test: {
          name: 'server',
          include: ['api/**/*.test.ts', 'middleware.test.ts'],
          environment: 'node',
        },
      },
      {
        // Node, not @cloudflare/vitest-pool-workers: the pool needs vitest 4 and this repo is
        // on 5, as Hanora found (HAN-13, 15 Nov 2026). worker.test.ts starts the real Worker in
        // workerd through wrangler instead.
        test: { name: 'game', include: ['apps/game/test/**/*.test.ts'], environment: 'node' },
      },
    ],
    coverage: {
      provider: 'v8',
      // The game host's plain modules join the core here. Its Durable Object and Worker entry
      // run inside workerd, where v8 coverage in this process cannot see them; worker.test.ts
      // is their test, through the wire.
      include: ['packages/core/src/**/*.ts', 'apps/game/src/**/*.ts'],
      exclude: ['**/*.test.ts', 'apps/game/src/host.ts', 'apps/game/src/worker.ts'],
      // The thresholds gate the pure layer and nothing else. A percentage on the React app
      // buys tests written to satisfy the percentage. A glob threshold is measured across
      // every file it matches rather than per file, which is why this is one entry for the
      // package. Noradar's numbers, held since 13 Sep 2026.
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
      reporter: ['text-summary', 'html'],
    },
  },
});
