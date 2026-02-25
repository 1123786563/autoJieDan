import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 3000,
    include: ["./**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["../../../anp/**/*.ts"],
      exclude: ["../../../anp/types.ts"],
      reporter: ["text", "text-summary"],
    },
  },
});
