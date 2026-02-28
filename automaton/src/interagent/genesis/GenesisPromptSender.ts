/**
 * Genesis Prompt ANP 发送器
 * 将 Genesis Prompt 转换为 ANP 消息格式并发送
 *
 * @module interagent/genesis/GenesisPromptSender
 * @version 1.0.0
 */

import { ulid } from "ulid";
import type {
  GenesisPrompt,
  GenesisPromptResponse,
  GenesisResult,
} from "../../interagent/genesis-prompt.js";
import type {
  ANPMessage,
  GenesisPromptPayload,
  ANPSignature,
} from "../../anp/types.js";
import { signPayload } from "../../anp/signature.js";
import { AUTOMATON_DID, DEFAULT_CONTEXT } from "../../anp/types.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 发送器配置 */
export interface GenesisPromptSenderConfig {
  /** 本地 DID */
  did?: string;
  /** 私钥 (PEM 格式) */
  privateKey: string;
  /** 目标 DID */
  targetDid: string;
  /** 服务端点 */
  serviceEndpoint: string;
  /** 默认 TTL (秒) */
  defaultTtl?: number;
}

/** 发送结果 */
export interface SendResult {
  success: boolean;
  messageId: string;
  error?: string;
  response?: GenesisPromptResponse;
}

// ============================================================================
// GenesisPromptSender
// ============================================================================

/**
 * Genesis Prompt ANP 发送器
 *
 * 功能:
 * - 将 Genesis Prompt 转换为 ANP 消息
 * - 签名并发送消息
 * - 处理响应
 */
export class GenesisPromptSender {
  private config: GenesisPromptSenderConfig;
  private privateKey: string;

  constructor(config: GenesisPromptSenderConfig) {
    this.config = {
      did: config.did || AUTOMATON_DID,
      targetDid: config.targetDid,
      privateKey: config.privateKey,
      serviceEndpoint: config.serviceEndpoint,
      defaultTtl: config.defaultTtl || 3600,
    };
    this.privateKey = config.privateKey;
  }

  // ========================================================================
  // 消息转换
  // ========================================================================

  /**
   * 将 Genesis Prompt 转换为 ANP 消息负载
   */
  private convertToANPPayload(prompt: GenesisPrompt): GenesisPromptPayload {
    const payload: GenesisPromptPayload = {
      "@type": "genesis:GenesisPrompt",
      "genesis:projectId": prompt.id,
      "genesis:platform": "anp",
      "genesis:requirementSummary": prompt.input.description,
      "genesis:technicalConstraints": this.convertTechnicalConstraints(
        prompt.technical
      ),
      "genesis:contractTerms": this.convertContractTerms(prompt.business),
      "genesis:resourceLimits": this.convertResourceLimits(prompt),
    };

    // 添加特殊指令 (可选)
    if (prompt.priority || prompt.tags) {
      payload["genesis:specialInstructions"] = {
        "genesis:priorityLevel": this.mapPriorityToLevel(prompt.priority),
        "genesis:riskFlags": prompt.tags || [],
        "genesis:humanReviewRequired": prompt.requireConfirmation || false,
      };
    }

    return payload;
  }

  /**
   * 转换技术约束
   */
  private convertTechnicalConstraints(
    technical?: GenesisPrompt["technical"]
  ): GenesisPromptPayload["genesis:technicalConstraints"] {
    const constraints: GenesisPromptPayload["genesis:technicalConstraints"] = {
      "@type": "genesis:TechnicalConstraints",
    };

    if (technical?.allowedLanguages) {
      constraints["genesis:requiredStack"] = technical.allowedLanguages;
    }

    if (technical?.forbiddenLibraries) {
      constraints["genesis:prohibitedStack"] = technical.forbiddenLibraries;
    }

    if (technical?.codeStyle) {
      // 可以根据需要添加更多平台映射
      if (technical.codeStyle.rules?.targetPlatform) {
        constraints["genesis:targetPlatform"] =
          technical.codeStyle.rules.targetPlatform as string;
      }
    }

    return constraints;
  }

  /**
   * 转换合同条款
   */
  private convertContractTerms(
    business?: GenesisPrompt["business"]
  ): GenesisPromptPayload["genesis:contractTerms"] {
    const terms: GenesisPromptPayload["genesis:contractTerms"] = {
      "@type": "genesis:ContractTerms",
      "genesis:totalBudget": {
        "@type": "schema:MonetaryAmount",
        "schema:value": business?.budget?.total || 0,
        "schema:currency": business?.budget?.currency || "USD",
      },
      "genesis:deadline": business?.timeline?.deadline
        ? new Date(business.timeline.deadline).toISOString()
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      "genesis:milestones": [],
    };

    // 添加里程碑 (如果有的话)
    if (business?.delivery?.documentation) {
      const milestonePercentage = business.delivery.documentation === "comprehensive" ? 100 : 50;
      terms["genesis:milestones"] = [
        {
          "@type": "genesis:Milestone",
          "genesis:name": "completion",
          "genesis:percentage": milestonePercentage,
          "genesis:dueDate": terms["genesis:deadline"],
        },
      ];
    }

    return terms;
  }

  /**
   * 转换资源限制
   */
  private convertResourceLimits(
    prompt: GenesisPrompt
  ): GenesisPromptPayload["genesis:resourceLimits"] {
    return {
      "@type": "genesis:ResourceLimits",
      "genesis:maxTokensPerTask":
        prompt.technical?.performance?.maxExecutionTimeMs
          ? prompt.technical.performance.maxExecutionTimeMs * 10
          : 1000000,
      "genesis:maxCostCents":
        prompt.business?.budget?.total
          ? Math.floor(prompt.business.budget.total * 100)
          : 15000,
      "genesis:maxDurationMs": prompt.timeoutMs || 86400000,
    };
  }

  /**
   * 映射优先级到级别
   */
  private mapPriorityToLevel(
    priority: GenesisPrompt["priority"]
  ): "low" | "normal" | "high" {
    if (priority === "critical" || priority === "high") {
      return "high";
    } else if (priority === "low" || priority === "background") {
      return "low";
    }
    return "normal";
  }

  // ========================================================================
  // 消息构建
  // ========================================================================

  /**
   * 构建 ANP 消息
   */
  async buildANPMessage(prompt: GenesisPrompt): Promise<ANPMessage> {
    const payload = this.convertToANPPayload(prompt);

    // 创建签名
    const signature: ANPSignature = await signPayload(
      payload,
      this.privateKey,
      this.config.did!
    );

    const message: ANPMessage = {
      "@context": [
        ...DEFAULT_CONTEXT,
        {
          genesis: "https://w3id.org/anp/genesis#",
        },
      ],
      "@type": "ANPMessage",
      id: ulid(),
      timestamp: new Date().toISOString(),
      actor: this.config.did!,
      target: this.config.targetDid,
      type: "TaskCreate",
      object: payload,
      signature,
      correlationId: prompt.id,
      ttl: this.config.defaultTtl,
    };

    return message;
  }

  // ========================================================================
  // 消息发送
  // ========================================================================

  /**
   * 发送 Genesis Prompt
   */
  async send(prompt: GenesisPrompt): Promise<SendResult> {
    try {
      // 构建 ANP 消息
      const message = await this.buildANPMessage(prompt);

      // 发送到目标端点
      const response = await fetch(this.config.serviceEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        return {
          success: false,
          messageId: message.id,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const responseData = await response.json();

      // 解析响应
      const promptResponse: GenesisPromptResponse = {
        id: responseData.id || ulid(),
        promptId: prompt.id,
        status: responseData.status || "accepted",
        respondedAt: new Date(responseData.respondedAt || Date.now()),
        acceptance: responseData.acceptance,
        rejection: responseData.rejection,
        deferral: responseData.deferral,
      };

      return {
        success: true,
        messageId: message.id,
        response: promptResponse,
      };
    } catch (error) {
      return {
        success: false,
        messageId: "",
        error:
          error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 批量发送 Genesis Prompts
   */
  async sendBatch(prompts: GenesisPrompt[]): Promise<SendResult[]> {
    const results: SendResult[] = [];

    for (const prompt of prompts) {
      const result = await this.send(prompt);
      results.push(result);
    }

    return results;
  }

  // ========================================================================
  // 响应处理
  // ========================================================================

  /**
   * 处理执行结果
   */
  async handleResult(result: GenesisResult): Promise<void> {
    // 这里可以实现结果存储、通知等逻辑
    console.log(`[GenesisPromptSender] Task ${result.promptId} completed:`, result.status);

    if (result.status === "success") {
      console.log(`[GenesisPromptSender] Output:`, result.output);
    } else if (result.status === "failed") {
      console.error(`[GenesisPromptSender] Error:`, result.error);
    }
  }

  // ========================================================================
  // 验证工具
  // ========================================================================

  /**
   * 验证消息格式
   */
  private validateMessage(message: ANPMessage): boolean {
    if (!message.id || !message.timestamp || !message.actor || !message.target) {
      return false;
    }

    if (!message.object || !message.signature) {
      return false;
    }

    if (message.object["@type"] !== "genesis:GenesisPrompt") {
      return false;
    }

    return true;
  }

  /**
   * 获取发送统计
   */
  getStats(): {
    sentCount: number;
    successCount: number;
    failureCount: number;
  } {
    // 这里可以实现统计功能
    return {
      sentCount: 0,
      successCount: 0,
      failureCount: 0,
    };
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 Genesis Prompt 发送器
 */
export function createGenesisPromptSender(
  config: GenesisPromptSenderConfig
): GenesisPromptSender {
  return new GenesisPromptSender(config);
}
