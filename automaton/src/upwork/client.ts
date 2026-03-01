/**
 * Upwork API Client
 *
 * Client for Upwork API integration with rate limiting, error handling,
 * and token refresh support.
 *
 * Rate limits:
 * - Search API: 40 requests/minute
 * - Bid API: 20 requests/hour
 * - Message API: 100 requests/hour
 */

import { ResilientHttpClient } from "../conway/http-client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("upwork");

// ─── Types ─────────────────────────────────────────────────────────────

export interface UpworkConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: string;
}

export interface SearchParams {
  query?: string;
  budget?: { min: number; max: number };
  skills?: string[];
  category?: string;
  limit?: number;
  offset?: number;
}

export interface BudgetInfo {
  amount: number;
  type: "fixed" | "hourly";
  currency?: string;
}

export interface ClientInfo {
  id: string;
  name?: string;
  rating?: number;
  paymentVerified: boolean;
  country?: string;
  totalSpent?: number;
}

export interface UpworkJob {
  id: string;
  title: string;
  description: string;
  budget?: BudgetInfo;
  skills: string[];
  category: string;
  client: ClientInfo;
  postedAt: string;
  proposalsCount: number;
  url?: string;
}

export interface BidProposal {
  projectId: string;
  coverLetter: string;
  bidAmount: number;
  durationDays?: number;
  milestoneDescription?: string;
}

export interface BidResult {
  success: boolean;
  projectId: string;
  bidId?: string;
  errorMessage?: string;
  submittedAt: string;
}

export interface Contract {
  id: string;
  jobId: string;
  jobTitle: string;
  clientId: string;
  clientName?: string;
  status: "active" | "completed" | "cancelled";
  startDate: string;
  endDate?: string;
  totalEarnings?: number;
}

export interface UpworkMessage {
  id: string;
  contractId: string;
  senderId: string;
  content: string;
  sentAt: string;
}

// ─── Rate Limiter ──────────────────────────────────────────────────────

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

class RateLimiter {
  private timestamps: number[] = [];
  private readonly config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Remove timestamps outside the window
    this.timestamps = this.timestamps.filter((ts) => ts > windowStart);

    if (this.timestamps.length >= this.config.maxRequests) {
      // Calculate wait time until oldest timestamp exits the window
      const oldestInWindow = this.timestamps[0];
      if (oldestInWindow) {
        const waitTime = oldestInWindow + this.config.windowMs - now;
        if (waitTime > 0) {
          logger.debug(`Rate limit reached, waiting ${waitTime}ms`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          // Recursively check again after waiting
          return this.waitForSlot();
        }
      }
    }

    this.timestamps.push(now);
  }

  getStatus(): { remaining: number; resetAt: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    this.timestamps = this.timestamps.filter((ts) => ts > windowStart);
    const remaining = Math.max(0, this.config.maxRequests - this.timestamps.length);
    const resetAt = this.timestamps.length > 0 ? this.timestamps[0]! + this.config.windowMs : now;
    return { remaining, resetAt };
  }
}

// ─── Token Manager ─────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

// Pattern to detect sensitive tokens in logs
const TOKEN_PATTERN = /Bearer\s+[\w.-]+|access_token["\s:]+[\w.-]+/gi;

function redactSensitive(text: string): string {
  return text.replace(TOKEN_PATTERN, "[REDACTED]");
}

// ─── Upwork Client ─────────────────────────────────────────────────────

const UPWORK_BASE_URL = "https://www.upwork.com/api";
const UPWORK_AUTH_URL = "https://www.upwork.com/api/v3/oauth2/token";

// Rate limit configurations per API type
const RATE_LIMITS = {
  search: { maxRequests: 40, windowMs: 60_000 },      // 40/minute
  bid: { maxRequests: 20, windowMs: 3_600_000 },      // 20/hour
  message: { maxRequests: 100, windowMs: 3_600_000 }, // 100/hour
} as const;

export class UpworkClient {
  private readonly config: UpworkConfig;
  private readonly httpClient: ResilientHttpClient;
  private tokenExpiresAt: Date | null = null;

  // Rate limiters for different API types
  private readonly searchRateLimiter: RateLimiter;
  private readonly bidRateLimiter: RateLimiter;
  private readonly messageRateLimiter: RateLimiter;

  constructor(config: UpworkConfig) {
    this.config = config;
    this.httpClient = new ResilientHttpClient();

    // Initialize rate limiters
    this.searchRateLimiter = new RateLimiter(RATE_LIMITS.search);
    this.bidRateLimiter = new RateLimiter(RATE_LIMITS.bid);
    this.messageRateLimiter = new RateLimiter(RATE_LIMITS.message);

    // Parse token expiration if available
    if (config.tokenExpiresAt) {
      try {
        this.tokenExpiresAt = new Date(config.tokenExpiresAt);
      } catch {
        logger.warn("Invalid tokenExpiresAt format");
      }
    }
  }

  // ─── Authentication ──────────────────────────────────────────────────

  /**
   * Ensure we have a valid access token.
   * Returns true if authenticated, false otherwise.
   */
  async ensureAuthenticated(): Promise<boolean> {
    if (!this.config.accessToken) {
      logger.warn("No Upwork access token configured");
      return false;
    }

    // Check if token needs refresh (5 minute buffer)
    if (this.tokenExpiresAt && this.tokenExpiresAt < new Date(Date.now() + 5 * 60_000)) {
      return this.refreshToken();
    }

    return true;
  }

  /**
   * Refresh the access token using the refresh token.
   */
  private async refreshToken(): Promise<boolean> {
    if (!this.config.refreshToken || !this.config.clientId) {
      logger.warn("Cannot refresh token: missing credentials");
      return false;
    }

    try {
      const response = await this.httpClient.request(UPWORK_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.config.refreshToken,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
        }).toString(),
        timeout: 30_000,
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error(`Token refresh failed: ${redactSensitive(text)}`);
        return false;
      }

      const data = (await response.json()) as TokenResponse;

      // Validate response
      if (!this.validateTokenResponse(data)) {
        logger.error("Token refresh response validation failed");
        return false;
      }

      // Update tokens
      this.config.accessToken = data.access_token;
      if (data.refresh_token) {
        this.config.refreshToken = data.refresh_token;
      }

      // Update expiration
      this.tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000);

      logger.info("Successfully refreshed Upwork access token");
      return true;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Token refresh error: ${redactSensitive(err.message)}`, err);
      return false;
    }
  }

  private validateTokenResponse(data: TokenResponse): boolean {
    if (!data.access_token) {
      logger.error("Token response missing access_token");
      return false;
    }

    if (!data.expires_in || data.expires_in < 60 || data.expires_in > 86400) {
      logger.warn(`Token expires_in value unusual: ${data.expires_in}`);
    }

    return true;
  }

  // ─── HTTP Helpers ─────────────────────────────────────────────────────

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private async handleAuthError<T>(
    response: Response,
    retryFn: () => Promise<T>,
  ): Promise<T> {
    if (response.status === 401) {
      if (await this.refreshToken()) {
        return retryFn();
      }
      throw new Error("Authentication expired");
    }
    throw new Error(`Request failed: ${response.status}`);
  }

  private parseErrorResponse(response: Response, text: string): string {
    try {
      const data = JSON.parse(text) as { error?: string; message?: string };
      if (data.error) return redactSensitive(data.error);
      if (data.message) return redactSensitive(data.message);
      return redactSensitive(text.slice(0, 200));
    } catch {
      return redactSensitive(text.slice(0, 200));
    }
  }

  // ─── Search API ───────────────────────────────────────────────────────

  /**
   * Search for jobs on Upwork.
   * Rate limit: 40 requests/minute
   */
  async searchJobs(params: SearchParams): Promise<UpworkJob[]> {
    if (!(await this.ensureAuthenticated())) {
      throw new Error("Authentication failed");
    }

    await this.searchRateLimiter.waitForSlot();

    const searchParams = new URLSearchParams();
    if (params.query) searchParams.set("q", params.query);
    if (params.budget) {
      if (params.budget.min) searchParams.set("budget_min", String(params.budget.min));
      if (params.budget.max) searchParams.set("budget_max", String(params.budget.max));
    }
    if (params.skills && params.skills.length > 0) {
      searchParams.set("skills", params.skills.join(","));
    }
    if (params.category) searchParams.set("category", params.category);
    if (params.limit) searchParams.set("limit", String(params.limit));
    if (params.offset) searchParams.set("offset", String(params.offset));

    const url = `${UPWORK_BASE_URL}/jobs/v3/jobs?${searchParams.toString()}`;

    try {
      const response = await this.httpClient.request(url, {
        method: "GET",
        headers: this.getHeaders(),
        timeout: 30_000,
      });

      if (response.status === 401) {
        return this.handleAuthError(response, () => this.searchJobs(params));
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded for search API");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Search failed: ${this.parseErrorResponse(response, text)}`);
      }

      const data = (await response.json()) as { jobs?: Array<Record<string, unknown>> };
      return this.parseJobs(data.jobs ?? []);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Search jobs error", err);
      throw error;
    }
  }

  private parseJobs(rawJobs: Array<Record<string, unknown>>): UpworkJob[] {
    return rawJobs.map((job) => ({
      id: String(job.id ?? job.job_id ?? ""),
      title: String(job.title ?? ""),
      description: String(job.description ?? job.snippet ?? ""),
      budget: this.parseBudget(job.budget as Record<string, unknown> | undefined),
      skills: Array.isArray(job.skills) ? job.skills.map(String) : [],
      category: String(job.category ?? job.subcategory ?? ""),
      client: this.parseClient(job.client as Record<string, unknown> | undefined),
      postedAt: String(job.date_created ?? job.posted_at ?? new Date().toISOString()),
      proposalsCount: Number(job.proposals ?? job.proposals_count ?? 0),
      url: job.url ? String(job.url) : undefined,
    }));
  }

  private parseBudget(budget: Record<string, unknown> | undefined): BudgetInfo | undefined {
    if (!budget) return undefined;
    return {
      amount: Number(budget.amount ?? budget.maximum_budget ?? 0),
      type: String(budget.type ?? "fixed") as "fixed" | "hourly",
      currency: budget.currency ? String(budget.currency) : "USD",
    };
  }

  private parseClient(client: Record<string, unknown> | undefined): ClientInfo {
    if (!client) {
      return { id: "", paymentVerified: false };
    }
    return {
      id: String(client.id ?? client.client_id ?? ""),
      name: client.name ? String(client.name) : undefined,
      rating: client.rating ? Number(client.rating) : undefined,
      paymentVerified: Boolean(client.payment_verification_status ?? client.verified ?? false),
      country: client.country ? String(client.country) : undefined,
      totalSpent: client.total_spent ? Number(client.total_spent) : undefined,
    };
  }

  // ─── Job Details API ──────────────────────────────────────────────────

  /**
   * Get details of a specific job.
   */
  async getJob(jobId: string): Promise<UpworkJob> {
    if (!(await this.ensureAuthenticated())) {
      throw new Error("Authentication failed");
    }

    const url = `${UPWORK_BASE_URL}/jobs/v3/jobs/${jobId}`;

    try {
      const response = await this.httpClient.request(url, {
        method: "GET",
        headers: this.getHeaders(),
        timeout: 30_000,
      });

      if (response.status === 401) {
        return this.handleAuthError(response, () => this.getJob(jobId));
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Get job failed: ${this.parseErrorResponse(response, text)}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      return this.parseJobs([data])[0]!;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Get job error", err);
      throw error;
    }
  }

  // ─── Bid API ──────────────────────────────────────────────────────────

  /**
   * Submit a bid proposal to Upwork.
   * Rate limit: 20 requests/hour
   */
  async submitProposal(proposal: BidProposal): Promise<BidResult> {
    if (!(await this.ensureAuthenticated())) {
      return {
        success: false,
        projectId: proposal.projectId,
        errorMessage: "Authentication failed",
        submittedAt: new Date().toISOString(),
      };
    }

    await this.bidRateLimiter.waitForSlot();

    const url = `${UPWORK_BASE_URL}/applications/v1/proposals`;
    const payload: Record<string, unknown> = {
      job_id: proposal.projectId,
      cover_letter: proposal.coverLetter,
      bid_amount: proposal.bidAmount,
    };

    if (proposal.durationDays) {
      payload.duration_days = proposal.durationDays;
    }
    if (proposal.milestoneDescription) {
      payload.milestone_description = proposal.milestoneDescription;
    }

    try {
      const response = await this.httpClient.request(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify(payload),
        timeout: 30_000,
      });

      if (response.status === 401) {
        if (await this.refreshToken()) {
          return this.submitProposal(proposal);
        }
        return {
          success: false,
          projectId: proposal.projectId,
          errorMessage: "Authentication expired",
          submittedAt: new Date().toISOString(),
        };
      }

      if (response.status === 429) {
        return {
          success: false,
          projectId: proposal.projectId,
          errorMessage: "Rate limit exceeded for bid API",
          submittedAt: new Date().toISOString(),
        };
      }

      if (!response.ok) {
        const text = await response.text();
        const errorMsg = this.parseErrorResponse(response, text);
        logger.error(`Bid submission failed: ${response.status} - ${errorMsg}`);
        return {
          success: false,
          projectId: proposal.projectId,
          errorMessage: errorMsg,
          submittedAt: new Date().toISOString(),
        };
      }

      const data = (await response.json()) as { proposal_id?: string; id?: string };
      logger.info(`Bid submitted successfully for project ${proposal.projectId}`);

      return {
        success: true,
        projectId: proposal.projectId,
        bidId: data.proposal_id ?? data.id,
        submittedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Bid submission error: ${redactSensitive(errorMsg)}`);
      return {
        success: false,
        projectId: proposal.projectId,
        errorMessage: errorMsg,
        submittedAt: new Date().toISOString(),
      };
    }
  }

  // ─── Contracts API ────────────────────────────────────────────────────

  /**
   * Get list of active contracts.
   */
  async getContracts(status: "active" | "completed" | "cancelled" = "active"): Promise<Contract[]> {
    if (!(await this.ensureAuthenticated())) {
      throw new Error("Authentication failed");
    }

    const url = `${UPWORK_BASE_URL}/hr/v3/contracts?status=${status}`;

    try {
      const response = await this.httpClient.request(url, {
        method: "GET",
        headers: this.getHeaders(),
        timeout: 30_000,
      });

      if (response.status === 401) {
        return this.handleAuthError(response, () => this.getContracts(status));
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Get contracts failed: ${this.parseErrorResponse(response, text)}`);
      }

      const data = (await response.json()) as { contracts?: Array<Record<string, unknown>> };
      return this.parseContracts(data.contracts ?? []);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("Get contracts error", err);
      throw error;
    }
  }

  private parseContracts(rawContracts: Array<Record<string, unknown>>): Contract[] {
    return rawContracts.map((contract) => {
      const job = contract.job as Record<string, unknown> | undefined;
      const client = contract.client as Record<string, unknown> | undefined;

      return {
        id: String(contract.id ?? contract.contract_id ?? ""),
        jobId: String(contract.job_id ?? job?.id ?? ""),
        jobTitle: String(contract.job_title ?? job?.title ?? ""),
        clientId: String(contract.client_id ?? client?.id ?? ""),
        clientName: contract.client_name
          ? String(contract.client_name)
          : client?.name
            ? String(client.name)
            : undefined,
        status: String(contract.status ?? "active") as Contract["status"],
        startDate: String(contract.start_date ?? contract.created_at ?? new Date().toISOString()),
        endDate: contract.end_date ? String(contract.end_date) : undefined,
        totalEarnings: contract.total_earnings ? Number(contract.total_earnings) : undefined,
      };
    });
  }

  // ─── Messaging API ────────────────────────────────────────────────────

  /**
   * Send a message to a client via contract.
   * Rate limit: 100 requests/hour
   */
  async sendMessage(contractId: string, message: string): Promise<void> {
    if (!(await this.ensureAuthenticated())) {
      throw new Error("Authentication failed");
    }

    await this.messageRateLimiter.waitForSlot();

    const url = `${UPWORK_BASE_URL}/messages/v3/rooms`;

    try {
      const response = await this.httpClient.request(url, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          contract_id: contractId,
          body: message,
        }),
        timeout: 30_000,
      });

      if (response.status === 401) {
        return this.handleAuthError(response, () => this.sendMessage(contractId, message));
      }

      if (response.status === 429) {
        throw new Error("Rate limit exceeded for message API");
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Send message failed: ${this.parseErrorResponse(response, text)}`);
      }

      logger.info(`Message sent successfully for contract ${contractId}`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error(`Send message error: ${redactSensitive(err.message)}`, err);
      throw error;
    }
  }

  // ─── Rate Limit Status ────────────────────────────────────────────────

  /**
   * Get rate limit status for all API types.
   */
  getRateLimitStatus(): {
    search: { remaining: number; resetAt: number };
    bid: { remaining: number; resetAt: number };
    message: { remaining: number; resetAt: number };
  } {
    return {
      search: this.searchRateLimiter.getStatus(),
      bid: this.bidRateLimiter.getStatus(),
      message: this.messageRateLimiter.getStatus(),
    };
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────

  /**
   * Update the access token (useful after external refresh).
   */
  updateAccessToken(accessToken: string, refreshToken?: string, expiresAt?: Date): void {
    this.config.accessToken = accessToken;
    if (refreshToken) {
      this.config.refreshToken = refreshToken;
    }
    if (expiresAt) {
      this.tokenExpiresAt = expiresAt;
    }
  }

  /**
   * Get current configuration (without sensitive data).
   */
  getConfig(): { clientId: string; hasAccessToken: boolean; hasRefreshToken: boolean } {
    return {
      clientId: this.config.clientId,
      hasAccessToken: Boolean(this.config.accessToken),
      hasRefreshToken: Boolean(this.config.refreshToken),
    };
  }
}
