/**
 * ANP 错误报告处理器
 *
 * 实现错误报告的 ANP 协议适配
 * 支持错误传递和恢复建议
 *
 * @module interagent/error
 * @version 1.0.0
 */

import type {
  ErrorReportPayload,
  ANPMessage,
  ANPMessageType,
} from "../../anp/types.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 错误严重级别 */
export type ErrorSeverity = "warning" | "error" | "critical";

/** 错误恢复建议 */
export interface RecoverySuggestion {
  /** 建议的操作 */
  action: string;
  /** 优先级 */
  priority: "low" | "medium" | "high";
  /** 预期结果 */
  expectedOutcome?: string;
}

/** 错误上下文 */
export interface ErrorContext {
  /** 任务 ID */
  taskId: string;
  /** 错误发生的阶段 */
  phase?: string;
  /** 相关的文件路径 */
  files?: string[];
  /** 相关的函数/模块 */
  modules?: string[];
  /** 堆栈跟踪 */
  stackTrace?: string;
  /** 额外的上下文数据 */
  metadata?: Record<string, unknown>;
}

/** 错误报告选项 */
export interface ErrorReportOptions {
  /** 是否包含堆栈跟踪 */
  includeStackTrace?: boolean;
  /** 自定义恢复建议 */
  customSuggestions?: RecoverySuggestion[];
  /** 错误相关文件 */
  relatedFiles?: string[];
  /** 错误相关模块 */
  relatedModules?: string[];
}

// ============================================================================
// 错误处理器
// ============================================================================

/**
 * ANP 错误报告处理器
 *
 * 功能:
 * - 创建标准化错误报告
 * - 生成错误恢复建议
 * - 序列化/反序列化错误消息
 * - 错误分类和分析
 */
export class ErrorHandler {
  /** 错误代码映射 */
  private static readonly ERROR_CODES: Record<string, string> = {
    // 通用错误
    UNKNOWN_ERROR: "ANP_ERR_0001",
    INVALID_INPUT: "ANP_ERR_0002",
    TIMEOUT: "ANP_ERR_0003",
    NOT_FOUND: "ANP_ERR_0004",

    // 任务相关错误
    TASK_FAILED: "ANP_ERR_1001",
    TASK_TIMEOUT: "ANP_ERR_1002",
    TASK_CANCELLED: "ANP_ERR_1003",

    // 网络相关错误
    NETWORK_ERROR: "ANP_ERR_2001",
    CONNECTION_FAILED: "ANP_ERR_2002",
    ENCRYPTION_FAILED: "ANP_ERR_2003",

    // 资源相关错误
    OUT_OF_MEMORY: "ANP_ERR_3001",
    DISK_FULL: "ANP_ERR_3002",
    QUOTA_EXCEEDED: "ANP_ERR_3003",

    // 协议相关错误
    PROTOCOL_ERROR: "ANP_ERR_4001",
    INVALID_MESSAGE: "ANP_ERR_4002",
    VERSION_MISMATCH: "ANP_ERR_4003",
  };

  /**
   * 创建错误报告负载
   */
  createErrorReport(
    taskId: string,
    message: string,
    severity: ErrorSeverity,
    recoverable: boolean,
    options?: ErrorReportOptions
  ): ErrorReportPayload {
    const errorCode = this.inferErrorCode(message, severity);
    const context = this.buildErrorContext(taskId, options);
    const suggestion = this.generateSuggestion(errorCode, severity, options);

    return {
      "@type": "anp:ErrorReport",
      "anp:taskId": taskId,
      "anp:severity": severity,
      "anp:errorCode": errorCode,
      "anp:message": message,
      "anp:context": context,
      "anp:recoverable": recoverable,
      "anp:suggestedAction": suggestion,
    };
  }

  /**
   * 从异常创建错误报告
   */
  createErrorFromException(
    taskId: string,
    error: Error | unknown,
    severity: ErrorSeverity = "error",
    options?: ErrorReportOptions
  ): ErrorReportPayload {
    const message = error instanceof Error ? error.message : String(error);
    const stackTrace = error instanceof Error ? error.stack : undefined;

    // 包含堆栈跟踪
    const enhancedOptions: ErrorReportOptions = {
      ...options,
      includeStackTrace: true,
    };

    const report = this.createErrorReport(
      taskId,
      message,
      severity,
      this.isRecoverable(error),
      enhancedOptions
    );

    // 添加堆栈跟踪到上下文
    if (stackTrace) {
      report["anp:context"].stackTrace = stackTrace;
    }

    return report;
  }

  /**
   * 推断错误代码
   */
  private inferErrorCode(message: string, severity: ErrorSeverity): string {
    const upperMessage = message.toUpperCase();

    // 检查常见错误模式
    if (upperMessage.includes("TIMEOUT") || upperMessage.includes("超时")) {
      return ErrorHandler.ERROR_CODES.TIMEOUT;
    }
    if (upperMessage.includes("NOT FOUND") || upperMessage.includes("未找到")) {
      return ErrorHandler.ERROR_CODES.NOT_FOUND;
    }
    if (upperMessage.includes("NETWORK") || upperMessage.includes("网络")) {
      return ErrorHandler.ERROR_CODES.NETWORK_ERROR;
    }
    if (upperMessage.includes("CONNECTION") || upperMessage.includes("连接")) {
      return ErrorHandler.ERROR_CODES.CONNECTION_FAILED;
    }
    if (upperMessage.includes("ENCRYPT") || upperMessage.includes("加密")) {
      return ErrorHandler.ERROR_CODES.ENCRYPTION_FAILED;
    }
    if (upperMessage.includes("MEMORY") || upperMessage.includes("内存")) {
      return ErrorHandler.ERROR_CODES.OUT_OF_MEMORY;
    }
    if (upperMessage.includes("DISK") || upperMessage.includes("磁盘")) {
      return ErrorHandler.ERROR_CODES.DISK_FULL;
    }
    if (upperMessage.includes("QUOTA") || upperMessage.includes("配额")) {
      return ErrorHandler.ERROR_CODES.QUOTA_EXCEEDED;
    }
    if (upperMessage.includes("PROTOCOL") || upperMessage.includes("协议")) {
      return ErrorHandler.ERROR_CODES.PROTOCOL_ERROR;
    }
    if (upperMessage.includes("VERSION") || upperMessage.includes("版本")) {
      return ErrorHandler.ERROR_CODES.VERSION_MISMATCH;
    }

    // 根据严重级别返回默认代码
    return severity === "critical"
      ? ErrorHandler.ERROR_CODES.TASK_FAILED
      : ErrorHandler.ERROR_CODES.UNKNOWN_ERROR;
  }

  /**
   * 构建错误上下文
   */
  private buildErrorContext(
    taskId: string,
    options?: ErrorReportOptions
  ): ErrorContext["anp:context"] {
    const context: ErrorContext["anp:context"] = {
      taskId,
      timestamp: new Date().toISOString(),
    };

    if (options?.includeStackTrace) {
      context.stackTrace = new Error().stack;
    }

    if (options?.relatedFiles?.length) {
      context.files = options.relatedFiles;
    }

    if (options?.relatedModules?.length) {
      context.modules = options.relatedModules;
    }

    if (options?.phase) {
      context.phase = options.phase;
    }

    return context as Record<string, unknown>;
  }

  /**
   * 生成恢复建议
   */
  private generateSuggestion(
    errorCode: string,
    severity: ErrorSeverity,
    options?: ErrorReportOptions
  ): string {
    // 使用自定义建议
    if (options?.customSuggestions?.length) {
      const suggestion = options.customSuggestions[0];
      return `${suggestion.action} (优先级: ${suggestion.priority})`;
    }

    // 根据错误代码生成建议
    const suggestions: Record<string, string> = {
      [ErrorHandler.ERROR_CODES.TIMEOUT]: "增加超时时间或检查网络连接",
      [ErrorHandler.ERROR_CODES.NOT_FOUND]: "验证资源路径是否正确",
      [ErrorHandler.ERROR_CODES.NETWORK_ERROR]: "检查网络连接并重试",
      [ErrorHandler.ERROR_CODES.CONNECTION_FAILED]: "验证目标服务是否可用",
      [ErrorHandler.ERROR_CODES.ENCRYPTION_FAILED]: "检查加密密钥配置",
      [ErrorHandler.ERROR_CODES.OUT_OF_MEMORY]: "减少并发任务或增加内存",
      [ErrorHandler.ERROR_CODES.DISK_FULL]: "清理磁盘空间",
      [ErrorHandler.ERROR_CODES.QUOTA_EXCEEDED]: "等待配额重置或升级计划",
      [ErrorHandler.ERROR_CODES.PROTOCOL_ERROR]: "验证协议版本兼容性",
      [ErrorHandler.ERROR_CODES.INVALID_MESSAGE]: "检查消息格式是否符合规范",
      [ErrorHandler.ERROR_CODES.VERSION_MISMATCH]: "更新到兼容的版本",
      [ErrorHandler.ERROR_CODES.TASK_FAILED]: "查看详细日志以获取更多信息",
    };

    return (
      suggestions[errorCode] ||
      "检查日志以获取更多详细信息,必要时联系支持团队"
    );
  }

  /**
   * 判断错误是否可恢复
   */
  private isRecoverable(error: Error | unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      // 可恢复的错误模式 (英文 + 中文)
      const recoverablePatterns = [
        "timeout",
        "network",
        "connection",
        "temporary",
        "retry",
        // 中文模式
        "超时",
        "网络",
        "连接",
        "临时",
        "重试",
      ];

      return recoverablePatterns.some((pattern) =>
        message.includes(pattern)
      );
    }

    return false;
  }

  /**
   * 解析错误报告
   */
  parseErrorReport(payload: ErrorReportPayload): {
    taskId: string;
    severity: ErrorSeverity;
    errorCode: string;
    message: string;
    recoverable: boolean;
    suggestion: string;
  } {
    return {
      taskId: payload["anp:taskId"],
      severity: payload["anp:severity"],
      errorCode: payload["anp:errorCode"],
      message: payload["anp:message"],
      recoverable: payload["anp:recoverable"],
      suggestion: payload["anp:suggestedAction"] || "无可用建议",
    };
  }

  /**
   * 格式化错误报告为可读文本
   */
  formatErrorReport(payload: ErrorReportPayload): string {
    const parsed = this.parseErrorReport(payload);
    const severityEmoji = {
      warning: "⚠️",
      error: "❌",
      critical: "🚨",
    };

    return [
      `${severityEmoji[parsed.severity]} 错误报告`,
      `任务 ID: ${parsed.taskId}`,
      `严重级别: ${parsed.severity}`,
      `错误代码: ${parsed.errorCode}`,
      `消息: ${parsed.message}`,
      `可恢复: ${parsed.recoverable ? "是" : "否"}`,
      `建议: ${parsed.suggestion}`,
    ].join("\n");
  }

  /**
   * 创建完整的 ANP 错误消息
   */
  createErrorMessage(
    actor: string,
    target: string,
    taskId: string,
    message: string,
    severity: ErrorSeverity,
    recoverable: boolean,
    options?: ErrorReportOptions
  ): Omit<ANPMessage, "id" | "timestamp" | "signature"> {
    const payload = this.createErrorReport(
      taskId,
      message,
      severity,
      recoverable,
      options
    );

    return {
      "@context": ["https://www.w3.org/ns/activitystreams/v1", "https://w3id.org/anp/v1"],
      "@type": "ANPMessage",
      actor,
      target,
      type: "ErrorEvent",
      object: payload,
    };
  }

  /**
   * 获取错误代码列表
   */
  getErrorCodes(): Record<string, string> {
    return { ...ErrorHandler.ERROR_CODES };
  }

  /**
   * 验证错误报告
   */
  validateErrorReport(payload: ErrorReportPayload): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!payload["anp:taskId"]) {
      errors.push("缺少 taskId");
    }

    if (!payload["anp:errorCode"]) {
      errors.push("缺少 errorCode");
    }

    if (!payload["anp:message"]) {
      errors.push("缺少 message");
    }

    const validSeverities: ErrorSeverity[] = ["warning", "error", "critical"];
    if (!validSeverities.includes(payload["anp:severity"])) {
      errors.push(`无效的 severity: ${payload["anp:severity"]}`);
    }

    if (typeof payload["anp:recoverable"] !== "boolean") {
      errors.push("recoverable 必须是布尔值");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// ============================================================================
// 错误恢复策略生成器
// ============================================================================

/**
 * 错误恢复策略
 */
export class ErrorRecoveryStrategy {
  private handler: ErrorHandler;

  constructor() {
    this.handler = new ErrorHandler();
  }

  /**
   * 生成重试策略
   */
  generateRetryStrategy(
    maxRetries: number = 3,
    backoffMs: number = 1000
  ): RecoverySuggestion {
    return {
      action: `重试操作 (最多 ${maxRetries} 次, 退避 ${backoffMs}ms)`,
      priority: "medium",
      expectedOutcome: "操作在重试后成功",
    };
  }

  /**
   * 生成回退策略
   */
  generateFallbackStrategy(fallbackAction: string): RecoverySuggestion {
    return {
      action: `执行回退操作: ${fallbackAction}`,
      priority: "high",
      expectedOutcome: "使用替代方案完成操作",
    };
  }

  /**
   * 生成升级策略
   */
  generateEscalationStrategy(
    escalateTo: string,
    reason: string
  ): RecoverySuggestion {
    return {
      action: `升级到 ${escalateTo}: ${reason}`,
      priority: "high",
      expectedOutcome: "获得更高级别的支持或干预",
    };
  }

  /**
   * 为错误类型生成默认恢复策略
   */
  generateDefaultStrategy(errorCode: string): RecoverySuggestion[] {
    const strategies: Record<string, RecoverySuggestion[]> = {
      [ErrorHandler.ERROR_CODES.TIMEOUT]: [
        this.generateRetryStrategy(3, 2000),
        {
          action: "检查网络连接稳定性",
          priority: "medium",
        },
      ],
      [ErrorHandler.ERROR_CODES.NETWORK_ERROR]: [
        this.generateRetryStrategy(5, 1000),
        {
          action: "验证目标服务可用性",
          priority: "high",
        },
      ],
      [ErrorHandler.ERROR_CODES.CONNECTION_FAILED]: [
        this.generateRetryStrategy(3, 5000),
        this.generateFallbackStrategy("使用备用连接"),
      ],
      [ErrorHandler.ERROR_CODES.OUT_OF_MEMORY]: [
        {
          action: "减少并发任务数量",
          priority: "high",
          expectedOutcome: "降低内存使用",
        },
        {
          action: "增加可用内存",
          priority: "medium",
        },
      ],
      [ErrorHandler.ERROR_CODES.QUOTA_EXCEEDED]: [
        {
          action: "等待配额重置",
          priority: "low",
        },
        this.generateEscalationStrategy("管理员", "请求增加配额"),
      ],
    };

    return (
      strategies[errorCode] || [
        {
          action: "查看详细日志",
          priority: "low",
        },
        this.generateEscalationStrategy("技术支持", "无法自动恢复"),
      ]
    );
  }
}

// ============================================================================
// 导出
// ============================================================================

export * from "../../anp/types.js";
