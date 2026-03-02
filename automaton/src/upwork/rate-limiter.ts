/**
 * Token Bucket Rate Limiter
 *
 * Implements the token bucket algorithm for rate limiting API requests.
 * Tokens are added at a constant rate up to a maximum capacity (bucket size).
 * Each request consumes one or more tokens; if insufficient tokens are available,
 * the request must wait or be rejected.
 *
 * References:
 * - docs/implementation-plan.md section 6, task 1C-02
 * - https://en.wikipedia.org/wiki/Token_bucket
 *
 * Usage:
 * ```typescript
 * const limiter = new TokenBucketRateLimiter(100, 100 / 60000); // 100 tokens, refills 100/min
 * const result = limiter.tryConsume(5); // Try to consume 5 tokens
 * if (result.allowed) {
 *   // Make request
 * } else {
 *   await sleep(result.waitMs); // Wait for tokens to refill
 * }
 * ```
 */

/**
 * Result of a token consumption attempt
 */
export interface ConsumeResult {
  /** Whether the consumption was allowed */
  allowed: boolean;
  /** Milliseconds to wait before retry if not allowed */
  waitMs: number;
  /** Current token count */
  currentTokens: number;
}

/**
 * Configuration for token bucket rate limiter
 */
export interface TokenBucketConfig {
  /** Maximum number of tokens the bucket can hold */
  bucketSize: number;
  /** Tokens per millisecond refill rate */
  refillRate: number;
  /** Initial token count (defaults to bucketSize) */
  initialTokens?: number;
}

/**
 * Token Bucket Rate Limiter Implementation
 *
 * Thread-safe implementation using monotonic timestamps.
 * Not safe for concurrent use across multiple processes.
 */
export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  private readonly bucketSize: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(config: TokenBucketConfig) {
    this.bucketSize = config.bucketSize;
    this.refillRate = config.refillRate;
    this.tokens = config.initialTokens ?? config.bucketSize;
    this.lastRefillMs = this.getMonotonicTime();
  }

  /**
   * Attempt to consume the specified number of tokens
   *
   * @param tokens - Number of tokens to consume (default: 1)
   * @returns ConsumeResult indicating if allowed and wait time if not
   */
  tryConsume(tokens: number = 1): ConsumeResult {
    const consumeAmount = Math.max(0, tokens);

    // Refill tokens based on elapsed time
    this.refill();

    // Check if we have enough tokens
    if (this.tokens >= consumeAmount) {
      this.tokens -= consumeAmount;
      return {
        allowed: true,
        waitMs: 0,
        currentTokens: this.tokens,
      };
    }

    // Not enough tokens - calculate wait time
    const deficit = consumeAmount - this.tokens;
    const waitMs = Math.ceil(deficit / this.refillRate);

    return {
      allowed: false,
      waitMs,
      currentTokens: this.tokens,
    };
  }

  /**
   * Wait for the specified number of tokens to be available
   *
   * This is a convenience method that blocks until tokens are available.
   * Use with caution in async contexts - prefer tryConsume with async/await.
   *
   * @param tokens - Number of tokens to wait for
   * @returns Promise that resolves when tokens are available
   */
  async waitForTokens(tokens: number = 1): Promise<void> {
    const result = this.tryConsume(tokens);
    if (result.allowed) {
      return;
    }

    // Wait and retry
    await this.sleep(result.waitMs);
    return this.waitForTokens(tokens);
  }

  /**
   * Get the current token count without consuming
   *
   * @returns Current number of tokens in the bucket
   */
  getTokenCount(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Get the estimated time when the next token will be available
   *
   * @returns Milliseconds until next token, or 0 if tokens available now
   */
  getNextTokenTime(): number {
    this.refill();
    if (this.tokens >= 1) {
      return 0;
    }
    const deficit = 1 - this.tokens;
    return Math.ceil(deficit / this.refillRate);
  }

  /**
   * Reset the bucket to full capacity
   *
   * Useful for testing or recovery scenarios.
   */
  reset(): void {
    this.tokens = this.bucketSize;
    this.lastRefillMs = this.getMonotonicTime();
  }

  /**
   * Refill tokens based on elapsed time since last refill
   *
   * Uses monotonic time to be robust against system clock changes.
   */
  private refill(): void {
    const nowMs = this.getMonotonicTime();
    const elapsedMs = nowMs - this.lastRefillMs;

    if (elapsedMs > 0) {
      const tokensToAdd = elapsedMs * this.refillRate;
      this.tokens = Math.min(this.bucketSize, this.tokens + tokensToAdd);
      this.lastRefillMs = nowMs;
    }
  }

  /**
   * Get monotonic time in milliseconds
   *
   * Monotonic time is guaranteed to always move forward and is not
   * affected by system clock changes.
   */
  private getMonotonicTime(): number {
    // Use performance.now() for monotonic time in browser-like environments
    // or Date.now() as fallback in Node.js
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    return Date.now();
  }

  /**
   * Async sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// PRE-CONFIGURED RATE LIMITERS
// ============================================================================

/**
 * Upwork API rate limits based on official documentation
 *
 * Reference: https://developers.upwork.com/#rate-limits
 *
 * Limits:
 * - Search/Discovery: 40 requests per minute
 * - Bids/Proposals: 20 requests per hour
 * - Messages: 100 requests per hour
 * - GraphQL: 360 requests per minute (authenticated)
 */

/**
 * Search and discovery rate limiter
 *
 * Limit: 40 requests per minute
 * Usage: Job search, profile lookup, etc.
 */
export const searchLimiter = new TokenBucketRateLimiter({
  bucketSize: 40,
  refillRate: 40 / 60000, // 40 tokens per minute (60,000ms)
});

/**
 * Bid/proposal submission rate limiter
 *
 * Limit: 20 requests per hour
 * Usage: Submitting proposals, withdrawing bids
 */
export const bidLimiter = new TokenBucketRateLimiter({
  bucketSize: 20,
  refillRate: 20 / 3600000, // 20 tokens per hour (3,600,000ms)
});

/**
 * Messaging rate limiter
 *
 * Limit: 100 requests per hour
 * Usage: Sending messages to clients
 */
export const messageLimiter = new TokenBucketRateLimiter({
  bucketSize: 100,
  refillRate: 100 / 3600000, // 100 tokens per hour (3,600,000ms)
});

/**
 * GraphQL rate limiter (authenticated)
 *
 * Limit: 360 requests per minute
 * Usage: GraphQL queries and mutations
 */
export const graphqlLimiter = new TokenBucketRateLimiter({
  bucketSize: 360,
  refillRate: 360 / 60000, // 360 tokens per minute
});

/**
 * Generic conservative rate limiter
 *
 * Limit: 10 requests per second
 * Usage: General API calls when specific limiter is unknown
 */
export const conservativeLimiter = new TokenBucketRateLimiter({
  bucketSize: 10,
  refillRate: 10 / 1000, // 10 tokens per second
});

// ============================================================================
// RATE LIMITER MAP
// ============================================================================

/**
 * Map of operation types to their corresponding rate limiters
 *
 * Use this to get the appropriate limiter for a given operation.
 */
export const RATE_LIMITERS: Record<string, TokenBucketRateLimiter> = {
  search: searchLimiter,
  discovery: searchLimiter,
  bid: bidLimiter,
  proposal: bidLimiter,
  message: messageLimiter,
  graphql: graphqlLimiter,
  generic: conservativeLimiter,
} as const;

/**
 * Get the appropriate rate limiter for a given operation type
 *
 * @param operation - The operation type
 * @returns The corresponding rate limiter, or conservative limiter if not found
 */
export function getRateLimiter(operation: string): TokenBucketRateLimiter {
  return RATE_LIMITERS[operation] ?? conservativeLimiter;
}

// ============================================================================
// EXPORTS
// ============================================================================

export default TokenBucketRateLimiter;
