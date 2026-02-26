/**
 * 配置热更新模块
 * 实现配置热更新，无需重启服务
 *
 * @module interagent.config.hot-reload
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import { watch, FSWatcher, readFileSync } from "fs";
import { access, readFile } from "fs/promises";

// ============================================================================
// Types
// ============================================================================

/**
 * 配置值类型
 */
export type ConfigValue = string | number | boolean | null | object | ConfigValue[];

/**
 * 配置对象
 */
export type ConfigObject = Record<string, ConfigValue>;

/**
 * 配置变更事件
 */
export interface ConfigChangeEvent {
  /** 变更的键 */
  key: string;
  /** 旧值 */
  oldValue: ConfigValue;
  /** 新值 */
  newValue: ConfigValue;
  /** 变更时间 */
  timestamp: Date;
}

/**
 * 配置重载事件
 */
export interface ConfigReloadEvent {
  /** 旧配置 */
  oldConfig: ConfigObject;
  /** 新配置 */
  newConfig: ConfigObject;
  /** 版本号 */
  version: number;
  /** 变更列表 */
  changes: ConfigChangeEvent[];
}

/**
 * 热加载器选项
 */
export interface HotReloaderOptions {
  /** 配置文件路径 */
  configPath: string;
  /** 初始配置 */
  initialConfig?: ConfigObject;
  /** 防抖延迟 (毫秒) */
  debounceDelay?: number;
  /** 最大历史版本数 */
  maxHistorySize?: number;
  /** 配置解析器 */
  parser?: (content: string) => ConfigObject;
}

/**
 * 热加载器状态
 */
export interface HotReloaderStats {
  /** 当前版本 */
  version: number;
  /** 历史版本数 */
  historySize: number;
  /** 总重载次数 */
  totalReloads: number;
  /** 是否正在监听 */
  isWatching: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DEBOUNCE_DELAY = 100; // 100ms
const DEFAULT_MAX_HISTORY_SIZE = 10;

// ============================================================================
// HotReloader Class
// ============================================================================

/**
 * 配置热加载器
 *
 * 监听配置文件变更，自动重载配置，支持版本管理和回滚
 *
 * @example
 * ```typescript
 * const reloader = new HotReloader({
 *   configPath: './config.json',
 *   initialConfig: { debug: false },
 * });
 *
 * reloader.on('change', (event) => {
 *   console.log(`Config changed: ${event.key}`);
 * });
 *
 * reloader.start();
 *
 * // 回滚到上一版本
 * reloader.rollback();
 * ```
 */
export class HotReloader extends EventEmitter {
  private config: ConfigObject;
  private configPath: string;
  private watcher: FSWatcher | null = null;
  private version: number = 0;
  private history: Map<number, ConfigObject> = new Map();
  private debounceDelay: number;
  private maxHistorySize: number;
  private parser: (content: string) => ConfigObject;
  private reloadTimeout: NodeJS.Timeout | null = null;
  private totalReloads: number = 0;

  constructor(options: HotReloaderOptions) {
    super();
    this.configPath = options.configPath;
    this.config = options.initialConfig || {};
    this.debounceDelay = options.debounceDelay ?? DEFAULT_DEBOUNCE_DELAY;
    this.maxHistorySize = options.maxHistorySize ?? DEFAULT_MAX_HISTORY_SIZE;
    this.parser = options.parser || this.defaultParser;
  }

  /**
   * 默认配置解析器
   */
  private defaultParser(content: string): ConfigObject {
    try {
      return JSON.parse(content);
    } catch {
      throw new Error("Failed to parse config as JSON");
    }
  }

  /**
   * 开始监听配置文件
   */
  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.configPath, (eventType) => {
        if (eventType === "change") {
          this.scheduleReload();
        }
      });

      this.watcher.on("error", (error) => {
        this.emit("error", error);
      });

      this.emit("started");
    } catch (error) {
      this.emit("error", error);
    }
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.emit("stopped");
    }

    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
      this.reloadTimeout = null;
    }
  }

  /**
   * 调度重载（带防抖）
   */
  private scheduleReload(): void {
    if (this.reloadTimeout) {
      clearTimeout(this.reloadTimeout);
    }

    this.reloadTimeout = setTimeout(() => {
      this.reload();
      this.reloadTimeout = null;
    }, this.debounceDelay);
  }

  /**
   * 手动重载配置
   */
  async reload(): Promise<boolean> {
    try {
      const content = await readFile(this.configPath, "utf-8");
      const newConfig = this.parser(content);
      const changes = this.diffConfigs(this.config, newConfig);

      if (changes.length > 0) {
        // 保存当前配置到历史
        this.saveToHistory();

        const oldConfig = { ...this.config };
        this.config = newConfig;
        this.version++;

        // 触发变更事件
        for (const change of changes) {
          this.emit("change", change);
        }

        this.emit("reloaded", {
          oldConfig,
          newConfig,
          version: this.version,
          changes,
        } as ConfigReloadEvent);

        this.totalReloads++;
        return true;
      }

      return false;
    } catch (error) {
      this.emit("error", error);
      return false;
    }
  }

  /**
   * 保存配置到历史
   */
  private saveToHistory(): void {
    this.history.set(this.version, { ...this.config });

    // 清理过旧的历史
    if (this.history.size > this.maxHistorySize) {
      const oldestKey = Math.min(...this.history.keys());
      this.history.delete(oldestKey);
    }
  }

  /**
   * 比较配置差异
   */
  private diffConfigs(
    old: ConfigObject,
    newConfig: ConfigObject
  ): ConfigChangeEvent[] {
    const changes: ConfigChangeEvent[] = [];
    const allKeys = new Set([...Object.keys(old), ...Object.keys(newConfig)]);
    const timestamp = new Date();

    for (const key of allKeys) {
      const oldValue = old[key];
      const newValue = newConfig[key];

      if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        changes.push({
          key,
          oldValue: oldValue ?? null,
          newValue: newValue ?? null,
          timestamp,
        });
      }
    }

    return changes;
  }

  /**
   * 回滚到指定版本
   */
  rollback(targetVersion?: number): boolean {
    const version = targetVersion ?? this.version - 1;
    const config = this.history.get(version);

    if (!config) {
      return false;
    }

    const oldConfig = { ...this.config };
    this.config = { ...config };

    // 保存回滚前的配置
    this.saveToHistory();
    this.version++;

    this.emit("rollback", {
      fromVersion: version,
      toVersion: this.version,
      oldConfig,
      newConfig: this.config,
    });

    return true;
  }

  /**
   * 获取当前配置
   */
  getConfig(): Readonly<ConfigObject> {
    return { ...this.config };
  }

  /**
   * 获取配置值
   */
  get<T extends ConfigValue = ConfigValue>(key: string): T | undefined {
    return this.config[key] as T | undefined;
  }

  /**
   * 设置配置值（运行时，不持久化）
   */
  set(key: string, value: ConfigValue): void {
    const oldValue = this.config[key];
    this.config[key] = value;

    this.emit("change", {
      key,
      oldValue,
      newValue: value,
      timestamp: new Date(),
    });
  }

  /**
   * 获取版本历史
   */
  getHistory(): Map<number, Readonly<ConfigObject>> {
    return new Map(this.history);
  }

  /**
   * 获取当前版本
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * 获取统计信息
   */
  getStats(): HotReloaderStats {
    return {
      version: this.version,
      historySize: this.history.size,
      totalReloads: this.totalReloads,
      isWatching: this.watcher !== null,
    };
  }

  /**
   * 是否正在监听
   */
  isWatching(): boolean {
    return this.watcher !== null;
  }

  /**
   * 清空历史
   */
  clearHistory(): void {
    this.history.clear();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * 创建热加载器
 */
export function createHotReloader(
  configPath: string,
  initialConfig?: ConfigObject,
  options?: Partial<HotReloaderOptions>
): HotReloader {
  return new HotReloader({
    configPath,
    initialConfig,
    ...options,
  });
}

// ============================================================================
// Default Export
// ============================================================================

export default HotReloader;
