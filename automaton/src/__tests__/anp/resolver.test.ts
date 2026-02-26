/**
 * ANP DID 解析器测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  HTTPDIDResolver,
  CompositeResolver,
  LocalResolver,
  ResolverConfig,
  type DidDocument,
} from "../../anp/index.js";

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

// 测试用 DID 文档
const mockDidDocument: DidDocument = {
  "@context": ["https://www.w3.org/ns/did/v1"],
  id: "did:anp:example.com:agent123",
  controller: "did:anp:example.com:agent123",
  verificationMethod: [
    {
      id: "did:anp:example.com:agent123#key-1",
      type: "JsonWebKey2020",
      controller: "did:anp:example.com:agent123",
      publicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: "test-x",
        y: "test-y",
      },
    },
  ],
  authentication: ["did:anp:example.com:agent123#key-1"],
  keyAgreement: [],
  service: [
    {
      id: "did:anp:example.com:agent123#service",
      type: "ANPMessageService",
      serviceEndpoint: "https://example.com/anp",
    },
  ],
};

describe("HTTPDIDResolver", () => {
  let resolver: HTTPDIDResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    resolver = new HTTPDIDResolver({
      cacheTtl: 1000,
      timeout: 1000,
      maxRetries: 1,
    });
  });

  describe("resolve", () => {
    it("should reject invalid DID format", async () => {
      const result = await resolver.resolve("invalid-did");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid DID format");
    });

    it("should resolve ANP DID from network", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDocument),
      });

      const result = await resolver.resolve("did:anp:example.com:agent123");

      expect(result.success).toBe(true);
      expect(result.document).toBeDefined();
      expect(result.document?.id).toBe("did:anp:example.com:agent123");
      expect(result.metadata?.source).toBe("network");
      expect(result.metadata?.cached).toBe(false);
    });

    it("should cache resolved documents", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDocument),
      });

      // First request - network
      const result1 = await resolver.resolve("did:anp:example.com:agent123");
      expect(result1.metadata?.source).toBe("network");

      // Second request - cache
      const result2 = await resolver.resolve("did:anp:example.com:agent123");
      expect(result2.metadata?.source).toBe("cache");
      expect(result2.metadata?.cached).toBe(true);

      // Should only call fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should handle network errors with retry", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDidDocument),
        });

      const result = await resolver.resolve("did:anp:example.com:agent123");

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should fail after max retries", async () => {
      const config: ResolverConfig = { maxRetries: 1, timeout: 100, cacheTtl: 1000 };
      resolver = new HTTPDIDResolver(config);

      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await resolver.resolve("did:anp:example.com:agent123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    it("should handle HTTP errors", async () => {
      // Create a new resolver with no retries for this test
      const noRetryResolver = new HTTPDIDResolver({
        cacheTtl: 1000,
        timeout: 1000,
        maxRetries: 0,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const result = await noRetryResolver.resolve("did:anp:example.com:agent123");

      expect(result.success).toBe(false);
      expect(result.error).toContain("404");
    });

    it("should construct correct URL for ANP DID", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDocument),
      });

      await resolver.resolve("did:anp:example.com:agent123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/.well-known/did/anp/agent123",
        expect.any(Object)
      );
    });

    it("should construct correct URL for web DID", async () => {
      const webDidDoc = { ...mockDidDocument, id: "did:web:example.com" };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(webDidDoc),
      });

      await resolver.resolve("did:web:example.com");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/.well-known/did.json",
        expect.any(Object)
      );
    });

    it("should reject did:key (cannot resolve remotely)", async () => {
      const result = await resolver.resolve("did:key:z6Mktest");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot resolve did:key remotely");
    });
  });

  describe("cache management", () => {
    it("should clear cache", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDocument),
      });

      await resolver.resolve("did:anp:example.com:agent123");
      resolver.clearCache();

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it("should get cache stats", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDidDocument),
      });

      await resolver.resolve("did:anp:example.com:agent123");

      const stats = resolver.getCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.oldestEntry).not.toBeNull();
    });
  });
});

describe("LocalResolver", () => {
  let resolver: LocalResolver;
  const localDocs = new Map<string, DidDocument>();

  beforeEach(() => {
    localDocs.clear();
    localDocs.set("did:anp:local:agent1", mockDidDocument);
    resolver = new LocalResolver(localDocs);
  });

  it("should resolve local DID", async () => {
    const result = await resolver.resolve("did:anp:local:agent1");

    expect(result.success).toBe(true);
    expect(result.document).toBeDefined();
    expect(result.metadata?.source).toBe("local");
  });

  it("should fail for unknown DID", async () => {
    const result = await resolver.resolve("did:anp:unknown:agent");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found in local store");
  });

  it("should add and remove documents", () => {
    const newDoc: DidDocument = {
      ...mockDidDocument,
      id: "did:anp:local:agent2",
    };

    resolver.addDocument("did:anp:local:agent2", newDoc);

    return resolver.resolve("did:anp:local:agent2").then((result) => {
      expect(result.success).toBe(true);
    });
  });
});

describe("CompositeResolver", () => {
  it("should try resolvers in order", async () => {
    const localDocs = new Map<string, DidDocument>();
    localDocs.set("did:anp:test:agent", mockDidDocument);

    const localResolver = new LocalResolver(localDocs);
    const httpResolver = new HTTPDIDResolver();

    const composite = new CompositeResolver([localResolver, httpResolver]);

    const result = await composite.resolve("did:anp:test:agent");

    expect(result.success).toBe(true);
    expect(result.metadata?.source).toBe("local");
  });

  it("should fail if all resolvers fail", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"));

    const httpResolver = new HTTPDIDResolver({ maxRetries: 0 });
    const composite = new CompositeResolver([httpResolver]);

    const result = await composite.resolve("did:anp:example.com:agent123");

    expect(result.success).toBe(false);
    expect(result.error).toContain("All resolvers failed");
  });
});
