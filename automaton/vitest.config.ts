import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 清理超时：允许足够时间关闭数据库连接和 WebSocket
    teardownTimeout: 60_000,
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        // 线程数限制：避免 CI 环境资源竞争
        // 本地开发时可适当提高以加速测试
        maxThreads: 2,
      },
    },
    // 全局设置：捕获未处理异常便于调试
    globalSetup: ["./tests/global-setup.ts"],
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
