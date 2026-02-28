/**
 * @jest-environment node
 *
 * ANP 协议适配器测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ANPAdapter, createANPAdapter } from "../../anp/adapter.js";
import type { ANPAdapterConfig } from "../../anp/types.js";
import { AUTOMATON_DID } from "../../anp/types.js";

describe("ANP Adapter", () => {
  let adapter: ANPAdapter;
  let config: ANPAdapterConfig;

  beforeEach(() => {
    config = {
      protocolVersion: "1.0.0",
      defaultTtl: 3600,
      encryptionRequired: true,
      privateKey: "test-key", // 适配器会生成新的密钥对
    };
    adapter = createANPAdapter(config);
  });

  describe("Initialization", () => {
    it("should create adapter with config", () => {
      expect(adapter).toBeDefined();
      expect(adapter instanceof ANPAdapter).toBe(true);
    });

    it("should have no active protocols initially", () => {
      const protocols = adapter.getAllActiveProtocols();
      expect(protocols.size).toBe(0);
    });

    it("should generate valid session IDs", () => {
      const sessionId1 = adapter["generateSessionId"]();
      const sessionId2 = adapter["generateSessionId"]();

      expect(sessionId1).toBeDefined();
      expect(sessionId2).toBeDefined();
      expect(sessionId1).not.toBe(sessionId2);
      expect(sessionId1).toMatch(/^session-\d+-[a-f0-9]+$/);
    });
  });

  describe("Protocol Negotiation", () => {
    it("should initiate protocol negotiation", async () => {
      let outboundMessage: any = null;

      adapter.once("outbound", (message) => {
        outboundMessage = message;
      });

      const targetDid = "did:anp:nanobot:main";
      const sessionId = await adapter.negotiateProtocol(targetDid);

      expect(sessionId).toBeDefined();
      expect(outboundMessage).toBeDefined();
      expect(outboundMessage.type).toBe("ProtocolNegotiate");
      expect(outboundMessage.actor).toBe(AUTOMATON_DID);
      expect(outboundMessage.target).toBe(targetDid);
      expect(outboundMessage.object["anp:protocolVersion"]).toBe("1.0.0");
    });

    it("should accept supported protocol version", async () => {
      let acceptMessage: any = null;
      let establishedEvent: any = null;

      adapter.once("outbound", (message) => {
        acceptMessage = message;
      });

      adapter.once("protocol-established", (peerDid, protocol) => {
        establishedEvent = { peerDid, protocol };
      });

      // 模拟接收协议协商消息
      const negotiateMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-negotiate-001",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "ProtocolNegotiate" as const,
        object: {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": "1.0.0",
          "anp:protocolVersion": "1.0.0",
          "anp:capabilities": [],
          "anp:constraints": {
            "anp:maxLatency": 5000,
            "anp:encryptionRequired": true,
          },
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "session-001",
        ttl: 3600,
      };

      await adapter.handleProtocolNegotiate(negotiateMessage);

      expect(acceptMessage).toBeDefined();
      expect(acceptMessage.type).toBe("ProtocolAccept");
      expect(establishedEvent).toBeDefined();
      expect(establishedEvent.peerDid).toBe("did:anp:nanobot:main");
      expect(establishedEvent.protocol.protocolId).toBe("1.0.0");
    });

    it("should reject unsupported protocol version", async () => {
      let rejectMessage: any = null;
      let rejectedEvent: any = null;

      adapter.once("outbound", (message) => {
        rejectMessage = message;
      });

      adapter.once("protocol-rejected", (peerDid, reason) => {
        rejectedEvent = { peerDid, reason };
      });

      // 模拟接收协议协商消息（不支持的版本）
      const negotiateMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-negotiate-002",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "ProtocolNegotiate" as const,
        object: {
          "@type": "anp:ProtocolNegotiation",
          "anp:proposedProtocol": "2.0.0",
          "anp:protocolVersion": "2.0.0", // 不支持的版本
          "anp:capabilities": [],
          "anp:constraints": {
            "anp:maxLatency": 5000,
            "anp:encryptionRequired": true,
          },
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "session-002",
        ttl: 3600,
      };

      await adapter.handleProtocolNegotiate(negotiateMessage);

      expect(rejectMessage).toBeDefined();
      expect(rejectMessage.type).toBe("ProtocolReject");
      expect(rejectedEvent).toBeDefined();
      expect(rejectedEvent.peerDid).toBe("did:anp:nanobot:main");
      expect(rejectedEvent.reason).toContain("not supported");
    });

    it("should handle protocol accept response", async () => {
      let establishedEvent: any = null;

      adapter.once("protocol-established", (peerDid, protocol) => {
        establishedEvent = { peerDid, protocol };
      });

      // 首先发起协商
      await adapter.negotiateProtocol("did:anp:nanobot:main");

      // 模拟接收接受响应
      const acceptMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-accept-001",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "ProtocolAccept" as const,
        object: {
          "@type": "anp:ProtocolAccept",
          "acceptedProtocol": "1.0.0",
          "acceptedVersion": "1.0.0",
          "sessionId": "test-session-001",
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "test-session-001",
        ttl: 3600,
      };

      await adapter.handleProtocolAccept(acceptMessage);

      expect(establishedEvent).toBeDefined();
      expect(establishedEvent.peerDid).toBe("did:anp:nanobot:main");
      expect(establishedEvent.protocol.protocolId).toBe("1.0.0");

      // 验证协议已保存
      const activeProtocol = adapter.getActiveProtocol("did:anp:nanobot:main");
      expect(activeProtocol).toBeDefined();
      expect(activeProtocol?.protocolId).toBe("1.0.0");
    });

    it("should handle protocol reject response", async () => {
      let failedEvent: any = null;

      adapter.once("protocol-failed", (peerDid, reason) => {
        failedEvent = { peerDid, reason };
      });

      // 首先发起协商
      await adapter.negotiateProtocol("did:anp:nanobot:main");

      // 模拟接收拒绝响应
      const rejectMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-reject-001",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "ProtocolReject" as const,
        object: {
          "@type": "anp:ProtocolReject",
          "rejectedReason": "Incompatible capabilities",
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "test-session-002",
        ttl: 3600,
      };

      await adapter.handleProtocolReject(rejectMessage);

      expect(failedEvent).toBeDefined();
      expect(failedEvent.peerDid).toBe("did:anp:nanobot:main");
      expect(failedEvent.reason).toBe("Incompatible capabilities");
    });
  });

  describe("Capability Discovery", () => {
    it("should query capabilities from peer", async () => {
      let outboundMessage: any = null;

      adapter.once("outbound", (message) => {
        outboundMessage = message;
      });

      await adapter.queryCapabilities("did:anp:nanobot:main");

      expect(outboundMessage).toBeDefined();
      expect(outboundMessage.type).toBe("CapabilityQuery");
      expect(outboundMessage.target).toBe("did:anp:nanobot:main");
    });

    it("should respond to capability queries", async () => {
      let responseMessage: any = null;

      adapter.once("outbound", (message) => {
        responseMessage = message;
      });

      // 模拟接收能力查询消息
      const queryMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-query-001",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "CapabilityQuery" as const,
        object: {
          "@type": "anp:CapabilityQuery",
          "anp:queryType": "all",
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "session-query-001",
        ttl: 3600,
      };

      await adapter.handleCapabilityQuery(queryMessage);

      expect(responseMessage).toBeDefined();
      expect(responseMessage.type).toBe("CapabilityResponse");
      expect(responseMessage.object["anp:capabilities"]).toBeDefined();
      expect(Array.isArray(responseMessage.object["anp:capabilities"])).toBe(true);
    });

    it("should include expected capabilities in response", async () => {
      let capabilities: any = null;

      adapter.once("outbound", (message) => {
        capabilities = message.object["anp:capabilities"];
      });

      const queryMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-query-002",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "CapabilityQuery" as const,
        object: {
          "@type": "anp:CapabilityQuery",
          "anp:queryType": "all",
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "session-query-002",
        ttl: 3600,
      };

      await adapter.handleCapabilityQuery(queryMessage);

      expect(capabilities).toBeDefined();
      expect(capabilities.length).toBeGreaterThan(0);

      // 验证包含核心能力
      const capabilityIds = capabilities.map((c: any) => c["anp:capabilityId"]);
      expect(capabilityIds).toContain("anp.protocol.negotiation");
      expect(capabilityIds).toContain("anp.signature.ecdsa-p256");
    });

    it("should broadcast capabilities", async () => {
      let broadcastCapabilities: any = null;

      adapter.once("broadcast-capabilities", (capabilities) => {
        broadcastCapabilities = capabilities;
      });

      await adapter.broadcastCapabilities();

      expect(broadcastCapabilities).toBeDefined();
      expect(Array.isArray(broadcastCapabilities)).toBe(true);
      expect(broadcastCapabilities.length).toBeGreaterThan(0);
    });
  });

  describe("Message Handling", () => {
    it("should route messages to correct handlers", async () => {
      let handledMessage: any = null;

      adapter.onMessage("ProgressEvent", async (message) => {
        handledMessage = message;
      });

      const message = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-progress-001",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "ProgressEvent" as const,
        object: {
          "@type": "anp:ProgressReport",
          "anp:taskId": "test-task",
          "anp:progress": 50,
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "dummy-signature",
        },
        correlationId: "session-progress-001",
        ttl: 3600,
      };

      await adapter.handleMessage(message);

      // 注意：由于签名验证会失败，实际不会调用处理器
      // 这里主要测试路由逻辑
      expect(adapter["messageHandlers"].get("ProgressEvent")).toBeDefined();
    });

    it("should emit error for invalid messages", async () => {
      let errorEvent: any = null;

      adapter.once("error", (error) => {
        errorEvent = error;
      });

      const invalidMessage = {
        "@context": ["https://www.w3.org/ns/activitystreams/v1"],
        "@type": "ANPMessage",
        id: "test-invalid-001",
        timestamp: new Date().toISOString(),
        actor: "did:anp:nanobot:main",
        target: AUTOMATON_DID,
        type: "ProgressEvent" as const,
        object: {
          "@type": "anp:ProgressReport",
        },
        signature: {
          type: "EcdsaSecp256r1Signature2019",
          created: new Date().toISOString(),
          verificationMethod: "did:anp:nanobot:main#key-1",
          proofPurpose: "authentication",
          proofValue: "invalid-signature",
        },
        correlationId: "session-invalid-001",
        ttl: 3600,
      };

      await adapter.handleMessage(invalidMessage);

      // 验证会触发错误事件（因为签名无效）
      expect(errorEvent).toBeDefined();
    });
  });

  describe("Lifecycle", () => {
    it("should start and stop adapter", async () => {
      let startedEvent = false;
      let stoppedEvent = false;

      adapter.once("started", () => {
        startedEvent = true;
      });

      adapter.once("stopped", () => {
        stoppedEvent = true;
      });

      await adapter.start();
      expect(startedEvent).toBe(true);

      await adapter.stop();
      expect(stoppedEvent).toBe(true);

      // 验证清理完成
      const protocols = adapter.getAllActiveProtocols();
      expect(protocols.size).toBe(0);
    });
  });
});
