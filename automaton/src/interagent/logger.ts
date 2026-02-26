/**
 * 结构化日志模块
 *
 * @module interagent/logger
 * @description 使用 Pino 实现结构化 JSON 日志，支持 ELK 集成
 */

import pino, { Logger, LoggerOptions } from "pino";

// ============================================================================
// 类型定义
// ============================================================================

/** 日志级别 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** 日志上下文 */
export interface LogContext {
  /** 模块名称 */
  module?: string;
  /** 请求/追踪 ID */
  traceId?: string;
  /** DID 标识符 */
  did?: string;
  /** 任务 ID */
  taskId?: string;
  /** 操作类型 */
  operation?: string;
  /** 额外元数据 */
  [key: string]: unknown;
}

/** 日志配置 */
export interface LoggerConfig {
  /** 服务名称 */
  service: string;
  /** 日志级别 */
  level?: LogLevel;
  /** 是否美化输出 (开发模式) */
  pretty?: boolean;
  /** 是否包含 hostname */
  includeHostname?: boolean;
  /** 自定义字段 */
  base?: Record<string, unknown>;
}

// ============================================================================
// 默认配置
// ============================================================================

const isDevelopment = process.env.NODE_ENV !== "production";
const defaultLevel = (process.env.LOG_LEVEL as LogLevel) || (isDevelopment ? "debug" : "info");

// ============================================================================
// 创建日志器
// ============================================================================

let rootLogger: Logger | null = null;

/**
 * 创建根日志器
 */
export function createLogger(config: LoggerConfig): Logger {
  const {
    service,
    level = defaultLevel,
    pretty = isDevelopment,
    includeHostname = true,
    base = {},
  } = config;

  const options: LoggerOptions = {
    level,
    name: service,

    // 基础字段
    base: {
      service,
      version: process.env.npm_package_version || "1.0.0",
      env: process.env.NODE_ENV || "development",
      ...(includeHostname && { hostname: require("os").hostname() }),
      ...base,
    },

    // 时间戳格式
    timestamp: pino.stdTimeFunctions.isoTime,

    // 格式化器
    formatters: {
      level: (label) => ({ level: label.toUpperCase() }),
      bindings: (bindings) => ({
        pid: bindings.pid,
      }),
    },

    // 序列化错误
    serializers: {
      error: pino.stdSerializers.err,
      request: pino.stdSerializers.req,
      response: pino.stdSerializers.res,
    },
  };

  // 开发模式使用美化输出
  if (pretty) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
          ignore: "pid,hostname",
        },
      },
    });
  }

  return pino(options);
}

/**
 * 获取根日志器
 */
export function getLogger(config?: Partial<LoggerConfig>): Logger {
  if (!rootLogger) {
    rootLogger = createLogger({
      service: "automaton",
      ...config,
    });
  }
  return rootLogger;
}

/**
 * 创建子日志器
 */
export function createChildLogger(context: LogContext): Logger {
  const logger = getLogger();
  return logger.child(context);
}

// ============================================================================
// 便捷方法
// ============================================================================

/**
 * 创建模块日志器
 */
export function moduleLogger(module: string, baseContext?: LogContext): Logger {
  return createChildLogger({ module, ...baseContext });
}

/**
 * 创建请求日志器 (带 traceId)
 */
export function requestLogger(traceId: string, context?: LogContext): Logger {
  return createChildLogger({ traceId, ...context });
}

/**
 * 创建任务日志器
 */
export function taskLogger(taskId: string, context?: LogContext): Logger {
  return createChildLogger({ taskId, module: "task", ...context });
}

// ============================================================================
// 日志辅助函数
// ============================================================================

/**
 * 记录操作开始
 */
export function logOperationStart(
  logger: Logger,
  operation: string,
  context?: LogContext
): number {
  const startTime = Date.now();
  logger.info({ operation, ...context }, `${operation} started`);
  return startTime;
}

/**
 * 记录操作完成
 */
export function logOperationEnd(
  logger: Logger,
  operation: string,
  startTime: number,
  context?: LogContext
): void {
  const durationMs = Date.now() - startTime;
  logger.info({ operation, durationMs, ...context }, `${operation} completed`);
}

/**
 * 记录操作错误
 */
export function logOperationError(
  logger: Logger,
  operation: string,
  error: Error,
  context?: LogContext
): void {
  logger.error({ operation, error, ...context }, `${operation} failed: ${error.message}`);
}

// ============================================================================
// 导出默认日志器
// ============================================================================

export default getLogger;
