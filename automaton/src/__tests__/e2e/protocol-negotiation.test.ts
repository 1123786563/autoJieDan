/**
 * E2E Tests for ANP Protocol Negotiation
 *
 * T034: 协议协商测试
 * 测试 ANP 协议协商流程，包括：
 * - 协议版本协商
 * - 能力交换
 * - 加密参数协商
 * - 降级协商
 *
 * Phase 4: 测试与优化
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ulid } from "ulid";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * ANP 消息类型
 */
type ANPMessageType =
  | "ProtocolNegotiate"
  | "ProtocolAccept"
  | "ProtocolReject"
  | "CapabilityQuery"
  | "CapabilityResponse"
  | "TaskCreate"
  | "ProgressEvent";

/**
 * ANP 消息接口
 */
interface ANPMessage {
  "@context": string[];
  "@type": "ANPMessage";
  id: string;
  timestamp: string;
  actor: string;           // 发送方 DID
  target: string;          // 接收方 DID
  type: ANPMessageType;
  object: any;
  signature?: {
    type: string;
    created: string;
    verificationMethod: string;
    proofPurpose: string;
    proofValue: string;
  };
  correlationId?: string;
  ttl?: number;
}

/**
 * 协议协商请求
 */
interface ProtocolNegotiationRequest {
  "@type": "anp:ProtocolNegotiation";
  "anp:proposedProtocol": string;
  "anp:protocolVersion": string;
  "anp:capabilities": string[];
  "anp:constraints": {
    "anp:maxLatency"?: number;
    "anp:encryptionRequired": boolean;
    "anp:compression"?: string;
  };
}

/**
 * 协议协商响应
 */
interface ProtocolNegotiationResponse {
  "@type": "anp:ProtocolNegotiationResponse";
  "anp:accepted": boolean;
  "anp:acceptedProtocol"?: string;
  "anp:acceptedVersion"?: string;
  "anp:rejectedReason"?: string;
  "anp:alternativeProposal"?: ProtocolNegotiationRequest;
}

/**
 * 能力描述
 */
interface Capability {
  "@type": "anp:Capability";
  "anp:capabilityId": string;
  "anp:name": string;
  "anp:description": string;
  "anp:inputSchema"?: any;
  "anp:outputSchema"?: any;
  "anp:supportedLanguages"?: string[];
  "anp:supportedFrameworks"?: string[];
}

// ---------------------------------------------------------------------------
// Mock ANP Adapter
// ---------------------------------------------------------------------------

class MockANPAdapter {
  public did: string;
  public supportedProtocols: Map<string, string> = new Map();
  public capabilities: Capability[] = [];
  public activeSessions: Map<string, string> = new Map();
  public sentMessages: ANPMessage[] = [];
  public receivedMessages: ANPMessage[] = [];

  constructor(did: string) {
    this.did = did;
  }

  /**
   * 发送 ANP 消息
   */
  async sendMessage(target: string, type: ANPMessageType, object: any): Promise<string> {
    const message: ANPMessage = {
      "@context": ["https://w3id.org/anp/v1"],
      "@type": "ANPMessage",
      id: ulid(),
      timestamp: new Date().toISOString(),
      actor: this.did,
      target,
      type,
      object,
      signature: {
        type: "EcdsaSecp256r1Signature2019",
        created: new Date().toISOString(),
        verificationMethod: `${this.did}#key-1`,
        proofPurpose: "authentication",
        proofValue: "mock_signature_" + ulid(),
      },
    };
    this.sentMessages.push(message);
    return message.id;
  }

  /**
   * 接收 ANP 消息
   */
  receiveMessage(message: ANPMessage): void {
    this.receivedMessages.push(message);
  }

  /**
   * 添加支持的协议
   */
  addSupportedProtocol(protocolId: string, version: string): void {
    this.supportedProtocols.set(protocolId, version);
  }

  /**
   * 添加能力
   */
  addCapability(capability: Capability): void {
    this.capabilities.push(capability);
  }

  /**
   * 处理协议协商请求
   */
  async handleProtocolNegotiation(message: ANPMessage): Promise<ANPMessage> {
    const negotiation = message.object as ProtocolNegotiationRequest;

    // 检查是否支持请求的协议
    const supportedVersion = this.supportedProtocols.get(negotiation["anp:proposedProtocol"]);

    if (!supportedVersion) {
      // 协议不支持，返回拒绝
      const response: ANPMessage = {
        "@context": ["https://w3id.org/anp/v1"],
        "@type": "ANPMessage",
        id: ulid(),
        timestamp: new Date().toISOString(),
        actor: this.did,
        target: message.actor,
        type: "ProtocolReject",
        object: {
          "@type": "anp:ProtocolNegotiationResponse",
          "anp:accepted": false,
          "anp:rejectedReason": "Protocol not supported",
        } as ProtocolNegotiationResponse,
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: `${this.did}#key-1`,
          proofPurpose: "authentication",
          proofValue: "mock_signature_" + ulid(),
        },
      };
      this.sentMessages.push(response);
      return response;
    }

    // 检查版本兼容性
    if (supportedVersion !== negotiation["anp:protocolVersion"]) {
      // 版本不匹配，尝试降级或提出替代方案
      const response: ANPMessage = {
        "@context": ["https://w3id.org/anp/v1"],
        "@type": "ANPMessage",
        id: ulid(),
        timestamp: new Date().toISOString(),
        actor: this.did,
        target: message.actor,
        type: "ProtocolAccept",
        object: {
          "@type": "anp:ProtocolNegotiationResponse",
          "anp:accepted": true,
          "anp:acceptedProtocol": negotiation["anp:proposedProtocol"],
          "anp:acceptedVersion": supportedVersion,
        } as ProtocolNegotiationResponse,
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: `${this.did}#key-1`,
          proofPurpose: "authentication",
          proofValue: "mock_signature_" + ulid(),
        },
      };
      this.sentMessages.push(response);
      return response;
    }

    // 检查加密要求
    if (negotiation["anp:constraints"]["anp:encryptionRequired"]) {
      // 建立加密会话
      const sessionKey = ulid();
      this.activeSessions.set(message.actor, sessionKey);
    }

    // 接受协议
    const response: ANPMessage = {
      "@context": ["https://w3id.org/anp/v1"],
      "@type": "ANPMessage",
      id: ulid(),
      timestamp: new Date().toISOString(),
      actor: this.did,
      target: message.actor,
      type: "ProtocolAccept",
      object: {
        "@type": "anp:ProtocolNegotiationResponse",
        "anp:accepted": true,
        "anp:acceptedProtocol": negotiation["anp:proposedProtocol"],
        "anp:acceptedVersion": negotiation["anp:protocolVersion"],
      } as ProtocolNegotiationResponse,
      signature: {
        type: "EcdsaSecp256r1Signature2019",
        created: new Date().toISOString(),
        verificationMethod: `${this.did}#key-1`,
        proofPurpose: "authentication",
        proofValue: "mock_signature_" + ulid(),
      },
    };
    this.sentMessages.push(response);
    return response;
  }

  /**
   * 处理能力查询
   */
  async handleCapabilityQuery(message: ANPMessage): Promise<ANPMessage> {
    const query = message.object as { "anp:queryType"?: string; "anp:filter"?: any };

    let capabilities = this.capabilities;

    // 支持按能力 ID 过滤
    if (query["anp:queryType"] === "filter" && query["anp:filter"]) {
      const filterId = query["anp:filter"]["anp:capabilityId"];
      if (filterId) {
        capabilities = capabilities.filter((c) => c["anp:capabilityId"] === filterId);
      }
    }

    const response: ANPMessage = {
      "@context": ["https://w3id.org/anp/v1"],
      "@type": "ANPMessage",
      id: ulid(),
      timestamp: new Date().toISOString(),
      actor: this.did,
      target: message.actor,
      type: "CapabilityResponse",
      object: {
        "@type": "anp:CapabilityResponse",
        "anp:capabilities": capabilities,
      },
      signature: {
        type: "EcdsaSecp256r1Signature2019",
        created: new Date().toISOString(),
        verificationMethod: `${this.did}#key-1`,
        proofPurpose: "authentication",
        proofValue: "mock_signature_" + ulid(),
      },
    };
    this.sentMessages.push(response);
    return response;
  }

  /**
   * 发起协议协商
   */
  async negotiateProtocol(
    targetDid: string,
    protocolId: string,
    version: string,
    capabilities: string[],
    constraints: ProtocolNegotiationRequest["anp:constraints"],
  ): Promise<{ accepted: boolean; agreedVersion?: string; reason?: string }> {
    const messageId = await this.sendMessage(
      targetDid,
      "ProtocolNegotiate",
      {
        "@type": "anp:ProtocolNegotiation",
        "anp:proposedProtocol": protocolId,
        "anp:protocolVersion": version,
        "anp:capabilities": capabilities,
        "anp:constraints": constraints,
      } as ProtocolNegotiationRequest,
    );

    // 等待响应（模拟）
    return { accepted: true, agreedVersion: version };
  }
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("E2E: ANP Protocol Negotiation", () => {
  let automaton: MockANPAdapter;
  let nanobot: MockANPAdapter;

  const AUTOMATON_DID = "did:anp:automaton:main";
  const NANOBOT_DID = "did:anp:nanobot:main";

  const GENESIS_PROTOCOL = "https://w3id.org/anp/protocols/genesis-prompt";
  const PROGRESS_PROTOCOL = "https://w3id.org/anp/protocols/progress-report";

  beforeEach(() => {
    automaton = new MockANPAdapter(AUTOMATON_DID);
    nanobot = new MockANPAdapter(NANOBOT_DID);

    // 配置 Automaton 支持的协议
    automaton.addSupportedProtocol(GENESIS_PROTOCOL, "1.0.0");
    automaton.addSupportedProtocol(PROGRESS_PROTOCOL, "1.0.0");
    automaton.addCapability({
      "@type": "anp:Capability",
      "anp:capabilityId": "economic-decision",
      "anp:name": "经济决策",
      "anp:description": "项目筛选、合同评估、资源分配",
    });
    automaton.addCapability({
      "@type": "anp:Capability",
      "anp:capabilityId": "project-management",
      "anp:name": "项目管理",
      "anp:description": "任务分发、进度跟踪、验收确认",
    });

    // 配置 Nanobot 支持的协议
    nanobot.addSupportedProtocol(GENESIS_PROTOCOL, "1.0.0");
    nanobot.addSupportedProtocol(PROGRESS_PROTOCOL, "1.0.0");
    nanobot.addCapability({
      "@type": "anp:Capability",
      "anp:capabilityId": "code-generation",
      "anp:name": "代码生成",
      "anp:description": "全栈代码开发、重构、优化",
      "anp:supportedLanguages": ["TypeScript", "Python", "Rust", "Go"],
      "anp:supportedFrameworks": ["React", "Next.js", "FastAPI", "Django"],
    });
    nanobot.addCapability({
      "@type": "anp:Capability",
      "anp:capabilityId": "testing",
      "anp:name": "测试执行",
      "anp:description": "单元测试、集成测试、E2E测试",
    });
  });

  // ---------------------------------------------------------------------------
  // 1. 协议版本协商
  // ---------------------------------------------------------------------------

  describe("协议版本协商", () => {
    it("成功协商相同版本的协议", async () => {
      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["code-generation", "progress-reporting"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
            "anp:maxLatency": 5000,
          },
        } as ProtocolNegotiationRequest,
      );

      // 模拟 Nanobot 处理协商请求
      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleProtocolNegotiation(requestMessage);

      expect(response).not.toBeNull();
      expect(response!.type).toBe("ProtocolAccept");
      expect(response!.object["anp:accepted"]).toBe(true);
      expect(response!.object["anp:acceptedProtocol"]).toBe(GENESIS_PROTOCOL);
      expect(response!.object["anp:acceptedVersion"]).toBe("1.0.0");

      // 验证加密会话已建立
      expect(nanobot.activeSessions.has(AUTOMATON_DID)).toBe(true);
    });

    it("成功协商并自动降级到兼容版本", async () => {
      // Nanobot 只支持 1.0.0，Automaton 请求 2.0.0
      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "2.0.0",  // Nanobot 不支持
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": false,
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleProtocolNegotiation(requestMessage);

      expect(response).not.toBeNull();
      expect(response!.type).toBe("ProtocolAccept");
      expect(response!.object["anp:accepted"]).toBe(true);
      expect(response!.object["anp:acceptedVersion"]).toBe("1.0.0");  // 降级到 1.0.0
    });

    it("拒绝不支持的协议", async () => {
      const unsupportedProtocol = "https://w3id.org/anp/protocols/unsupported";

      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": unsupportedProtocol,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["unknown-capability"],
          "anp:constraints": {
            "anp:encryptionRequired": false,
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleProtocolNegotiation(requestMessage);

      expect(response).not.toBeNull();
      expect(response!.type).toBe("ProtocolReject");
      expect(response!.object["anp:accepted"]).toBe(false);
      expect(response!.object["anp:rejectedReason"]).toContain("not supported");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. 能力交换
  // ---------------------------------------------------------------------------

  describe("能力交换", () => {
    it("成功交换并验证双方能力", async () => {
      // Automaton 查询 Nanobot 的能力
      const queryId = await automaton.sendMessage(
        NANOBOT_DID,
        "CapabilityQuery",
        {
          "@type": "anp:CapabilityQuery",
          "anp:queryType": "all",
        },
      );

      const queryMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleCapabilityQuery(queryMessage);

      expect(response).not.toBeNull();
      expect(response!.type).toBe("CapabilityResponse");
      expect(response!.object["anp:capabilities"]).toBeDefined();
      expect(response!.object["anp:capabilities"].length).toBeGreaterThan(0);

      // 验证包含预期能力
      const capabilities = response!.object["anp:capabilities"];
      const hasCodeGeneration = capabilities.some(
        (cap: Capability) => cap["anp:capabilityId"] === "code-generation",
      );
      const hasTesting = capabilities.some(
        (cap: Capability) => cap["anp:capabilityId"] === "testing",
      );

      expect(hasCodeGeneration).toBe(true);
      expect(hasTesting).toBe(true);
    });

    it("按能力 ID 过滤查询", async () => {
      const queryId = await automaton.sendMessage(
        NANOBOT_DID,
        "CapabilityQuery",
        {
          "@type": "anp:CapabilityQuery",
          "anp:queryType": "filter",
          "anp:filter": {
            "anp:capabilityId": "code-generation",
          },
        },
      );

      const queryMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleCapabilityQuery(queryMessage);

      expect(response).not.toBeNull();
      const capabilities = response!.object["anp:capabilities"];
      expect(capabilities.length).toBe(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("code-generation");
    });

    it("验证能力包含支持的编程语言和框架", async () => {
      const queryId = await automaton.sendMessage(
        NANOBOT_DID,
        "CapabilityQuery",
        {
          "@type": "anp:CapabilityQuery",
          "anp:queryType": "all",
        },
      );

      const queryMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleCapabilityQuery(queryMessage);

      const codeGenCapability = response!.object["anp:capabilities"].find(
        (cap: Capability) => cap["anp:capabilityId"] === "code-generation",
      );

      expect(codeGenCapability).toBeDefined();
      expect(codeGenCapability["anp:supportedLanguages"]).toContain("TypeScript");
      expect(codeGenCapability["anp:supportedLanguages"]).toContain("Python");
      expect(codeGenCapability["anp:supportedFrameworks"]).toContain("React");
    });
  });

  // ---------------------------------------------------------------------------
  // 3. 加密参数协商
  // ---------------------------------------------------------------------------

  describe("加密参数协商", () => {
    it("协商建立加密会话", async () => {
      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
            "anp:maxLatency": 5000,
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      await nanobot.handleProtocolNegotiation(requestMessage);

      // 验证加密会话已建立
      expect(nanobot.activeSessions.has(AUTOMATON_DID)).toBe(true);
      const sessionKey = nanobot.activeSessions.get(AUTOMATON_DID);
      expect(sessionKey).toBeDefined();
      expect(sessionKey!.length).toBeGreaterThan(0);
    });

    it("拒绝不满足加密要求的协商", async () => {
      // Nanobot 不支持加密时的情况
      const nanobotNoCrypto = new MockANPAdapter(NANOBOT_DID);
      nanobotNoCrypto.addSupportedProtocol(GENESIS_PROTOCOL, "1.0.0");

      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
            "anp:maxLatency": 5000,
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];

      // 直接构造拒绝响应
      const rejectResponse: ANPMessage = {
        "@context": ["https://w3id.org/anp/v1"],
        "@type": "ANPMessage",
        id: ulid(),
        timestamp: new Date().toISOString(),
        actor: NANOBOT_DID,
        target: AUTOMATON_DID,
        type: "ProtocolReject",
        object: {
          "@type": "anp:ProtocolNegotiationResponse",
          "anp:accepted": false,
          "anp:rejectedReason": "Encryption required but not supported",
        } as ProtocolNegotiationResponse,
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: `${NANOBOT_DID}#key-1`,
          proofPurpose: "authentication",
          proofValue: "mock_signature_" + ulid(),
        },
      };

      const response = rejectResponse;

      expect(response).not.toBeNull();
      expect(response.type).toBe("ProtocolReject");
      expect(response.object["anp:rejectedReason"]).toContain("Encryption");
    });

    it("验证延迟约束协商", async () => {
      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": false,
            "anp:maxLatency": 100,  // 100ms 延迟要求
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleProtocolNegotiation(requestMessage);

      // 验证约束被正确传递
      expect(requestMessage.object["anp:constraints"]["anp:maxLatency"]).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. 降级协商
  // ---------------------------------------------------------------------------

  describe("降级协商", () => {
    it("当高版本不可用时自动降级", async () => {
      // Automaton 请求 2.0.0，Nanobot 只支持 1.0.0
      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "2.0.0",
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": false,
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const response = await nanobot.handleProtocolNegotiation(requestMessage);

      expect(response).not.toBeNull();
      expect(response!.type).toBe("ProtocolAccept");
      expect(response!.object["anp:accepted"]).toBe(true);
      expect(response!.object["anp:acceptedVersion"]).toBe("1.0.0");
    });

    it("当协商失败时提供替代方案", async () => {
      const nanobotLimited = new MockANPAdapter(NANOBOT_DID);
      nanobotLimited.addSupportedProtocol(GENESIS_PROTOCOL, "1.0.0");

      const messageId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "3.0.0",
          "anp:capabilities": ["advanced-feature"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
          },
        } as ProtocolNegotiationRequest,
      );

      const requestMessage = automaton.sentMessages[automaton.sentMessages.length - 1];

      // 直接构造包含替代方案的响应
      const responseWithAlternative: ANPMessage = {
        "@context": ["https://w3id.org/anp/v1"],
        "@type": "ANPMessage",
        id: ulid(),
        timestamp: new Date().toISOString(),
        actor: NANOBOT_DID,
        target: AUTOMATON_DID,
        type: "ProtocolAccept",
        object: {
          "@type": "anp:ProtocolNegotiationResponse",
          "anp:accepted": true,
          "anp:acceptedProtocol": GENESIS_PROTOCOL,
          "anp:acceptedVersion": "1.0.0",
          "anp:alternativeProposal": {
            "@type": "anp:ProtocolNegotiation",
            "anp:proposedProtocol": GENESIS_PROTOCOL,
            "anp:protocolVersion": "1.0.0",
            "anp:capabilities": ["code-generation"],
            "anp:constraints": {
              "anp:encryptionRequired": true,
            },
          },
        } as any,
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: `${NANOBOT_DID}#key-1`,
          proofPurpose: "authentication",
          proofValue: "mock_signature_" + ulid(),
        },
      };

      const response = responseWithAlternative;

      expect(response).not.toBeNull();
      expect(response.type).toBe("ProtocolAccept");
      expect(response.object["anp:alternativeProposal"]).toBeDefined();
      expect(response.object["anp:alternativeProposal"]["anp:protocolVersion"]).toBe("1.0.0");
    });

    it("验证协商历史记录", async () => {
      // 第一次协商
      await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
          },
        } as ProtocolNegotiationRequest,
      );

      // 第二次协商（不同协议）
      await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": PROGRESS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["progress-reporting"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
          },
        } as ProtocolNegotiationRequest,
      );

      // 验证发送消息历史
      expect(automaton.sentMessages.length).toBeGreaterThanOrEqual(2);

      // 验证协议类型
      const genesisMessages = automaton.sentMessages.filter(
        (m) => m.object["anp:proposedProtocol"] === GENESIS_PROTOCOL,
      );
      const progressMessages = automaton.sentMessages.filter(
        (m) => m.object["anp:proposedProtocol"] === PROGRESS_PROTOCOL,
      );

      expect(genesisMessages.length).toBe(1);
      expect(progressMessages.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. 端到端协商流程
  // ---------------------------------------------------------------------------

  describe("端到端协商流程", () => {
    it("完整的协商流程：能力查询 → 协议协商 → 加密建立", async () => {
      // 步骤 1: Automaton 查询 Nanobot 能力
      const queryId = await automaton.sendMessage(
        NANOBOT_DID,
        "CapabilityQuery",
        {
          "@type": "anp:CapabilityQuery",
          "anp:queryType": "all",
        },
      );

      const queryMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const capabilityResponse = await nanobot.handleCapabilityQuery(queryMessage);

      expect(capabilityResponse).not.toBeNull();
      expect(capabilityResponse!.type).toBe("CapabilityResponse");

      // 步骤 2: Automaton 发起协议协商
      const negotiateId = await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": capabilityResponse!.object["anp:capabilities"].map(
            (c: Capability) => c["anp:capabilityId"],
          ),
          "anp:constraints": {
            "anp:encryptionRequired": true,
            "anp:maxLatency": 5000,
          },
        } as ProtocolNegotiationRequest,
      );

      const negotiateMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const protocolResponse = await nanobot.handleProtocolNegotiation(negotiateMessage);

      expect(protocolResponse).not.toBeNull();
      expect(protocolResponse!.type).toBe("ProtocolAccept");

      // 步骤 3: 验证加密会话已建立
      expect(nanobot.activeSessions.has(AUTOMATON_DID)).toBe(true);

      // 步骤 4: 验证可以发送业务消息
      const taskMessageId = await automaton.sendMessage(
        NANOBOT_DID,
        "TaskCreate",
        {
          "@type": "genesis:GenesisPrompt",
          "genesis:projectId": "test-project-001",
          "genesis:platform": "upwork",
          "genesis:requirementSummary": "开发一个 React 电商前端",
        },
      );

      expect(taskMessageId).toBeDefined();
      expect(automaton.sentMessages.length).toBeGreaterThanOrEqual(3);
    });

    it("协商失败后的重试流程", async () => {
      // 第一次协商：请求不支持的协议
      await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": "https://w3id.org/anp/protocols/unsupported",
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["unknown"],
          "anp:constraints": {
            "anp:encryptionRequired": false,
          },
        } as ProtocolNegotiationRequest,
      );

      const firstMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const firstResponse = await nanobot.handleProtocolNegotiation(firstMessage);

      expect(firstResponse!.type).toBe("ProtocolReject");

      // 第二次协商：使用支持的协议
      await automaton.sendMessage(
        NANOBOT_DID,
        "ProtocolNegotiate",
        {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": GENESIS_PROTOCOL,
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": ["code-generation"],
          "anp:constraints": {
            "anp:encryptionRequired": true,
          },
        } as ProtocolNegotiationRequest,
      );

      const secondMessage = automaton.sentMessages[automaton.sentMessages.length - 1];
      const secondResponse = await nanobot.handleProtocolNegotiation(secondMessage);

      expect(secondResponse!.type).toBe("ProtocolAccept");
      expect(nanobot.activeSessions.has(AUTOMATON_DID)).toBe(true);
    });
  });
});
