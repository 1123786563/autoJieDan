/**
 * ANP DID 解析器
 * 实现远程 DID 文档解析，支持从外部解析器获取 DID 文档
 *
 * @module anp/resolver
 * @version 1.0.0
 */

import type { DidDocument } from "./types.js";

// ============================================================================
// 类型定义
// ============================================================================

/** 解析器配置 */
export interface ResolverConfig {
  /** 缓存 TTL (毫秒) */
  cacheTtl?: number;
  /** 请求超时 (毫秒) */
  timeout?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 自定义解析端点 */
  endpoints?: Map<string, string>;
}

/** 缓存条目 */
interface CacheEntry {
  document: DidDocument;
  expiry: number;
}

/** 解析结果 */
export interface ResolutionResult {
  /** 是否成功 */
  success: boolean;
  /** DID 文档 */
  document?: DidDocument;
  /** 错误信息 */
  error?: string;
  /** 元数据 */
  metadata?: {
    /** 来源 */
    source: "cache" | "network" | "local";
    /** 解析时间 (毫秒) */
    duration: number;
    /** 是否从缓存获取 */
    cached: boolean;
  };
}

// ============================================================================
// DID 解析器接口
// ============================================================================

/**
 * DID 解析器基类
 */
export interface DIDResolver {
  /**
   * 解析 DID 文档
   * @param did - 要解析的 DID
   * @returns 解析结果
   */
  resolve(did: string): Promise<ResolutionResult>;
}

// ============================================================================
// HTTP DID 解析器
// ============================================================================

/**
 * HTTP/HTTPS DID 解析器
 *
 * 支持通过 HTTP 解析远程 DID 文档
 *
 * @example
 * ```typescript
 * const resolver = new HTTPDIDResolver({
 *   cacheTtl: 3600000, // 1 hour
 *   timeout: 5000,
 * });
 *
 * const result = await resolver.resolve("did:anp:example.com:agent123");
 * if (result.success) {
 *   console.log(result.document);
 * }
 * ```
 */
export class HTTPDIDResolver implements DIDResolver {
  private cache: Map<string, CacheEntry> = new Map();
  private config: Required<ResolverConfig>;

  private static readonly DEFAULT_CONFIG: Required<ResolverConfig> = {
    cacheTtl: 3600000, // 1 hour
    timeout: 5000,
    maxRetries: 2,
    endpoints: new Map(),
  };

  constructor(config?: ResolverConfig) {
    this.config = { ...HTTPDIDResolver.DEFAULT_CONFIG, ...config };
  }

  /**
   * 解析 DID 文档
   */
  async resolve(did: string): Promise<ResolutionResult> {
    const startTime = Date.now();

    // 1. 验证 DID 格式
    if (!this.isValidDID(did)) {
      return {
        success: false,
        error: `Invalid DID format: ${did}`,
        metadata: { source: "local", duration: 0, cached: false },
      };
    }

    // 2. 检查缓存
    const cached = this.getFromCache(did);
    if (cached) {
      return {
        success: true,
        document: cached,
        metadata: {
          source: "cache",
          duration: Date.now() - startTime,
          cached: true,
        },
      };
    }

    // 3. 从网络解析
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const document = await this.fetchFromNetwork(did);

        // 存入缓存
        this.addToCache(did, document);

        return {
          success: true,
          document,
          metadata: {
            source: "network",
            duration: Date.now() - startTime,
            cached: false,
          },
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Unknown error";

        // 如果是最后一次尝试，不再等待
        if (attempt < this.config.maxRetries) {
          await this.delay(100 * (attempt + 1));
        }
      }
    }

    return {
      success: false,
      error: lastError ?? "Resolution failed",
      metadata: {
        source: "network",
        duration: Date.now() - startTime,
        cached: false,
      },
    };
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清除过期的缓存条目
   */
  pruneCache(): number {
    const now = Date.now();
    let pruned = 0;

    for (const [did, entry] of this.cache.entries()) {
      if (entry.expiry <= now) {
        this.cache.delete(did);
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; oldestEntry: number | null } {
    let oldest: number | null = null;

    for (const entry of this.cache.values()) {
      if (oldest === null || entry.expiry < oldest) {
        oldest = entry.expiry;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry: oldest,
    };
  }

  // ------------------------------------------------------------------------
  // 私有方法
  // ------------------------------------------------------------------------

  /**
   * 验证 DID 格式
   */
  private isValidDID(did: string): boolean {
    // 支持的 DID 方法: anp, web, key
    const didPattern = /^did:(anp|web|key):.+$/;
    return didPattern.test(did);
  }

  /**
   * 从缓存获取 DID 文档
   */
  private getFromCache(did: string): DidDocument | null {
    const entry = this.cache.get(did);

    if (!entry) {
      return null;
    }

    // 检查是否过期
    if (entry.expiry <= Date.now()) {
      this.cache.delete(did);
      return null;
    }

    return entry.document;
  }

  /**
   * 添加到缓存
   */
  private addToCache(did: string, document: DidDocument): void {
    const expiry = Date.now() + this.config.cacheTtl;
    this.cache.set(did, { document, expiry });
  }

  /**
   * 从网络获取 DID 文档
   */
  private async fetchFromNetwork(did: string): Promise<DidDocument> {
    const url = this.constructResolutionUrl(did);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const document = (await response.json()) as DidDocument;

      // 验证文档
      if (!this.validateDocument(document, did)) {
        throw new Error("Invalid DID document");
      }

      return document;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error) {
        if (error.name === "AbortError") {
          throw new Error("Request timeout");
        }
        throw error;
      }

      throw new Error("Network request failed");
    }
  }

  /**
   * 构造解析 URL
   *
   * did:anp:example.com:agent123 -> https://example.com/.well-known/did/anp/agent123
   * did:web:example.com -> https://example.com/.well-known/did.json
   */
  private constructResolutionUrl(did: string): string {
    // 检查自定义端点
    const customEndpoint = this.config.endpoints.get(did);
    if (customEndpoint) {
      return customEndpoint;
    }

    // ANP DID
    const anpMatch = did.match(/^did:anp:([^:]+):(.+)$/);
    if (anpMatch) {
      return `https://${anpMatch[1]}/.well-known/did/anp/${anpMatch[2]}`;
    }

    // Web DID
    const webMatch = did.match(/^did:web:(.+)$/);
    if (webMatch) {
      const domain = webMatch[1].replace(/:/g, "/");
      return `https://${domain}/.well-known/did.json`;
    }

    // Key DID - 无法远程解析
    throw new Error(`Cannot resolve did:key remotely: ${did}`);
  }

  /**
   * 验证 DID 文档
   */
  private validateDocument(document: DidDocument, expectedDid: string): boolean {
    // 检查必需字段
    if (!document.id || !document["@context"]) {
      return false;
    }

    // 检查 DID 匹配
    if (document.id !== expectedDid) {
      return false;
    }

    // 检查验证方法
    if (
      !document.verificationMethod ||
      !Array.isArray(document.verificationMethod) ||
      document.verificationMethod.length === 0
    ) {
      return false;
    }

    return true;
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// 复合解析器
// ============================================================================

/**
 * 复合 DID 解析器
 *
 * 支持从多个来源解析 DID 文档，按优先级尝试
 */
export class CompositeResolver implements DIDResolver {
  private resolvers: DIDResolver[];

  constructor(resolvers: DIDResolver[]) {
    this.resolvers = resolvers;
  }

  async resolve(did: string): Promise<ResolutionResult> {
    const startTime = Date.now();
    const errors: string[] = [];

    for (const resolver of this.resolvers) {
      const result = await resolver.resolve(did);

      if (result.success) {
        return result;
      }

      if (result.error) {
        errors.push(result.error);
      }
    }

    return {
      success: false,
      error: `All resolvers failed: ${errors.join("; ")}`,
      metadata: {
        source: "network",
        duration: Date.now() - startTime,
        cached: false,
      },
    };
  }
}

// ============================================================================
// 本地解析器
// ============================================================================

/**
 * 本地 DID 解析器
 *
 * 用于解析本地预配置的 DID 文档
 */
export class LocalResolver implements DIDResolver {
  private documents: Map<string, DidDocument>;

  constructor(documents: Map<string, DidDocument>) {
    this.documents = documents;
  }

  async resolve(did: string): Promise<ResolutionResult> {
    const startTime = Date.now();
    const document = this.documents.get(did);

    if (document) {
      return {
        success: true,
        document,
        metadata: {
          source: "local",
          duration: Date.now() - startTime,
          cached: false,
        },
      };
    }

    return {
      success: false,
      error: `DID not found in local store: ${did}`,
      metadata: {
        source: "local",
        duration: Date.now() - startTime,
        cached: false,
      },
    };
  }

  /**
   * 添加本地 DID 文档
   */
  addDocument(did: string, document: DidDocument): void {
    this.documents.set(did, document);
  }

  /**
   * 移除本地 DID 文档
   */
  removeDocument(did: string): boolean {
    return this.documents.delete(did);
  }
}

// ============================================================================
// 全局解析器实例
// ============================================================================

/** 默认全局解析器 */
let globalResolver: DIDResolver | null = null;

/**
 * 获取全局 DID 解析器
 */
export function getGlobalResolver(): DIDResolver {
  if (!globalResolver) {
    globalResolver = new HTTPDIDResolver();
  }
  return globalResolver;
}

/**
 * 设置全局 DID 解析器
 */
export function setGlobalResolver(resolver: DIDResolver): void {
  globalResolver = resolver;
}

/**
 * 解析 DID 文档 (使用全局解析器)
 */
export async function resolveDID(did: string): Promise<ResolutionResult> {
  return getGlobalResolver().resolve(did);
}
