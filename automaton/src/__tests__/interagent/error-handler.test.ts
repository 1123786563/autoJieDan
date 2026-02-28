/**
 * ANP 错误报告处理器测试
 *
 * 测试错误传递和恢复建议
 *
 * @module tests/interagent/error-handler
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ErrorHandler,
  ErrorRecoveryStrategy,
} from "../../interagent/error/index.js";
import type { ErrorReportPayload } from "../../anp/types.js";

describe("ErrorHandler", () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = new ErrorHandler();
  });

  describe("错误报告创建", () => {
    it("应该创建基本错误报告", () => {
      const report = handler.createErrorReport(
        "task-123",
        "测试错误",
        "error",
        true
      );

      expect(report["@type"]).toBe("anp:ErrorReport");
      expect(report["anp:taskId"]).toBe("task-123");
      expect(report["anp:message"]).toBe("测试错误");
      expect(report["anp:severity"]).toBe("error");
      expect(report["anp:recoverable"]).toBe(true);
      expect(report["anp:errorCode"]).toBeDefined();
      expect(report["anp:suggestedAction"]).toBeDefined();
    });

    it("应该从异常创建错误报告", () => {
      const error = new Error("测试异常");
      const report = handler.createErrorFromException(
        "task-456",
        error,
        "critical"
      );

      expect(report["anp:taskId"]).toBe("task-456");
      expect(report["anp:message"]).toBe("测试异常");
      expect(report["anp:severity"]).toBe("critical");
      expect(report["anp:context"].stackTrace).toBeDefined();
    });

    it("应该推断超时错误代码", () => {
      const report = handler.createErrorReport(
        "task-789",
        "操作超时",
        "error",
        true
      );

      expect(report["anp:errorCode"]).toBe("ANP_ERR_0003");
    });

    it("应该推断网络错误代码", () => {
      const report = handler.createErrorReport(
        "task-101",
        "网络连接失败",
        "error",
        true
      );

      expect(report["anp:errorCode"]).toBe("ANP_ERR_2001");
    });

    it("应该推断未找到错误代码", () => {
      const report = handler.createErrorReport(
        "task-102",
        "资源未找到",
        "error",
        false
      );

      expect(report["anp:errorCode"]).toBe("ANP_ERR_0004");
    });
  });

  describe("错误严重级别", () => {
    it("应该创建警告级别错误", () => {
      const report = handler.createErrorReport(
        "task-201",
        "警告消息",
        "warning",
        true
      );

      expect(report["anp:severity"]).toBe("warning");
    });

    it("应该创建错误级别错误", () => {
      const report = handler.createErrorReport(
        "task-202",
        "错误消息",
        "error",
        true
      );

      expect(report["anp:severity"]).toBe("error");
    });

    it("应该创建严重级别错误", () => {
      const report = handler.createErrorReport(
        "task-203",
        "严重错误",
        "critical",
        false
      );

      expect(report["anp:severity"]).toBe("critical");
    });
  });

  describe("错误恢复建议", () => {
    it("应该为超时错误生成建议", () => {
      const report = handler.createErrorReport(
        "task-301",
        "操作超时",
        "error",
        true
      );

      expect(report["anp:suggestedAction"]).toContain("超时");
    });

    it("应该为网络错误生成建议", () => {
      const report = handler.createErrorReport(
        "task-302",
        "网络连接失败",
        "error",
        true
      );

      expect(report["anp:suggestedAction"]).toContain("网络");
    });

    it("应该支持自定义建议", () => {
      const customSuggestion = {
        action: "重启服务",
        priority: "high" as const,
        expectedOutcome: "服务恢复正常",
      };

      const report = handler.createErrorReport(
        "task-303",
        "服务无响应",
        "error",
        true,
        { customSuggestions: [customSuggestion] }
      );

      expect(report["anp:suggestedAction"]).toContain("重启服务");
    });

    it("应该为不可恢复错误生成建议", () => {
      const report = handler.createErrorReport(
        "task-304",
        "严重故障",
        "critical",
        false
      );

      expect(report["anp:recoverable"]).toBe(false);
      expect(report["anp:suggestedAction"]).toBeDefined();
    });
  });

  describe("错误上下文", () => {
    it("应该包含任务 ID", () => {
      const report = handler.createErrorReport(
        "task-401",
        "测试错误",
        "error",
        true
      );

      expect(report["anp:context"].taskId).toBe("task-401");
    });

    it("应该包含时间戳", () => {
      const report = handler.createErrorReport(
        "task-402",
        "测试错误",
        "error",
        true
      );

      expect(report["anp:context"].timestamp).toBeDefined();
    });

    it("应该包含相关文件", () => {
      const report = handler.createErrorReport(
        "task-403",
        "测试错误",
        "error",
        true,
        { relatedFiles: ["/path/to/file.ts", "/path/to/another.ts"] }
      );

      expect(report["anp:context"].files).toEqual([
        "/path/to/file.ts",
        "/path/to/another.ts",
      ]);
    });

    it("应该包含相关模块", () => {
      const report = handler.createErrorReport(
        "task-404",
        "测试错误",
        "error",
        true,
        { relatedModules: ["module1", "module2"] }
      );

      expect(report["anp:context"].modules).toEqual(["module1", "module2"]);
    });

    it("应该包含错误阶段", () => {
      const report = handler.createErrorReport(
        "task-405",
        "测试错误",
        "error",
        true,
        { phase: "execution" }
      );

      expect(report["anp:context"].phase).toBe("execution");
    });

    it("应该包含堆栈跟踪", () => {
      const error = new Error("堆栈测试");
      const report = handler.createErrorFromException(
        "task-406",
        error,
        "error",
        { includeStackTrace: true }
      );

      expect(report["anp:context"].stackTrace).toBeDefined();
    });
  });

  describe("错误解析", () => {
    it("应该解析错误报告", () => {
      const report = handler.createErrorReport(
        "task-501",
        "解析测试",
        "warning",
        true
      );

      const parsed = handler.parseErrorReport(report);

      expect(parsed.taskId).toBe("task-501");
      expect(parsed.message).toBe("解析测试");
      expect(parsed.severity).toBe("warning");
      expect(parsed.recoverable).toBe(true);
      expect(parsed.errorCode).toBeDefined();
      expect(parsed.suggestion).toBeDefined();
    });
  });

  describe("错误格式化", () => {
    it("应该格式化错误报告为可读文本", () => {
      const report = handler.createErrorReport(
        "task-601",
        "格式化测试",
        "error",
        true
      );

      const formatted = handler.formatErrorReport(report);

      expect(formatted).toContain("错误报告");
      expect(formatted).toContain("task-601");
      expect(formatted).toContain("格式化测试");
      expect(formatted).toContain("error");
    });

    it("应该包含严重级别表情符号", () => {
      const warningReport = handler.createErrorReport(
        "task-602",
        "警告",
        "warning",
        true
      );
      const errorReport = handler.createErrorReport(
        "task-603",
        "错误",
        "error",
        true
      );
      const criticalReport = handler.createErrorReport(
        "task-604",
        "严重",
        "critical",
        false
      );

      expect(handler.formatErrorReport(warningReport)).toContain("⚠️");
      expect(handler.formatErrorReport(errorReport)).toContain("❌");
      expect(handler.formatErrorReport(criticalReport)).toContain("🚨");
    });
  });

  describe("ANP 消息创建", () => {
    it("应该创建完整的 ANP 错误消息", () => {
      const message = handler.createErrorMessage(
        "did:anp:agent1",
        "did:anp:agent2",
        "task-701",
        "消息测试",
        "error",
        true
      );

      expect(message["@type"]).toBe("ANPMessage");
      expect(message.actor).toBe("did:anp:agent1");
      expect(message.target).toBe("did:anp:agent2");
      expect(message.type).toBe("ErrorEvent");
      expect(message.object).toBeDefined();
      expect(message.object["@type"]).toBe("anp:ErrorReport");
    });
  });

  describe("错误验证", () => {
    it("应该验证有效的错误报告", () => {
      const report = handler.createErrorReport(
        "task-801",
        "验证测试",
        "error",
        true
      );

      const validation = handler.validateErrorReport(report);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it("应该检测缺少 taskId", () => {
      const invalidReport: ErrorReportPayload = {
        "@type": "anp:ErrorReport",
        "anp:taskId": "",
        "anp:severity": "error",
        "anp:errorCode": "ANP_ERR_0001",
        "anp:message": "测试",
        "anp:context": {},
        "anp:recoverable": true,
      };

      const validation = handler.validateErrorReport(invalidReport);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toContain("缺少 taskId");
    });

    it("应该检测无效的严重级别", () => {
      const invalidReport = {
        "@type": "anp:ErrorReport",
        "anp:taskId": "task-802",
        "anp:severity": "invalid" as any,
        "anp:errorCode": "ANP_ERR_0001",
        "anp:message": "测试",
        "anp:context": {},
        "anp:recoverable": true,
      };

      const validation = handler.validateErrorReport(invalidReport);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("severity"))).toBe(true);
    });
  });

  describe("错误代码", () => {
    it("应该返回所有错误代码", () => {
      const codes = handler.getErrorCodes();

      expect(codes).toBeDefined();
      expect(typeof codes).toBe("object");
      expect(codes["TIMEOUT"]).toBeDefined();
      expect(codes["NETWORK_ERROR"]).toBeDefined();
    });

    it("应该包含预定义的错误代码", () => {
      const codes = handler.getErrorCodes();

      expect(codes["UNKNOWN_ERROR"]).toBe("ANP_ERR_0001");
      expect(codes["INVALID_INPUT"]).toBe("ANP_ERR_0002");
      expect(codes["TIMEOUT"]).toBe("ANP_ERR_0003");
      expect(codes["NOT_FOUND"]).toBe("ANP_ERR_0004");
    });
  });
});

describe("ErrorRecoveryStrategy", () => {
  let strategy: ErrorRecoveryStrategy;

  beforeEach(() => {
    strategy = new ErrorRecoveryStrategy();
  });

  describe("重试策略", () => {
    it("应该生成重试策略", () => {
      const retry = strategy.generateRetryStrategy(3, 2000);

      expect(retry.action).toContain("重试");
      expect(retry.action).toContain("3");
      expect(retry.action).toContain("2000");
      expect(retry.priority).toBe("medium");
      expect(retry.expectedOutcome).toBeDefined();
    });

    it("应该使用默认参数", () => {
      const retry = strategy.generateRetryStrategy();

      expect(retry.action).toContain("3");
      expect(retry.action).toContain("1000");
    });
  });

  describe("回退策略", () => {
    it("应该生成回退策略", () => {
      const fallback = strategy.generateFallbackStrategy("使用缓存");

      expect(fallback.action).toContain("使用缓存");
      expect(fallback.priority).toBe("high");
      expect(fallback.expectedOutcome).toBeDefined();
    });
  });

  describe("升级策略", () => {
    it("应该生成升级策略", () => {
      const escalation = strategy.generateEscalationStrategy(
        "管理员",
        "需要权限"
      );

      expect(escalation.action).toContain("管理员");
      expect(escalation.action).toContain("需要权限");
      expect(escalation.priority).toBe("high");
    });
  });

  describe("默认策略", () => {
    it("应该为超时错误生成默认策略", () => {
      const strategies = strategy.generateDefaultStrategy("ANP_ERR_0003");

      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies[0].action).toContain("重试");
    });

    it("应该为网络错误生成默认策略", () => {
      const strategies = strategy.generateDefaultStrategy("ANP_ERR_2001");

      expect(strategies.length).toBeGreaterThan(0);
    });

    it("应该为内存错误生成默认策略", () => {
      const strategies = strategy.generateDefaultStrategy("ANP_ERR_3001");

      expect(strategies.length).toBeGreaterThan(0);
      const reduceTasks = strategies.find((s) =>
        s.action.includes("减少并发")
      );
      expect(reduceTasks).toBeDefined();
    });

    it("应该为配额错误生成默认策略", () => {
      const strategies = strategy.generateDefaultStrategy("ANP_ERR_3003");

      expect(strategies.length).toBeGreaterThan(0);
      const escalate = strategies.find((s) => s.action.includes("升级"));
      expect(escalate).toBeDefined();
    });

    it("应该为未知错误生成默认策略", () => {
      const strategies = strategy.generateDefaultStrategy("UNKNOWN_CODE");

      expect(strategies.length).toBeGreaterThan(0);
      expect(strategies.some((s) => s.action.includes("日志"))).toBe(true);
    });
  });
});

describe("错误恢复集成测试", () => {
  it("应该完成完整的错误处理流程", () => {
    const handler = new ErrorHandler();
    const strategy = new ErrorRecoveryStrategy();

    // 模拟错误发生
    const error = new Error("操作超时");

    // 创建错误报告
    const report = handler.createErrorFromException(
      "task-integration-1",
      error,
      "error"
    );

    // 验证报告
    expect(report["anp:taskId"]).toBe("task-integration-1");
    expect(report["anp:recoverable"]).toBe(true);

    // 生成恢复策略
    const recoveryStrategies = strategy.generateDefaultStrategy(
      report["anp:errorCode"]
    );

    // 验证策略
    expect(recoveryStrategies.length).toBeGreaterThan(0);

    // 格式化错误报告
    const formatted = handler.formatErrorReport(report);

    // 验证格式化
    expect(formatted).toContain("❌");
    expect(formatted).toContain("task-integration-1");
  });

  it("应该支持错误传递链", () => {
    const handler1 = new ErrorHandler();
    const handler2 = new ErrorHandler();

    // Agent 1 创建错误
    const errorReport1 = handler1.createErrorReport(
      "task-chain-1",
      "初始错误",
      "error",
      true
    );

    // Agent 2 接收并处理错误
    const parsed1 = handler1.parseErrorReport(errorReport1);
    const errorReport2 = handler2.createErrorReport(
      parsed1.taskId,
      `接收到的错误: ${parsed1.message}`,
      "error",
      parsed1.recoverable
    );

    // 验证错误传递
    expect(errorReport2["anp:taskId"]).toBe("task-chain-1");
    expect(errorReport2["anp:message"]).toContain("初始错误");
  });
});
