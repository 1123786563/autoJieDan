/**
 * 元协议层测试 (TypeScript for Automaton)
 * 测试元协议协商器在 TypeScript 环境中的功能
 *
 * @test_module automaton.src.__tests__.interagent.meta-protocol
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MetaProtocolNegotiator,
  NegotiationConfig,
  NegotiationResult,
  NegotiationOutcome,
} from '../interagent/meta-protocol/negotiator';
import {
  MetaProtocolProcessor,
  ProcessingConfig,
} from '../interagent/meta-protocol/processor';
import {
  ANPMessage,
  ANPMessageType,
  ProtocolNegotiatePayload,
  ProtocolAcceptPayload,
  ProtocolRejectPayload,
  Capability,
} from '../anp/types';

// ============================================================================
// 测试配置
// ============================================================================

const LOCAL_DID = 'did:anp:nanobot:main';
const PEER_DID = 'did:anp:automaton:main';

const LOCAL_CAPABILITIES: Capability[] = [
  {
    '@type': 'anp:Capability',
    'anp:capabilityId': 'anp.protocol.negotiation',
    'anp:name': 'Protocol Negotiation',
    'anp:description': 'Supports ANP protocol negotiation',
    'anp:supportedLanguages': ['typescript', 'python'],
  },
  {
    '@type': 'anp:Capability',
    'anp:capabilityId': 'anp.encryption.aes-gcm',
    'anp:name': 'AES-GCM Encryption',
    'anp:description': 'Supports AES-256-GCM encryption',
  },
];

const SUPPORTED_PROTOCOLS = [
  'https://w3id.org/anp/protocols/genesis-prompt/v1',
  'https://w3id.org/anp/protocols/status/v1',
];

// ============================================================================
// MetaProtocolNegotiator 测试
// ============================================================================

describe('MetaProtocolNegotiator', () => {
  let negotiator: MetaProtocolNegotiator;
  let config: NegotiationConfig;

  beforeEach(() => {
    config = {
      maxRounds: 3,
      timeoutSeconds: 60,
      strategy: 'adaptive',
      enableNaturalLanguage: true,
      requireEncryption: true,
      maxLatencyMs: 5000,
    };

    negotiator = new MetaProtocolNegotiator(
      LOCAL_DID,
      SUPPORTED_PROTOCOLS,
      LOCAL_CAPABILITIES,
      config,
    );
  });

  afterEach(async () => {
    await negotiator.stop();
  });

  describe('生命周期', () => {
    it('应该能够启动和停止', async () => {
      await negotiator.start();
      expect(negotiator).toBeDefined();

      await negotiator.stop();
    });

    it('启动后应该有正确的状态', async () => {
      await negotiator.start();
      // 验证协商器已正确初始化
      expect(negotiator['localDid']).toBe(LOCAL_DID);
      expect(negotiator['supportedProtocols']).toEqual(SUPPORTED_PROTOCOLS);
    });
  });

  describe('协议协商', () => {
    it('应该能够发起协议协商', async () => {
      await negotiator.start();

      const sessionId = await negotiator.initiateNegotiation(
        PEER_DID,
        'https://w3id.org/anp/protocols/genesis-prompt/v1',
        ['anp.protocol.negotiation'],
      );

      expect(sessionId).toBeDefined();
      expect(sessionId).toContain('meta-negotiation:');

      // 验证会话已创建
      const session = await negotiator.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.peerDid).toBe(PEER_DID);
      expect(session!.rounds.length).toBe(1);
    });

    it('应该能够处理协议接受', async () => {
      await negotiator.start();

      const proposal: ProtocolNegotiatePayload = {
        '@type': 'anp:ProtocolNegotiation',
        'anp:proposedProtocol': 'https://w3id.org/anp/protocols/genesis-prompt/v1',
        'anp:protocolVersion': '1.0.0',
        'anp:capabilities': ['task.execution'],
        'anp:constraints': {
          'anp:maxLatency': 1000,
          'anp:encryptionRequired': true,
        },
      };

      const message: ANPMessage = {
        '@context': ['https://www.w3.org/ns/activitystreams/v1'],
        '@type': 'ANPMessage',
        id: 'msg-1',
        timestamp: new Date(),
        actor: PEER_DID,
        target: LOCAL_DID,
        type: ANPMessageType.PROTOCOL_NEGOTIATE,
        object: proposal,
        signature: {} as any,
        correlationId: 'test-session-1',
      };

      const result = await negotiator.handleMessage(message);

      expect(result).toBeDefined();
      expect(result!.outcome).toBe(NegotiationOutcome.ACCEPTED);
      expect(result!.negotiatedProtocol).toBeDefined();
    });

    it('应该能够处理协议拒绝', async () => {
      await negotiator.start();

      const proposal: ProtocolNegotiatePayload = {
        '@type': 'anp:ProtocolNegotiation',
        'anp:proposedProtocol': 'https://w3id.org/anp/protocols/unsupported/v1',
        'anp:protocolVersion': '1.0.0',
        'anp:capabilities': [],
        'anp:constraints': {
          'anp:maxLatency': 1000,
          'anp:encryptionRequired': false,
        },
      };

      const message: ANPMessage = {
        '@context': ['https://www.w3.org/ns/activitystreams/v1'],
        '@type': 'ANPMessage',
        id: 'msg-2',
        timestamp: new Date(),
        actor: PEER_DID,
        target: LOCAL_DID,
        type: ANPMessageType.PROTOCOL_NEGOTIATE,
        object: proposal,
        signature: {} as any,
        correlationId: 'test-session-2',
      };

      const result = await negotiator.handleMessage(message);

      expect(result).toBeDefined();
      expect(result!.outcome).toBe(NegotiationOutcome.REJECTED);
      expect(result!.rejectionReason).toBeDefined();
    });
  });

  describe('会话管理', () => {
    it('应该能够获取活跃会话', async () => {
      await negotiator.start();

      const sessionId = await negotiator.initiateNegotiation(
        PEER_DID,
        'https://w3id.org/anp/protocols/genesis-prompt/v1',
        [],
      );

      const activeSessions = await negotiator.getActiveSessions();
      expect(activeSessions.length).toBeGreaterThan(0);

      const sessionIds = activeSessions.map((s) => s.sessionId);
      expect(sessionIds).toContain(sessionId);
    });

    it('应该能够获取已完成会话', async () => {
      await negotiator.start();

      // 创建一个已完成的会话
      const sessionId = 'completed-session';
      const result = new NegotiationResult();
      result.sessionId = sessionId;
      result.peerDid = PEER_DID;
      result.outcome = NegotiationOutcome.ACCEPTED;
      result.completedAt = new Date();

      // 手动添加到会话中
      negotiator['sessions'][sessionId] = result;

      const completedSessions = await negotiator.getCompletedSessions();
      expect(completedSessions.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// MetaProtocolProcessor 测试
// ============================================================================

describe('MetaProtocolProcessor', () => {
  let processor: MetaProtocolProcessor;
  let config: ProcessingConfig;

  beforeEach(() => {
    config = {
      enableAutoNegotiation: true,
      enableCapabilityCache: true,
      maxPendingNegotiations: 10,
      negotiationTimeoutSeconds: 300,
    };

    processor = new MetaProtocolProcessor(
      LOCAL_DID,
      SUPPORTED_PROTOCOLS,
      LOCAL_CAPABILITIES,
      config,
    );
  });

  afterEach(async () => {
    await processor.stop();
  });

  describe('消息处理', () => {
    it('应该能够处理协商消息', async () => {
      await processor.start();

      const proposal: ProtocolNegotiatePayload = {
        '@type': 'anp:ProtocolNegotiation',
        'anp:proposedProtocol': 'https://w3id.org/anp/protocols/genesis-prompt/v1',
        'anp:protocolVersion': '1.0.0',
        'anp:capabilities': [],
        'anp:constraints': {
          'anp:maxLatency': 1000,
          'anp:encryptionRequired': true,
        },
      };

      const message: ANPMessage = {
        '@context': ['https://www.w3.org/ns/activitystreams/v1'],
        '@type': 'ANPMessage',
        id: 'msg-3',
        timestamp: new Date(),
        actor: PEER_DID,
        target: LOCAL_DID,
        type: ANPMessageType.PROTOCOL_NEGOTIATE,
        object: proposal,
        signature: {} as any,
        correlationId: 'test-session-3',
      };

      const result = await processor.processMessage(message);

      expect(result).toBeDefined();
      expect(result!.outcome).toBe(NegotiationOutcome.ACCEPTED);
    });

    it('应该能够注册和处理协议处理器', async () => {
      await processor.start();

      let handlerCalled = false;
      const testHandler = vi.fn().mockImplementation(async () => {
        handlerCalled = true;
      });

      processor.registerProtocolHandler('custom-protocol', testHandler);

      const message: ANPMessage = {
        '@context': ['https://www.w3.org/ns/activitystreams/v1'],
        '@type': 'ANPMessage',
        id: 'msg-4',
        timestamp: new Date(),
        actor: PEER_DID,
        target: LOCAL_DID,
        type: 'custom-protocol' as any,
        object: {},
        signature: {} as any,
      };

      await processor.processMessage(message);

      expect(handlerCalled).toBe(true);
      expect(testHandler).toHaveBeenCalled();
    });
  });

  describe('协商接口', () => {
    it('应该能够发起协议协商', async () => {
      await processor.start();

      const sessionId = await processor.negotiateProtocol(
        PEER_DID,
        'https://w3id.org/anp/protocols/genesis-prompt/v1',
      );

      expect(sessionId).toBeDefined();

      const stats = processor.getStats();
      expect(stats.totalNegotiationsInitiated).toBeGreaterThan(0);
    });

    it('应该能够等待协商完成', async () => {
      await processor.start();

      // 先创建一个会话
      const sessionId = await processor.negotiateProtocol(
        PEER_DID,
        'https://w3id.org/anp/protocols/genesis-prompt/v1',
      );

      // 模拟接受
      const accept: ProtocolAcceptPayload = {
        '@type': 'anp:ProtocolAccept',
        'anp:acceptedProtocol': 'https://w3id.org/anp/protocols/genesis-prompt/v1',
        'anp:acceptedVersion': '1.0.0',
        'anp:sessionId': sessionId,
      };

      const message: ANPMessage = {
        '@context': ['https://www.w3.org/ns/activitystreams/v1'],
        '@type': 'ANPMessage',
        id: 'msg-5',
        timestamp: new Date(),
        actor: PEER_DID,
        target: LOCAL_DID,
        type: ANPMessageType.PROTOCOL_ACCEPT,
        object: accept,
        signature: {} as any,
        correlationId: sessionId,
      };

      // 异步处理接受消息
      setTimeout(() => processor.processMessage(message), 10);

      // 等待协商完成
      const result = await processor.waitForNegotiation(sessionId, 1);

      expect(result).toBeDefined();
      expect(result!.outcome).toBe(NegotiationOutcome.ACCEPTED);
    });
  });

  describe('能力管理', () => {
    it('应该能够获取本地能力', async () => {
      await processor.start();

      const capabilities = processor.getLocalCapabilities();

      expect(capabilities.length).toBeGreaterThan(0);
      expect(
        capabilities.some((c) => c['anp:capabilityId'] === 'anp.protocol.negotiation')
      ).toBe(true);
    });
  });

  describe('统计信息', () => {
    it('应该能够正确跟踪处理统计', async () => {
      await processor.start();

      const proposal: ProtocolNegotiatePayload = {
        '@type': 'anp:ProtocolNegotiation',
        'anp:proposedProtocol': 'https://w3id.org/anp/protocols/genesis-prompt/v1',
        'anp:protocolVersion': '1.0.0',
        'anp:capabilities': [],
        'anp:constraints': {
          'anp:maxLatency': 1000,
          'anp:encryptionRequired': true,
        },
      };

      const message: ANPMessage = {
        '@context': ['https://www.w3.org/ns/activitystreams/v1'],
        '@type': 'ANPMessage',
        id: 'msg-6',
        timestamp: new Date(),
        actor: PEER_DID,
        target: LOCAL_DID,
        type: ANPMessageType.PROTOCOL_NEGOTIATE,
        object: proposal,
        signature: {} as any,
        correlationId: 'test-session-6',
      };

      await processor.processMessage(message);

      const stats = processor.getStats();
      expect(stats.totalMessagesProcessed).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// 集成测试
// ============================================================================

describe('MetaProtocol Integration', () => {
  it('应该能够完成完整的协商流程', async () => {
    const processor = new MetaProtocolProcessor(
      LOCAL_DID,
      SUPPORTED_PROTOCOLS,
      LOCAL_CAPABILITIES,
    );

    await processor.start();

    // 发起协商
    const sessionId = await processor.negotiateProtocol(
      PEER_DID,
      'https://w3id.org/anp/protocols/genesis-prompt/v1',
    );

    // 模拟接受
    const accept: ProtocolAcceptPayload = {
      '@type': 'anp:ProtocolAccept',
      'anp:acceptedProtocol': 'https://w3id.org/anp/protocols/genesis-prompt/v1',
      'anp:acceptedVersion': '1.0.0',
      'anp:sessionId': sessionId,
    };

    const message: ANPMessage = {
      '@context': ['https://www.w3.org/ns/activitystreams/v1'],
      '@type': 'ANPMessage',
      id: 'msg-integration-1',
      timestamp: new Date(),
      actor: PEER_DID,
      target: LOCAL_DID,
      type: ANPMessageType.PROTOCOL_ACCEPT,
      object: accept,
      signature: {} as any,
      correlationId: sessionId,
    };

    const result = await processor.processMessage(message);

    expect(result).toBeDefined();
    expect(result!.outcome).toBe(NegotiationOutcome.ACCEPTED);
    expect(result!.negotiatedProtocol).toBeDefined();

    await processor.stop();
  });

  it('应该支持多轮协商', async () => {
    const processor = new MetaProtocolProcessor(
      LOCAL_DID,
      SUPPORTED_PROTOCOLS,
      LOCAL_CAPABILITIES,
      new NegotiationConfig({
        maxRounds: 5,
        strategy: 'flexible',
      }),
    );

    await processor.start();

    // 第一轮：发起协商
    const sessionId = await processor.negotiateProtocol(
      PEER_DID,
      'https://w3id.org/anp/protocols/genesis-prompt/v1',
    );

    // 第二轮：拒绝并提供替代方案
    const reject: ProtocolRejectPayload = {
      '@type': 'anp:ProtocolReject',
      'anp:rejectedReason': 'Version mismatch',
      'anp:alternativeProposal': {
        '@type': 'anp:ProtocolNegotiation',
        'anp:proposedProtocol': 'https://w3id.org/anp/protocols/genesis-prompt/v1',
        'anp:protocolVersion': '2.0.0',
        'anp:capabilities': [],
        'anp:constraints': {
          'anp:maxLatency': 1000,
          'anp:encryptionRequired': true,
        },
      },
    };

    const message: ANPMessage = {
      '@context': ['https://www.w3.org/ns/activitystreams/v1'],
      '@type': 'ANPMessage',
      id: 'msg-integration-2',
      timestamp: new Date(),
      actor: PEER_DID,
      target: LOCAL_DID,
      type: ANPMessageType.PROTOCOL_REJECT,
      object: reject,
      signature: {} as any,
      correlationId: sessionId,
    };

    const result = await processor.processMessage(message);

    // 由于是 flexible 策略，应该接受替代方案
    expect(result).toBeDefined();

    await processor.stop();
  });

  it('应该验证自然语言协商功能', async () => {
    const negotiator = new MetaProtocolNegotiator(
      LOCAL_DID,
      SUPPORTED_PROTOCOLS,
      LOCAL_CAPABILITIES,
      new NegotiationConfig({
        enableNaturalLanguage: true,
      }),
    );

    await negotiator.start();

    expect(negotiator['config'].enableNaturalLanguage).toBe(true);

    await negotiator.stop();
  });
});
