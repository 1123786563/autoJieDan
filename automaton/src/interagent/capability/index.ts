/**
 * ANP 能力发现服务
 *
 * 实现 Agent 能力查询与响应机制
 * 能力描述缓存与更新
 * 使用 JSON-LD 描述能力
 *
 * @module interagent/capability
 * @version 1.0.0
 */

// ============================================================================
// 类型定义
// ============================================================================

/** 能力范围 */
export type CapabilityScope = "local" | "remote" | "all";

/** 查询类型 */
export type QueryType = "all" | "filter";

/** 能力统计信息 */
export interface CapabilityStatistics {
  /** 本地能力数量 */
  localCapabilities: number;
  /** 缓存的远程 DID 数量 */
  cachedDids: number;
  /** 索引的能力 ID 数量 */
  indexedCapabilityIds: number;
  /** 按类型分类的本地能力 */
  localCapabilitiesByType: Record<string, number>;
  /** 缓存条目总数 */
  cacheEntries: number;
  /** 订阅者数量 */
  subscribers: number;
}

/** 缓存条目 */
export interface CacheEntry {
  /** DID */
  did: string;
  /** 能力列表 */
  capabilities: Capability[];
  /** 缓存时间 */
  cachedAt: Date;
  /** TTL (秒) */
  ttlSeconds: number;
  /** 访问计数 */
  accessCount: number;
}

/** 能力提供者信息 */
export interface CapabilityProvider {
  /** DID */
  did: string;
  /** 能力列表 */
  capabilities: string[];
}

// ============================================================================
// 能力类型 (从 ANP types 导入)
// ============================================================================

import type {
  Capability,
  CapabilityQueryPayload,
  CapabilityResponsePayload,
  AgentCapabilityDescription,
} from "../../anp/types.js";

// ============================================================================
// 缓存条目类
// ============================================================================

export class CapabilityCacheEntry {
  did: string;
  capabilities: Capability[];
  cachedAt: Date;
  ttlSeconds: number;
  accessCount: number;

  constructor(
    did: string,
    capabilities: Capability[],
    ttlSeconds: number = 3600
  ) {
    this.did = did;
    this.capabilities = capabilities;
    this.cachedAt = new Date();
    this.ttlSeconds = ttlSeconds;
    this.accessCount = 0;
  }

  /** 检查是否过期 */
  isExpired(): boolean {
    const elapsed = (Date.now() - this.cachedAt.getTime()) / 1000;
    return elapsed > this.ttlSeconds;
  }

  /** 增加访问计数 */
  touch(): void {
    this.accessCount++;
  }
}

// ============================================================================
// 能力发现服务
// ============================================================================

export interface CapabilityDiscoveryOptions {
  /** 本地 DID */
  localDid: string;
  /** 本地能力列表 */
  localCapabilities: Capability[];
  /** 缓存 TTL (秒) */
  cacheTtlSeconds?: number;
}

/**
 * ANP 能力发现服务
 *
 * 功能:
 * - 查询本地/远程代理能力
 * - 能力描述缓存
 * - 能力更新通知
 * - 能力过滤与搜索
 */
export class CapabilityDiscoveryService {
  private localDid: string;
  private localCapabilities: Capability[];
  private cacheTtlSeconds: number;

  /** 能力缓存: DID -> 能力列表 */
  private cache: Map<string, CapabilityCacheEntry>;

  /** 能力索引: capability_id -> [DIDs] */
  private capabilityIndex: Map<string, string[]>;

  /** 能力更新订阅者 */
  private subscribers: Map<string, AsyncIterableIterator<unknown>>;

  constructor(options: CapabilityDiscoveryOptions) {
    this.localDid = options.localDid;
    this.localCapabilities = options.localCapabilities;
    this.cacheTtlSeconds = options.cacheTtlSeconds ?? 3600;

    this.cache = new Map();
    this.capabilityIndex = new Map();
    this.subscribers = new Map();

    // 构建本地能力索引
    this.rebuildIndex();
  }

  /** 重建能力索引 */
  private rebuildIndex(): void {
    this.capabilityIndex.clear();
    for (const cap of this.localCapabilities) {
      const capId = cap["anp:capabilityId"];
      if (!this.capabilityIndex.has(capId)) {
        this.capabilityIndex.set(capId, []);
      }
      this.capabilityIndex.get(capId)!.push(this.localDid);
    }
  }

  /** 获取本地能力列表 */
  async getLocalCapabilities(): Promise<Capability[]> {
    return [...this.localCapabilities];
  }

  /** 获取指定的本地能力 */
  async getLocalCapability(capabilityId: string): Promise<Capability | null> {
    for (const cap of this.localCapabilities) {
      if (cap["anp:capabilityId"] === capabilityId) {
        return cap;
      }
    }
    return null;
  }

  /** 查询能力 */
  async queryCapabilities(
    targetDid?: string,
    queryType: QueryType = "all",
    filter?: Record<string, unknown>
  ): Promise<Capability[]> {
    let capabilities: Capability[];

    if (!targetDid || targetDid === this.localDid) {
      // 查询本地能力
      capabilities = [...this.localCapabilities];
    } else {
      // 查询缓存的远程能力
      capabilities = await this.getCachedCapabilities(targetDid);
    }

    // 应用过滤
    if (queryType === "filter" && filter) {
      capabilities = this.applyFilter(capabilities, filter);
    }

    return capabilities;
  }

  /** 应用过滤条件 */
  private applyFilter(
    capabilities: Capability[],
    filter: Record<string, unknown>
  ): Capability[] {
    const result: Capability[] = [];

    for (const cap of capabilities) {
      let match = true;

      // 名称过滤
      if ("name" in filter && typeof filter.name === "string") {
        if (!cap["anp:name"].toLowerCase().includes(filter.name.toLowerCase())) {
          match = false;
        }
      }

      // 能力 ID 过滤
      if ("capabilityId" in filter && typeof filter.capabilityId === "string") {
        if (cap["anp:capabilityId"] !== filter.capabilityId) {
          match = false;
        }
      }

      // 语言过滤
      if ("supportedLanguages" in filter && Array.isArray(filter.supportedLanguages)) {
        const requiredLanguages = new Set(filter.supportedLanguages as string[]);
        const availableLanguages = new Set(cap["anp:supportedLanguages"] || []);
        for (const lang of requiredLanguages) {
          if (!availableLanguages.has(lang)) {
            match = false;
            break;
          }
        }
      }

      // 框架过滤
      if ("supportedFrameworks" in filter && Array.isArray(filter.supportedFrameworks)) {
        const requiredFrameworks = new Set(filter.supportedFrameworks as string[]);
        const availableFrameworks = new Set(cap["anp:supportedFrameworks"] || []);
        for (const framework of requiredFrameworks) {
          if (!availableFrameworks.has(framework)) {
            match = false;
            break;
          }
        }
      }

      // 工具过滤
      if ("tools" in filter && Array.isArray(filter.tools)) {
        const requiredTools = new Set(filter.tools as string[]);
        const availableTools = new Set(cap["anp:tools"] || []);
        for (const tool of requiredTools) {
          if (!availableTools.has(tool)) {
            match = false;
            break;
          }
        }
      }

      if (match) {
        result.push(cap);
      }
    }

    return result;
  }

  /** 从缓存获取能力列表 */
  private async getCachedCapabilities(did: string): Promise<Capability[]> {
    const entry = this.cache.get(did);
    if (!entry || entry.isExpired()) {
      // 缓存未命中或已过期，返回空列表
      // 实际应用中应该从远程获取
      return [];
    }

    entry.touch();
    return [...entry.capabilities];
  }

  /** 缓存能力列表 */
  async cacheCapabilities(
    did: string,
    capabilities: Capability[],
    ttlSeconds?: number
  ): Promise<void> {
    const entry = new CapabilityCacheEntry(
      did,
      capabilities,
      ttlSeconds ?? this.cacheTtlSeconds
    );
    this.cache.set(did, entry);

    // 更新索引
    for (const cap of capabilities) {
      const capId = cap["anp:capabilityId"];
      if (!this.capabilityIndex.has(capId)) {
        this.capabilityIndex.set(capId, []);
      }
      const dids = this.capabilityIndex.get(capId)!;
      if (!dids.includes(did)) {
        dids.push(did);
      }
    }
  }

  /** 搜索能力 */
  async searchCapabilities(
    keyword: string,
    scope: CapabilityScope = "all"
  ): Promise<Array<[Capability, string]>> {
    const results: Array<[Capability, string]> = [];
    const keywordLower = keyword.toLowerCase();

    // 搜索本地能力
    if (scope === "local" || scope === "all") {
      for (const cap of this.localCapabilities) {
        const name = cap["anp:name"].toLowerCase();
        const description = cap["anp:description"].toLowerCase();
        const capId = cap["anp:capabilityId"].toLowerCase();

        if (
          name.includes(keywordLower) ||
          description.includes(keywordLower) ||
          capId.includes(keywordLower)
        ) {
          results.push([cap, this.localDid]);
        }
      }
    }

    // 搜索缓存的远程能力
    if (scope === "remote" || scope === "all") {
      for (const [did, entry] of this.cache.entries()) {
        if (entry.isExpired()) {
          continue;
        }
        for (const cap of entry.capabilities) {
          const name = cap["anp:name"].toLowerCase();
          const description = cap["anp:description"].toLowerCase();
          const capId = cap["anp:capabilityId"].toLowerCase();

          if (
            name.includes(keywordLower) ||
            description.includes(keywordLower) ||
            capId.includes(keywordLower)
          ) {
            results.push([cap, did]);
          }
        }
      }
    }

    return results;
  }

  /** 获取提供指定能力的代理 DID 列表 */
  async getCapabilityProviders(capabilityId: string): Promise<string[]> {
    const dids = this.capabilityIndex.get(capabilityId);
    return dids ? [...dids] : [];
  }

  /** 创建能力查询负载 */
  async createCapabilityQuery(
    queryType: QueryType = "all",
    filter?: Record<string, unknown>
  ): Promise<CapabilityQueryPayload> {
    return {
      "@type": "anp:CapabilityQuery",
      "anp:queryType": queryType,
      "anp:filter": filter,
    };
  }

  /** 创建能力响应负载 */
  async createCapabilityResponse(
    capabilities: Capability[]
  ): Promise<CapabilityResponsePayload> {
    return {
      "@type": "anp:CapabilityResponse",
      "anp:capabilities": capabilities,
    };
  }

  /** 获取能力统计信息 */
  async getCapabilityStatistics(): Promise<CapabilityStatistics> {
    const localCapabilities = this.localCapabilities.length;
    const cachedDids = Array.from(this.cache.values()).filter(
      (e) => !e.isExpired()
    ).length;
    const indexedCapabilityIds = this.capabilityIndex.size;

    // 按类型统计
    const localCapabilitiesByType: Record<string, number> = {};
    for (const cap of this.localCapabilities) {
      let capType = "unknown";
      if (cap["anp:supportedLanguages"]?.length) {
        capType = "development";
      } else if (cap["anp:channels"]?.length) {
        capType = "communication";
      }
      localCapabilitiesByType[capType] = (localCapabilitiesByType[capType] || 0) + 1;
    }

    return {
      localCapabilities,
      cachedDids,
      indexedCapabilityIds,
      localCapabilitiesByType,
      cacheEntries: this.cache.size,
      subscribers: this.subscribers.size,
    };
  }

  /** 清理过期的缓存条目 */
  async cleanupExpiredCache(): Promise<number> {
    let cleaned = 0;
    for (const [did, entry] of this.cache.entries()) {
      if (entry.isExpired()) {
        this.cache.delete(did);
        cleaned++;
      }
    }
    return cleaned;
  }

  /** 构建代理能力描述 */
  buildCapabilityDescription(
    name: string,
    description: string,
    capabilities: string[]
  ): AgentCapabilityDescription {
    return {
      "@context": "https://schema.org",
      "@type": "SoftwareAgent",
      name,
      description,
      capabilities,
    };
  }
}

// ============================================================================
// 预定义的常见能力模板
// ============================================================================

/** 预定义能力模板 */
export const COMMON_CAPABILITY_TEMPLATES: Record<string, Capability> = {
  "code-generation": {
    "@type": "anp:Capability",
    "anp:capabilityId": "code-generation",
    "anp:name": "代码生成",
    "anp:description": "全栈代码开发、重构、优化",
    "anp:supportedLanguages": ["TypeScript", "Python", "Rust", "Go"],
    "anp:supportedFrameworks": ["React", "Next.js", "FastAPI", "Django"],
  },
  testing: {
    "@type": "anp:Capability",
    "anp:capabilityId": "testing",
    "anp:name": "测试执行",
    "anp:description": "单元测试、集成测试、E2E 测试",
    "anp:tools": ["vitest", "pytest", "playwright"],
  },
  "customer-communication": {
    "@type": "anp:Capability",
    "anp:capabilityId": "customer-communication",
    "anp:name": "客户沟通",
    "anp:description": "需求澄清、进度报告、反馈处理",
    "anp:channels": ["telegram", "slack", "email", "discord"],
  },
  "economic-decision": {
    "@type": "anp:Capability",
    "anp:capabilityId": "economic-decision",
    "anp:name": "经济决策",
    "anp:description": "项目筛选、合同评估、资源分配",
  },
  "project-management": {
    "@type": "anp:Capability",
    "anp:capabilityId": "project-management",
    "anp:name": "项目管理",
    "anp:description": "任务分发、进度跟踪、验收确认",
  },
  "blockchain-operations": {
    "@type": "anp:Capability",
    "anp:capabilityId": "blockchain-operations",
    "anp:name": "区块链操作",
    "anp:description": "钱包管理、交易签名、智能合约交互",
  },
};

/** 获取预定义的能力模板 */
export function getCapabilityTemplate(capabilityId: string): Capability | undefined {
  return COMMON_CAPABILITY_TEMPLATES[capabilityId];
}

// ============================================================================
// 导出
// ============================================================================

export * from "../../anp/types.js";
