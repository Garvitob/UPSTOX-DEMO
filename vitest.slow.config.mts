import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `npm run test:slow`: integration tests that need real time (feed watchdog). Same aliases as vitest.config.mts.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  test: { include: ['tests/**/*.slow.test.ts'], environment: 'node', pool: 'forks', testTimeout: 120_000 },
});
