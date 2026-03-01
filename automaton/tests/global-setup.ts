/**
 * Vitest 全局设置和清理
 *
 * 用于捕获测试期间的未处理异常，便于调试。
 *
 * 注意：globalSetup 在独立上下文中运行，无法与测试文件共享状态。
 * 资源清理应在各测试文件的 afterEach/afterAll 钩子中处理。
 */

// 保存处理器引用，以便精确移除（而不是 removeAllListeners）
const handlers = {
  uncaughtException: (error: Error) => {
    console.error("[Test Setup] Uncaught exception:", error);
  },
  unhandledRejection: (reason: unknown) => {
    console.error("[Test Setup] Unhandled rejection:", reason);
  },
};

export function setup() {
  console.log("[Test Setup] Global test environment initialized");

  // 注册异常处理器
  process.on("uncaughtException", handlers.uncaughtException);
  process.on("unhandledRejection", handlers.unhandledRejection);
}

export function teardown() {
  console.log("[Test Teardown] Starting cleanup...");

  // 精确移除我们添加的处理器（不影响其他代码添加的处理器）
  process.off("uncaughtException", handlers.uncaughtException);
  process.off("unhandledRejection", handlers.unhandledRejection);

  // 强制垃圾回收（如果可用，需使用 --expose-gc 标志启动）
  if (global.gc) {
    try {
      global.gc();
    } catch (e) {
      console.debug("[Test Teardown] GC not available:", e);
    }
  }

  console.log("[Test Teardown] Cleanup completed");
}
