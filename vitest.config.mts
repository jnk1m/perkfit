import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src'), 'server-only': path.resolve(__dirname, 'tests/helpers/server-only-stub.ts') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    testTimeout: 10_000,
    env: { PERKFIT_MODE: 'sample' },
  },
});
