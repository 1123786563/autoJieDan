/**
 * ANP 能力发现服务测试
 *
 * 测试能力查询与响应机制
 * 能力描述缓存与更新
 * 能力过滤与搜索
 *
 * @module tests/interagent/capability-discovery
 * @version 1.0.0
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  CapabilityDiscoveryService,
  CapabilityCacheEntry,
  getCapabilityTemplate,
  COMMON_CAPABILITY_TEMPLATES,
} from "../../interagent/capability/index.js";
import type { Capability } from "../../anp/types.js";

describe("CapabilityCacheEntry", () => {
  it("应该创建缓存条目", () => {
    const capabilities: Capability[] = [
      {
        "@type": "anp:Capability",
        "anp:capabilityId": "test-cap",
        "anp:name": "Test Capability",
        "anp:description": "A test capability",
      },
    ];
    const entry = new CapabilityCacheEntry("did:anp:test:agent", capabilities, 3600);

    expect(entry.did).toBe("did:anp:test:agent");
    expect(entry.capabilities).toHaveLength(1);
    expect(entry.ttlSeconds).toBe(3600);
    expect(entry.accessCount).toBe(0);
    expect(entry.isExpired()).toBe(false);
  });

  it("应该检测过期条目", () => {
    const capabilities: Capability[] = [];
    // 创建已过期的缓存条目（TTL 为 0）
    const entry = new CapabilityCacheEntry("did:anp:test:agent", capabilities, 0);

    // 等待 1ms 确保过期
    const startTime = Date.now();
    while (Date.now() - startTime < 10) {
      // 忙等待 10ms
    }

    // 现在应该过期
    expect(entry.isExpired()).toBe(true);
  });

  it("应该增加访问计数", () => {
    const entry = new CapabilityCacheEntry("did:anp:test:agent", []);

    expect(entry.accessCount).toBe(0);
    entry.touch();
    expect(entry.accessCount).toBe(1);
    entry.touch();
    expect(entry.accessCount).toBe(2);
  });
});

describe("CapabilityDiscoveryService", () => {
  let service: CapabilityDiscoveryService;
  const localCapabilities: Capability[] = [
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "code-generation",
      "anp:name": "代码生成",
      "anp:description": "全栈代码开发、重构、优化",
      "anp:supportedLanguages": ["TypeScript", "Python"],
      "anp:supportedFrameworks": ["React", "FastAPI"],
    },
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "testing",
      "anp:name": "测试执行",
      "anp:description": "单元测试、集成测试、E2E 测试",
      "anp:tools": ["vitest", "pytest", "playwright"],
    },
    {
      "@type": "anp:Capability",
      "anp:capabilityId": "customer-communication",
      "anp:name": "客户沟通",
      "anp:description": "需求澄清、进度报告、反馈处理",
      "anp:channels": ["telegram", "slack"],
    },
  ];

  beforeEach(() => {
    service = new CapabilityDiscoveryService({
      localDid: "did:anp:test:local",
      localCapabilities,
      cacheTtlSeconds: 3600,
    });
  });

  describe("本地能力查询", () => {
    it("应该获取本地能力列表", async () => {
      const capabilities = await service.getLocalCapabilities();

      expect(capabilities).toHaveLength(3);
      expect(capabilities[0]["anp:capabilityId"]).toBe("code-generation");
      expect(capabilities[1]["anp:capabilityId"]).toBe("testing");
      expect(capabilities[2]["anp:capabilityId"]).toBe("customer-communication");
    });

    it("应该获取指定的本地能力", async () => {
      const cap = await service.getLocalCapability("testing");

      expect(cap).not.toBeNull();
      expect(cap!["anp:capabilityId"]).toBe("testing");
      expect(cap!["anp:name"]).toBe("测试执行");
    });

    it("查询不存在的本地能力应返回 null", async () => {
      const cap = await service.getLocalCapability("nonexistent");

      expect(cap).toBeNull();
    });

    it("应该查询本地能力", async () => {
      const capabilities = await service.queryCapabilities("did:anp:test:local");

      expect(capabilities).toHaveLength(3);
    });
  });

  describe("能力过滤", () => {
    it("应该按名称过滤", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        { name: "测试" }
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("testing");
    });

    it("应该按能力 ID 过滤", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        { capabilityId: "code-generation" }
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("code-generation");
    });

    it("应该按支持语言过滤", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        { supportedLanguages: ["TypeScript"] }
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("code-generation");
    });

    it("应该按支持框架过滤", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        { supportedFrameworks: ["React", "FastAPI"] }
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("code-generation");
    });

    it("应该按工具过滤", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        { tools: ["pytest"] }
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("testing");
    });

    it("应该支持多重过滤", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        {
          name: "代码",
          supportedLanguages: ["TypeScript"],
        }
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("code-generation");
    });

    it("无匹配结果时应返回空数组", async () => {
      const capabilities = await service.queryCapabilities(
        undefined,
        "filter",
        { supportedLanguages: ["COBOL"] }
      );

      expect(capabilities).toEqual([]);
    });
  });

  describe("能力缓存", () => {
    it("应该缓存能力列表", async () => {
      const remoteCapabilities: Capability[] = [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "data-analysis",
          "anp:name": "数据分析",
          "anp:description": "数据清洗、可视化、统计分析",
          "anp:supportedLanguages": ["Python", "R"],
        },
      ];

      await service.cacheCapabilities(
        "did:anp:test:remote",
        remoteCapabilities
      );

      // 验证缓存
      const capabilities = await service.queryCapabilities(
        "did:anp:test:remote"
      );

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("data-analysis");
    });

    it("应该使用自定义 TTL 缓存能力", async () => {
      const remoteCapabilities: Capability[] = [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "ml-training",
          "anp:name": "机器学习",
          "anp:description": "模型训练、调优、部署",
        },
      ];

      await service.cacheCapabilities(
        "did:anp:test:ml",
        remoteCapabilities,
        60 // 1 分钟 TTL
      );

      const capabilities = await service.queryCapabilities("did:anp:test:ml");

      expect(capabilities).toHaveLength(1);
      expect(capabilities[0]["anp:capabilityId"]).toBe("ml-training");
    });

    it("缓存未命中时应返回空数组", async () => {
      const capabilities = await service.queryCapabilities(
        "did:anp:test:remote"
      );

      expect(capabilities).toEqual([]);
    });
  });

  describe("能力搜索", () => {
    it("应该搜索本地能力", async () => {
      const results = await service.searchCapabilities("代码", "local");

      expect(results).toHaveLength(1);
      expect(results[0][0]["anp:capabilityId"]).toBe("code-generation");
      expect(results[0][1]).toBe("did:anp:test:local");
    });

    it("应该搜索所有能力", async () => {
      // 先缓存一些远程能力
      await service.cacheCapabilities("did:anp:test:remote", [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "image-processing",
          "anp:name": "图像处理",
          "anp:description": "图像识别、处理、生成",
        },
      ]);

      const results = await service.searchCapabilities("图像", "all");

      expect(results).toHaveLength(1);
      expect(results[0][0]["anp:capabilityId"]).toBe("image-processing");
    });
  });

  describe("能力提供者", () => {
    it("应该获取能力提供者", async () => {
      // 缓存多个提供者的相同能力
      await service.cacheCapabilities("did:anp:test:provider1", [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "code-generation",
          "anp:name": "代码生成 V2",
          "anp:description": "另一个代码生成能力",
        },
      ]);

      const providers = await service.getCapabilityProviders("code-generation");

      // 应该包含本地和远程提供者
      expect(providers).toContain("did:anp:test:local");
      expect(providers).toContain("did:anp:test:provider1");
    });
  });

  describe("缓存管理", () => {
    it("应该清理过期缓存", async () => {
      // 添加一个立即过期的缓存
      await service.cacheCapabilities(
        "did:anp:test:expiring",
        [
          {
            "@type": "anp:Capability",
            "anp:capabilityId": "temp-cap",
            "anp:name": "临时能力",
          },
        ],
        0 // 立即过期
      );

      // 等待一段时间确保过期
      await new Promise((resolve) => setTimeout(resolve, 10));

      // 清理过期缓存
      const cleaned = await service.cleanupExpiredCache();

      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });

  describe("能力统计", () => {
    it("应该获取能力统计信息", async () => {
      // 添加一些缓存
      await service.cacheCapabilities("did:anp:test:cached", [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "cached-cap",
          "anp:name": "缓存能力",
        },
      ]);

      const stats = await service.getCapabilityStatistics();

      expect(stats.localCapabilities).toBe(3);
      expect(stats.cachedDids).toBeGreaterThanOrEqual(1);
      expect(stats.indexedCapabilityIds).toBeGreaterThan(0);
    });
  });

  describe("ANP 负载创建", () => {
    it("应该创建能力查询负载", async () => {
      const query = await service.createCapabilityQuery();

      expect(query["@type"]).toBe("anp:CapabilityQuery");
      expect(query["anp:queryType"]).toBe("all");
      expect(query["anp:filter"]).toBeUndefined();
    });

    it("应该创建带过滤的查询负载", async () => {
      const query = await service.createCapabilityQuery("filter", {
        capabilityId: "code-generation",
      });

      expect(query["@type"]).toBe("anp:CapabilityQuery");
      expect(query["anp:queryType"]).toBe("filter");
      expect(query["anp:filter"]).toEqual({
        capabilityId: "code-generation",
      });
    });

    it("应该创建能力响应负载", async () => {
      const capabilities = await service.getLocalCapabilities();
      const response = await service.createCapabilityResponse(capabilities);

      expect(response["@type"]).toBe("anp:CapabilityResponse");
      expect(response["anp:capabilities"]).toHaveLength(3);
    });
  });

  describe("能力描述构建", () => {
    it("应该构建代理能力描述", () => {
      const description = service.buildCapabilityDescription(
        "Test Agent",
        "A test agent",
        ["code-generation", "testing"]
      );

      expect(description.name).toBe("Test Agent");
      expect(description.description).toBe("A test agent");
      expect(description.capabilities).toHaveLength(2);
      expect(description.capabilities).toContain("code-generation");
      expect(description.capabilities).toContain("testing");
    });
  });
});

describe("CapabilityTemplates", () => {
  it("应该获取预定义的能力模板", () => {
    const template = getCapabilityTemplate("code-generation");

    expect(template).toBeDefined();
    expect(template!["anp:capabilityId"]).toBe("code-generation");
    expect(template!["anp:name"]).toBe("代码生成");
  });

  it("获取不存在的模板应返回 undefined", () => {
    const template = getCapabilityTemplate("nonexistent");

    expect(template).toBeUndefined();
  });

  it("应该包含所有常见能力模板", () => {
    const expectedTemplates = [
      "code-generation",
      "testing",
      "customer-communication",
      "economic-decision",
      "project-management",
      "blockchain-operations",
    ];

    for (const templateId of expectedTemplates) {
      const template = getCapabilityTemplate(templateId);
      expect(template).toBeDefined();
      expect(template!["anp:capabilityId"]).toBe(templateId);
    }
  });
});

describe("CapabilityDiscoveryIntegration", () => {
  it("应该测试完整的能力发现流程", async () => {
    // 创建两个服务（代表两个代理）
    const serviceA = new CapabilityDiscoveryService({
      localDid: "did:anp:agent_a",
      localCapabilities: [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "code-generation",
          "anp:name": "代码生成",
          "anp:description": "全栈代码开发",
          "anp:supportedLanguages": ["TypeScript", "Python"],
        },
      ],
    });

    const serviceB = new CapabilityDiscoveryService({
      localDid: "did:anp:agent_b",
      localCapabilities: [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "testing",
          "anp:name": "测试执行",
          "anp:description": "单元测试、集成测试",
          "anp:tools": ["pytest", "playwright"],
        },
      ],
    });

    // Agent A 查询自己的能力
    const localCaps = await serviceA.queryCapabilities();
    expect(localCaps).toHaveLength(1);

    // Agent B 缓存到 Agent A
    const remoteCaps = await serviceB.queryCapabilities();
    await serviceA.cacheCapabilities("did:anp:agent_b", remoteCaps);

    // Agent A 现在应该能查询到 Agent B 的能力
    const allCaps = await serviceA.queryCapabilities("did:anp:agent_b");
    expect(allCaps).toHaveLength(1);
    expect(allCaps[0]["anp:capabilityId"]).toBe("testing");

    // 搜索能力
    const results = await serviceA.searchCapabilities("测试", "all");
    expect(results).toHaveLength(1);
    expect(results[0][0]["anp:capabilityId"]).toBe("testing");
  });
});

describe("性能测试", () => {
  it("能力查询响应时间应少于 1 秒", async () => {
    const service = new CapabilityDiscoveryService({
      localDid: "did:anp:test:local",
      localCapabilities: [
        {
          "@type": "anp:Capability",
          "anp:capabilityId": "test",
          "anp:name": "Test",
          "anp:description": "Test capability",
        },
      ],
    });

    const startTime = Date.now();
    await service.queryCapabilities();
    const elapsed = Date.now() - startTime;

    expect(elapsed).toBeLessThan(1000);
  });
});
