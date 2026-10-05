import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // server modules import 'server-only' (a build-time guard); tests run them in plain Node
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
  // *.slow.test.ts need real time (≈ 70 s) and run with `npm run test:slow`
  test: { include: ['tests/**/*.test.ts'], exclude: ['**/node_modules/**', 'tests/**/*.slow.test.ts'], environment: 'node', pool: 'forks' },
});
