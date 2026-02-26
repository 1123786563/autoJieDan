/**
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RetryExecutor,
  retry,
  retrySafe,
  calculateDelay,
  calculateBaseDelay,
  applyJitter,
  sleep,
  isRetryableError,
  formatRetryConfig,
  DEFAULT_RETRY_CONFIG,
  FAST_RETRY_CONFIG,
  STANDARD_RETRY_CONFIG,
  PERSISTENT_RETRY_CONFIG,
  NETWORK_RETRY_CONFIG,
  type RetryConfig,
  type RetryContext,
} from "../../interagent/retry.js";

describe("Backoff Calculations", () => {
  describe("calculateBaseDelay", () => {
    it("should calculate exponential backoff", () => {
      const config: Partial<RetryConfig> = {
        initialDelayMs: 1000,
        maxDelayMs: 100000,
        backoffStrategy: "exponential",
        multiplier: 2,
      };

      expect(calculateBaseDelay(1, config)).toBe(1000);
      expect(calculateBaseDelay(2, config)).toBe(2000);
      expect(calculateBaseDelay(3, config)).toBe(4000);
      expect(calculateBaseDelay(4, config)).toBe(8000);
    });

    it("should calculate linear backoff", () => {
      const config: Partial<RetryConfig> = {
        initialDelayMs: 500,
        maxDelayMs: 100000,
        backoffStrategy: "linear",
      };

      expect(calculateBaseDelay(1, config)).toBe(500);
      expect(calculateBaseDelay(2, config)).toBe(1000);
      expect(calculateBaseDelay(3, config)).toBe(1500);
    });

    it("should use fixed delay", () => {
      const config: Partial<RetryConfig> = {
        initialDelayMs: 1000,
        maxDelayMs: 100000,
        backoffStrategy: "fixed",
      };

      expect(calculateBaseDelay(1, config)).toBe(1000);
      expect(calculateBaseDelay(5, config)).toBe(1000);
      expect(calculateBaseDelay(10, config)).toBe(1000);
    });

    it("should respect max delay", () => {
      const config: Partial<RetryConfig> = {
        initialDelayMs: 1000,
        maxDelayMs: 5000,
        backoffStrategy: "exponential",
        multiplier: 2,
      };

      expect(calculateBaseDelay(10, config)).toBe(5000);
    });
  });

  describe("applyJitter", () => {
    it("should not apply jitter when type is none", () => {
      const config: Partial<RetryConfig> = {
        jitterType: "none",
        jitterFactor: 0.5,
      };

      const delay = applyJitter(1000, config);
      expect(delay).toBe(1000);
    });

    it("should apply full jitter", () => {
      const config: Partial<RetryConfig> = {
        jitterType: "full",
        jitterFactor: 0.5,
      };

      // 多次测试确保范围正确
      for (let i = 0; i < 100; i++) {
        const delay = applyJitter(1000, config);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(1000);
      }
    });

    it("should apply equal jitter", () => {
      const config: Partial<RetryConfig> = {
        jitterType: "equal",
        jitterFactor: 0.5,
      };

      // 多次测试确保范围正确
      for (let i = 0; i < 100; i++) {
        const delay = applyJitter(1000, config);
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(1000);
      }
    });

    it("should apply decorrelated jitter", () => {
      const config: Partial<RetryConfig> = {
        jitterType: "decorrelated",
        jitterFactor: 0.5,
      };

      // 多次测试确保范围正确
      for (let i = 0; i < 100; i++) {
        const delay = applyJitter(1000, config);
        expect(delay).toBeGreaterThanOrEqual(0);
        expect(delay).toBeLessThanOrEqual(3000);
      }
    });
  });

  describe("calculateDelay", () => {
    it("should combine base delay and jitter", () => {
      const config: Partial<RetryConfig> = {
        initialDelayMs: 1000,
        maxDelayMs: 100000,
        backoffStrategy: "fixed",
        jitterType: "none",
      };

      const delay = calculateDelay(1, config);
      expect(delay).toBe(1000);
    });

    it("should use default config if not provided", () => {
      const delay = calculateDelay(1);
      expect(delay).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("RetryExecutor", () => {
  describe("execute", () => {
    it("should return result on first success", async () => {
      const executor = new RetryExecutor<string>();
      const result = await executor.execute(() => "success");

      expect(result.success).toBe(true);
      expect(result.value).toBe("success");
      expect(result.totalAttempts).toBe(1);
      expect(result.exhausted).toBe(false);
    });

    it("should retry on failure", async () => {
      let attempts = 0;
      const executor = new RetryExecutor({
        maxRetries: 3,
        initialDelayMs: 10,
        jitterType: "none",
      });

      const result = await executor.execute(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Temporary failure");
        }
        return "success";
      });

      expect(result.success).toBe(true);
      expect(result.totalAttempts).toBe(3);
    });

    it("should exhaust retries", async () => {
      const executor = new RetryExecutor({
        maxRetries: 2,
        initialDelayMs: 10,
        jitterType: "none",
      });

      const result = await executor.execute(() => {
        throw new Error("Permanent failure");
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permanent failure");
      expect(result.totalAttempts).toBe(3); // 1 initial + 2 retries
      expect(result.exhausted).toBe(true);
    });

    it("should respect retryable errors", async () => {
      let attempts = 0;
      const executor = new RetryExecutor({
        maxRetries: 3,
        initialDelayMs: 10,
        jitterType: "none",
        retryableErrors: ["TemporaryError"],
      });

      const result = await executor.execute(() => {
        attempts++;
        const error = new Error("Temporary failure");
        error.name = "TemporaryError";
        throw error;
      });

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(4);
    });

    it("should not retry non-retryable errors", async () => {
      const executor = new RetryExecutor({
        maxRetries: 3,
        initialDelayMs: 10,
        retryableErrors: ["NetworkError"],
      });

      const result = await executor.execute(() => {
        const error = new Error("Validation failed");
        error.name = "ValidationError";
        throw error;
      });

      expect(result.success).toBe(false);
      expect(result.totalAttempts).toBe(1);
      expect(result.exhausted).toBe(false);
    });

    it("should use custom shouldRetry function", async () => {
      let attempts = 0;
      const executor = new RetryExecutor({ maxRetries: 5, initialDelayMs: 10 });

      executor.setShouldRetry((error, context) => {
        return error.message.includes("retry") && context.attempt < 3;
      });

      const result = await executor.execute(() => {
        attempts++;
        throw new Error("Please retry");
      });

      expect(result.totalAttempts).toBe(3);
    });

    it("should track total wait time", async () => {
      const executor = new RetryExecutor({
        maxRetries: 2,
        initialDelayMs: 100,
        maxDelayMs: 200,
        backoffStrategy: "fixed",
        jitterType: "none",
      });

      let attempts = 0;
      const result = await executor.execute(() => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Retry");
        }
        return "done";
      });

      expect(result.totalWaitMs).toBeGreaterThanOrEqual(180); // ~100 + ~100 with some tolerance
    });

    it("should handle async functions", async () => {
      const executor = new RetryExecutor({ maxRetries: 2, initialDelayMs: 10 });

      const result = await executor.execute(async () => {
        return await Promise.resolve("async result");
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe("async result");
    });
  });

  describe("events", () => {
    it("should emit attempt events", async () => {
      const events: string[] = [];
      const executor = new RetryExecutor({ maxRetries: 2, initialDelayMs: 10 });

      executor.on((event) => events.push(event.type));

      await executor.execute(() => "success");

      expect(events).toContain("attempt");
      expect(events).toContain("success");
    });

    it("should emit failure and exhausted events", async () => {
      const events: string[] = [];
      const executor = new RetryExecutor({ maxRetries: 1, initialDelayMs: 10 });

      executor.on((event) => events.push(event.type));

      await executor.execute(() => {
        throw new Error("fail");
      });

      expect(events).toContain("attempt");
      expect(events).toContain("failure");
      expect(events).toContain("exhausted");
    });
  });
});

describe("Convenience Functions", () => {
  describe("retry", () => {
    it("should return value on success", async () => {
      const result = await retry(() => "success");
      expect(result).toBe("success");
    });

    it("should throw on exhaustion", async () => {
      await expect(
        retry(() => {
          throw new Error("fail");
        }, { maxRetries: 1, initialDelayMs: 10 })
      ).rejects.toThrow("Retry exhausted");
    });
  });

  describe("retrySafe", () => {
    it("should return result object", async () => {
      const result = await retrySafe(() => "success");
      expect(result.success).toBe(true);
      expect(result.value).toBe("success");
    });

    it("should not throw on failure", async () => {
      const result = await retrySafe(
        () => {
          throw new Error("fail");
        },
        { maxRetries: 1, initialDelayMs: 10 }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("fail");
    });
  });

  describe("sleep", () => {
    it("should delay execution", async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
    });
  });
});

describe("Helper Functions", () => {
  describe("isRetryableError", () => {
    it("should match error name", () => {
      const error = new Error("message");
      error.name = "NetworkError";

      expect(isRetryableError(error, ["Network"])).toBe(true);
    });

    it("should match error message", () => {
      const error = new Error("Connection timeout");

      expect(isRetryableError(error, ["timeout"])).toBe(true);
    });

    it("should return false for non-matching patterns", () => {
      const error = new Error("Validation failed");

      expect(isRetryableError(error, ["network", "timeout"])).toBe(false);
    });
  });

  describe("formatRetryConfig", () => {
    it("should format config as string", () => {
      const config: RetryConfig = {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        backoffStrategy: "exponential",
        jitterType: "full",
        jitterFactor: 0.5,
        multiplier: 2,
      };

      const formatted = formatRetryConfig(config);

      expect(formatted).toContain("maxRetries: 3");
      expect(formatted).toContain("initialDelay: 1000ms");
      expect(formatted).toContain("maxDelay: 10000ms");
      expect(formatted).toContain("strategy: exponential");
      expect(formatted).toContain("jitter: full");
    });
  });
});

describe("Predefined Configs", () => {
  it("should have valid fast retry config", () => {
    expect(FAST_RETRY_CONFIG.maxRetries).toBe(2);
    expect(FAST_RETRY_CONFIG.initialDelayMs).toBe(100);
  });

  it("should have valid standard retry config", () => {
    expect(STANDARD_RETRY_CONFIG.maxRetries).toBe(3);
    expect(STANDARD_RETRY_CONFIG.initialDelayMs).toBe(1000);
  });

  it("should have valid persistent retry config", () => {
    expect(PERSISTENT_RETRY_CONFIG.maxRetries).toBe(10);
    expect(PERSISTENT_RETRY_CONFIG.maxDelayMs).toBe(60000);
  });

  it("should have valid network retry config", () => {
    expect(NETWORK_RETRY_CONFIG.retryableErrors).toBeDefined();
    expect(NETWORK_RETRY_CONFIG.retryableErrors).toContain("ECONNRESET");
  });
});

describe("Default Config", () => {
  it("should have sensible defaults", () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
    expect(DEFAULT_RETRY_CONFIG.backoffStrategy).toBe("exponential");
    expect(DEFAULT_RETRY_CONFIG.jitterType).toBe("full");
    expect(DEFAULT_RETRY_CONFIG.multiplier).toBe(2);
  });
});
