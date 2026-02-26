/**
 * 配置热更新测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HotReloader,
  HotReloaderOptions,
  ConfigChangeEvent,
  ConfigReloadEvent,
  createHotReloader,
} from "../../../interagent/config/index.js";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

// 测试目录
const TEST_DIR = join(process.cwd(), ".test-config");
const CONFIG_PATH = join(TEST_DIR, "config.json");

describe("HotReloader", () => {
  let reloader: HotReloader;

  beforeEach(() => {
    // 创建测试目录
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // 创建初始配置
    writeFileSync(CONFIG_PATH, JSON.stringify({ debug: false, port: 3000 }));

    reloader = new HotReloader({
      configPath: CONFIG_PATH,
      initialConfig: { debug: false, port: 3000 },
    });
  });

  afterEach(() => {
    reloader.stop();
    // 清理测试目录
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  describe("constructor", () => {
    it("should create with options", () => {
      expect(reloader).toBeDefined();
      expect(reloader.getVersion()).toBe(0);
    });

    it("should use custom debounce delay", () => {
      const customReloader = new HotReloader({
        configPath: CONFIG_PATH,
        debounceDelay: 500,
      });
      expect(customReloader).toBeDefined();
    });
  });

  describe("getConfig", () => {
    it("should return current config", () => {
      const config = reloader.getConfig();
      expect(config.debug).toBe(false);
      expect(config.port).toBe(3000);
    });
  });

  describe("get", () => {
    it("should return config value", () => {
      expect(reloader.get("debug")).toBe(false);
      expect(reloader.get("port")).toBe(3000);
    });

    it("should return undefined for non-existent key", () => {
      expect(reloader.get("nonexistent")).toBeUndefined();
    });
  });

  describe("set", () => {
    it("should set config value", () => {
      reloader.set("debug", true);
      expect(reloader.get("debug")).toBe(true);
    });

    it("should emit change event", () => {
      const listener = vi.fn();
      reloader.on("change", listener);

      reloader.set("debug", true);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "debug",
          oldValue: false,
          newValue: true,
        })
      );
    });
  });

  describe("reload", () => {
    it("should reload config from file", async () => {
      // 修改配置文件
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));

      const result = await reloader.reload();
      expect(result).toBe(true);
      expect(reloader.get("debug")).toBe(true);
    });

    it("should emit change events for modified keys", async () => {
      const listener = vi.fn();
      reloader.on("change", listener);

      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));
      await reloader.reload();

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "debug",
          oldValue: false,
          newValue: true,
        })
      );
    });

    it("should not emit if no changes", async () => {
      const listener = vi.fn();
      reloader.on("change", listener);

      // 不修改内容
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: false, port: 3000 }));
      const result = await reloader.reload();

      expect(result).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it("should update version on reload", async () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));
      await reloader.reload();

      expect(reloader.getVersion()).toBe(1);
    });
  });

  describe("rollback", () => {
    it("should rollback to previous version", async () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));
      await reloader.reload();

      expect(reloader.get("debug")).toBe(true);

      const result = reloader.rollback();
      expect(result).toBe(true);
      expect(reloader.get("debug")).toBe(false);
    });

    it("should emit rollback event", async () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));
      await reloader.reload();

      const listener = vi.fn();
      reloader.on("rollback", listener);

      reloader.rollback();

      expect(listener).toHaveBeenCalled();
    });

    it("should return false if no history", () => {
      const result = reloader.rollback();
      expect(result).toBe(false);
    });
  });

  describe("getHistory", () => {
    it("should return empty history initially", () => {
      const history = reloader.getHistory();
      expect(history.size).toBe(0);
    });

    it("should return history after changes", async () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));
      await reloader.reload();

      const history = reloader.getHistory();
      expect(history.size).toBe(1);
    });
  });

  describe("getStats", () => {
    it("should return stats", () => {
      const stats = reloader.getStats();

      expect(stats.version).toBe(0);
      expect(stats.historySize).toBe(0);
      expect(stats.totalReloads).toBe(0);
      expect(stats.isWatching).toBe(false);
    });
  });

  describe("start/stop", () => {
    it("should start watching", () => {
      reloader.start();
      expect(reloader.isWatching()).toBe(true);
    });

    it("should stop watching", () => {
      reloader.start();
      reloader.stop();
      expect(reloader.isWatching()).toBe(false);
    });

    it("should emit started event", () => {
      const listener = vi.fn();
      reloader.on("started", listener);

      reloader.start();

      expect(listener).toHaveBeenCalled();
    });

    it("should emit stopped event", () => {
      const listener = vi.fn();
      reloader.on("stopped", listener);

      reloader.start();
      reloader.stop();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe("clearHistory", () => {
    it("should clear history", async () => {
      writeFileSync(CONFIG_PATH, JSON.stringify({ debug: true, port: 3000 }));
      await reloader.reload();

      reloader.clearHistory();
      expect(reloader.getHistory().size).toBe(0);
    });
  });
});

describe("createHotReloader", () => {
  it("should create hot reloader", () => {
    const reloader = createHotReloader(CONFIG_PATH, { debug: false });
    expect(reloader).toBeInstanceOf(HotReloader);
  });
});
