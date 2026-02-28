import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    teardownTimeout: 30_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },
    sequence: {
      hooks: "stack",
    },
    include: [
      "src/__tests__/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/types.ts",
        "node_modules/**",
      ],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 55,
        lines: 60,
      },
      reporter: ["text", "text-summary", "json-summary"],
    },
  },
  ssr: {
    noExternal: ["js-tiktoken"],
  },
  optimizeDeps: {
    exclude: ["js-tiktoken"],
  },
});
