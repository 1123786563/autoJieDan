import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 60_000,
    include: ['__tests__/freelance/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['__tests__/**', 'node_modules/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
    setupFiles: ['./__tests__/setup.freelance.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true, // SQLite 并发安全
      },
    },
  },
});
