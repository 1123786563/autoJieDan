/**
 * ANP 协议适配器
 * 处理 ANP 消息的发送、接收和协议协商
 *
 * @module anp/adapter
 * @version 1.0.0
 */

import { EventEmitter } from "events";
import * as crypto from "crypto";
import type {
  ANPMessage,
  ANPPayload,
  ANPSignature,
  NegotiatedProtocol,
  ANPAdapterConfig,
  ProtocolNegotiatePayload,
  ProtocolAcceptPayload,
  ProtocolRejectPayload,
  CapabilityQueryPayload,
  CapabilityResponsePayload,
} from "./types.js";
import {
  signPayload,
  verifySignature,
  verifyMessage,
  createANPMessage,
} from "./signature.js";
import {
  generateKeyPair,
  importPrivateKey,
  importPublicKey,
} from "./did.js";
import { DEFAULT_CONTEXT, AUTOMATON_DID } from "./types.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 协议协商状态 */
export type ProtocolNegotiationState =
  | "idle"           // 空闲，未开始协商
  | "negotiating"    // 协商中
  | "accepted"       // 已接受
  | "rejected"       // 已拒绝
  | "failed";        // 协商失败

/** 协商会话信息 */
interface NegotiationSession {
  sessionId: string;
  peerDid: string;
  state: ProtocolNegotiationState;
  proposedProtocol: string;
  protocolVersion: string;
  capabilities: string[];
  constraints: {
    maxLatency?: number;
    encryptionRequired: boolean;
    compression?: string;
  };
  createdAt: Date;
  lastActivity: Date;
}

// ============================================================================
// ANP 协议适配器
// ============================================================================

/**
 * ANP 协议适配器
 * 负责消息的发送、接收和协议协商
 */
export class ANPAdapter extends EventEmitter {
  private config: ANPAdapterConfig;
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  private negotiationSessions: Map<string, NegotiationSession>;
  private activeProtocols: Map<string, NegotiatedProtocol>;
  private messageHandlers: Map<string, (message: ANPMessage) => Promise<void>>;

  constructor(config: ANPAdapterConfig) {
    super();
    this.config = config;
    this.negotiationSessions = new Map();
    this.activeProtocols = new Map();
    this.messageHandlers = new Map();

    // 加载密钥
    if (typeof config.privateKey === "string") {
      const keyPair = generateKeyPair();
      this.privateKey = importPrivateKey(keyPair.privateKey);
      this.publicKey = importPublicKey(keyPair.publicKey);
    } else {
      throw new Error("Invalid private key format");
    }
  }

  // ========================================================================
  // 生命周期管理
  // ========================================================================

  /**
   * 启动适配器
   */
  async start(): Promise<void> {
    this.emit("started");
  }

  /**
   * 停止适配器
   */
  async stop(): Promise<void> {
    // 清理所有协商会话
    this.negotiationSessions.clear();
    this.activeProtocols.clear();
    this.messageHandlers.clear();

    this.emit("stopped");
  }

  // ========================================================================
  // 协议协商
  // ========================================================================

  /**
   * 发起协议协商
   * @param targetDid 目标 DID
   * @param proposedProtocol 提议的协议
   * @returns 协商会话 ID
   */
  async negotiateProtocol(
    targetDid: string,
    proposedProtocol: string = this.config.protocolVersion || "1.0.0"
  ): Promise<string> {
    const sessionId = this.generateSessionId();

    // 创建协商会话
    const session: NegotiationSession = {
      sessionId,
      peerDid: targetDid,
      state: "negotiating",
      proposedProtocol,
      protocolVersion: proposedProtocol,
      capabilities: [],
      constraints: {
        encryptionRequired: this.config.encryptionRequired ?? true,
        maxLatency: 5000, // 默认5秒
      },
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.negotiationSessions.set(sessionId, session);

    // 创建协议协商消息
    const payload: ProtocolNegotiatePayload = {
      "@type": "anp:ProtocolNegotiation",
      "anp:proposedProtocol": proposedProtocol,
      "anp:protocolVersion": proposedProtocol,
      "anp:capabilities": [],
      "anp:constraints": {
        "anp:maxLatency": 5000,
        "anp:encryptionRequired": this.config.encryptionRequired ?? true,
      },
    };

    const message = createANPMessage(payload, this.privateKey, {
      type: "ProtocolNegotiate",
      targetDid,
      correlationId: sessionId,
      ttl: this.config.defaultTtl,
    });

    // 发送协商消息（这里需要实际的传输层实现）
    this.emit("outbound", message);

    return sessionId;
  }

  /**
   * 处理协议协商请求
   * @param message 协商消息
   */
  async handleProtocolNegotiate(message: ANPMessage): Promise<void> {
    const payload = message.object as ProtocolNegotiatePayload;
    const sessionId = message.correlationId || this.generateSessionId();

    // 检查协议版本是否支持
    const isSupported = this.isProtocolSupported(payload["anp:protocolVersion"]);

    if (isSupported) {
      // 创建接受响应
      const acceptPayload: ProtocolAcceptPayload = {
        "@type": "anp:ProtocolAccept",
        "anp:acceptedProtocol": payload["anp:proposedProtocol"],
        "anp:acceptedVersion": payload["anp:protocolVersion"],
        "anp:sessionId": sessionId,
      };

      const responseMessage = createANPMessage(acceptPayload, this.privateKey, {
        type: "ProtocolAccept",
        targetDid: message.actor,
        correlationId: sessionId,
        ttl: this.config.defaultTtl,
      });

      // 保存协商结果
      const negotiated: NegotiatedProtocol = {
        protocolId: payload["anp:proposedProtocol"],
        version: payload["anp:protocolVersion"],
        sessionId,
        encryptionEnabled: payload["anp:constraints"]["anp:encryptionRequired"],
        negotiatedAt: new Date().toISOString(),
      };

      this.activeProtocols.set(message.actor, negotiated);

      this.emit("outbound", responseMessage);
      this.emit("protocol-negotiated", message.actor, negotiated);
    } else {
      // 创建拒绝响应
      const rejectPayload: ProtocolRejectPayload = {
        "@type": "anp:ProtocolReject",
        "anp:rejectedReason": `Protocol version ${payload["anp:protocolVersion"]} not supported`,
      };

      const responseMessage = createANPMessage(rejectPayload, this.privateKey, {
        type: "ProtocolReject",
        targetDid: message.actor,
        correlationId: sessionId,
        ttl: this.config.defaultTtl,
      });

      this.emit("outbound", responseMessage);
      this.emit("protocol-rejected", message.actor, rejectPayload["anp:rejectedReason"]);
    }
  }

  /**
   * 处理协议接受响应
   * @param message 接受消息
   */
  async handleProtocolAccept(message: ANPMessage): Promise<void> {
    const payload = message.object as ProtocolAcceptPayload;
    const sessionId = payload["anp:sessionId"];

    // 更新协商会话
    const session = this.negotiationSessions.get(sessionId);
    if (session) {
      session.state = "accepted";
      session.lastActivity = new Date();

      // 保存协商结果
      const negotiated: NegotiatedProtocol = {
        protocolId: payload["anp:acceptedProtocol"],
        version: payload["anp:acceptedVersion"],
        sessionId,
        encryptionEnabled: session.constraints.encryptionRequired,
        negotiatedAt: new Date().toISOString(),
      };

      this.activeProtocols.set(session.peerDid, negotiated);
      this.emit("protocol-established", session.peerDid, negotiated);
    }
  }

  /**
   * 处理协议拒绝响应
   * @param message 拒绝消息
   */
  async handleProtocolReject(message: ANPMessage): Promise<void> {
    const payload = message.object as ProtocolRejectPayload;

    // 查找并更新相关会话
    for (const [sessionId, session] of this.negotiationSessions) {
      if (session.peerDid === message.actor && session.state === "negotiating") {
        session.state = "rejected";
        session.lastActivity = new Date();
        this.emit("protocol-failed", message.actor, payload["anp:rejectedReason"]);
        break;
      }
    }
  }

  // ========================================================================
  // 能力发现
  // ========================================================================

  /**
   * 查询对方能力
   * @param targetDid 目标 DID
   */
  async queryCapabilities(targetDid: string): Promise<void> {
    const sessionId = this.generateSessionId();

    const payload: CapabilityQueryPayload = {
      "@type": "anp:CapabilityQuery",
      "anp:queryType": "all",
    };

    const message = createANPMessage(payload, this.privateKey, {
      type: "CapabilityQuery",
      targetDid,
      correlationId: sessionId,
      ttl: this.config.defaultTtl,
    });

    this.emit("outbound", message);
  }

  /**
   * 处理能力查询
   * @param message 查询消息
   */
  async handleCapabilityQuery(message: ANPMessage): Promise<void> {
    const payload = message.object as CapabilityQueryPayload;

    // 生成能力响应
    const capabilities = this.getLocalCapabilities();

    const responsePayload: CapabilityResponsePayload = {
      "@type": "anp:CapabilityResponse",
      "anp:capabilities": capabilities,
    };

    const responseMessage = createANPMessage(responsePayload, this.privateKey, {
      type: "CapabilityResponse",
      targetDid: message.actor,
      correlationId: message.correlationId,
      ttl: this.config.defaultTtl,
    });

    this.emit("outbound", responseMessage);
  }

  /**
   * 广播自身能力
   */
  async broadcastCapabilities(): Promise<void> {
    const capabilities = this.getLocalCapabilities();

    const payload: CapabilityResponsePayload = {
      "@type": "anp:CapabilityResponse",
      "anp:capabilities": capabilities,
    };

    // 这里应该发送到所有已连接的对等点
    // 实际实现需要传输层支持
    this.emit("broadcast-capabilities", capabilities);
  }

  // ========================================================================
  // 消息处理
  // ========================================================================

  /**
   * 注册消息处理器
   * @param messageType 消息类型
   * @param handler 处理器函数
   */
  onMessage(
    messageType: ANPMessage["type"],
    handler: (message: ANPMessage) => Promise<void>
  ): void {
    this.messageHandlers.set(messageType, handler);
  }

  /**
   * 处理接收到的消息
   * @param message ANP 消息
   */
  async handleMessage(message: ANPMessage): Promise<void> {
    // 验证消息
    const defaultTtl = this.config.defaultTtl ?? 3600; // 默认 1 小时
    const verification = verifyMessage(message, this.publicKey, defaultTtl * 1000);
    if (!verification.valid) {
      this.emit("error", { message, error: verification.error });
      return;
    }

    // 根据消息类型路由到对应的处理器
    switch (message.type) {
      case "ProtocolNegotiate":
        await this.handleProtocolNegotiate(message);
        break;

      case "ProtocolAccept":
        await this.handleProtocolAccept(message);
        break;

      case "ProtocolReject":
        await this.handleProtocolReject(message);
        break;

      case "CapabilityQuery":
        await this.handleCapabilityQuery(message);
        break;

      case "CapabilityResponse":
        this.emit("capability-response", message);
        break;

      default:
        // 调用注册的处理器
        const handler = this.messageHandlers.get(message.type);
        if (handler) {
          await handler(message);
        } else {
          this.emit("unknown-message", message);
        }
    }
  }

  // ========================================================================
  // 工具方法
  // ========================================================================

  /**
   * 检查协议版本是否支持
   * @param version 协议版本
   * @returns 是否支持
   */
  private isProtocolSupported(version: string): boolean {
    const supportedVersions = ["1.0.0", "1.1.0"];
    return supportedVersions.includes(version);
  }

  /**
   * 获取本地能力列表
   * @returns 能力列表
   */
  private getLocalCapabilities(): CapabilityResponsePayload["anp:capabilities"] {
    return [
      {
        "@type": "anp:Capability",
        "anp:capabilityId": "anp.protocol.negotiation",
        "anp:name": "Protocol Negotiation",
        "anp:description": "Supports ANP protocol version negotiation",
        "anp:supportedLanguages": ["typescript", "python"],
        "anp:supportedFrameworks": ["node", "deno"],
      },
      {
        "@type": "anp:Capability",
        "anp:capabilityId": "anp.encryption.aes-gcm",
        "anp:name": "AES-GCM Encryption",
        "anp:description": "Supports AES-256-GCM encryption",
      },
      {
        "@type": "anp:Capability",
        "anp:capabilityId": "anp.signature.ecdsa-p256",
        "anp:name": "ECDSA-P256 Signature",
        "anp:description": "Supports ECDSA P-256 signatures",
      },
    ];
  }

  /**
   * 生成会话 ID
   * @returns 会话 ID
   */
  private generateSessionId(): string {
    return `session-${Date.now()}-${crypto.randomBytes(16).toString("hex")}`;
  }

  /**
   * 获取活跃协议
   * @param peerDid 对等点 DID
   * @returns 协议信息
   */
  getActiveProtocol(peerDid: string): NegotiatedProtocol | undefined {
    return this.activeProtocols.get(peerDid);
  }

  /**
   * 获取所有活跃协议
   * @returns 协议映射
   */
  getAllActiveProtocols(): Map<string, NegotiatedProtocol> {
    return new Map(this.activeProtocols);
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建 ANP 适配器
 * @param config 配置
 * @returns 适配器实例
 */
export function createANPAdapter(config: ANPAdapterConfig): ANPAdapter {
  return new ANPAdapter(config);
}
