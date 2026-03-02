/**
 * Discovery Scheduler
 *
 * 负责定期调度项目发现任务，从 Upwork RSS feed 发现新项目
 * 并通过评分系统过滤和排序项目
 *
 * @module upwork/discovery-scheduler
 * @version 1.0.0
 */

import { createLogger } from "../observability/logger.js";
import type { UpworkClient, UpworkJob } from "./client.js";
import type { FreelanceRepository } from "../freelance/repository.js";
import type { AnalyticsCollector } from "../freelance/analytics.js";

const logger = createLogger("discovery-scheduler");

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 发现调度器配置
 */
export interface DiscoverySchedulerConfig {
  /** RSS 检查间隔（毫秒） */
  checkIntervalMs: number;
  /** 每次检查获取的最大项目数 */
  maxJobsPerCheck: number;
  /** 最低项目评分阈值 */
  minScoreThreshold: number;
  /** 是否启用自动投标 */
  autoBidEnabled: boolean;
  /** 投标冷却期（毫秒） */
  bidCooldownMs: number;
}

/**
 * 发现统计
 */
export interface DiscoveryStats {
  /** 总检查次数 */
  totalChecks: number;
  /** 发现的项目总数 */
  totalDiscovered: number;
  /** 符合评分的项目数 */
  qualifiedCount: number;
  /** 投标的项目数 */
  bidCount: number;
  /** 最后检查时间 */
  lastCheckAt: string | null;
  /** 最后发现时间 */
  lastDiscoveryAt: string | null;
}

/**
 * 项目发现结果
 */
export interface DiscoveryResult {
  /** 发现的项目数 */
  discovered: number;
  /** 符合评分的项目数 */
  qualified: number;
  /** 投标的项目数 */
  bid: number;
  /** 跳过的项目数 */
  skipped: number;
  /** 处理耗时（毫秒） */
  durationMs: number;
}

// ============================================================================
// Discovery Scheduler
// ============================================================================

/**
 * 项目发现调度器
 *
 * 职责：
 * - 定期从 Upwork RSS feed 获取新项目
 * - 对项目进行评分
 * - 过滤低质量项目
 * - 触发投标流程
 * - 记录分析事件
 */
export class DiscoveryScheduler {
  private upworkClient: UpworkClient;
  private repository: FreelanceRepository;
  private analytics: AnalyticsCollector;
  private config: Required<DiscoverySchedulerConfig>;
  private stats: DiscoveryStats;
  private isRunning: boolean = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private lastBidTimes: Map<string, number> = new Map();

  constructor(
    upworkClient: UpworkClient,
    repository: FreelanceRepository,
    analytics: AnalyticsCollector,
    config: Partial<DiscoverySchedulerConfig> = {}
  ) {
    this.upworkClient = upworkClient;
    this.repository = repository;
    this.analytics = analytics;
    this.config = {
      checkIntervalMs: config.checkIntervalMs ?? 5 * 60 * 1000, // 5 分钟
      maxJobsPerCheck: config.maxJobsPerCheck ?? 20,
      minScoreThreshold: config.minScoreThreshold ?? 60,
      autoBidEnabled: config.autoBidEnabled ?? false,
      bidCooldownMs: config.bidCooldownMs ?? 60 * 60 * 1000, // 1 小时
    };
    this.stats = {
      totalChecks: 0,
      totalDiscovered: 0,
      qualifiedCount: 0,
      bidCount: 0,
      lastCheckAt: null,
      lastDiscoveryAt: null,
    };
  }

  // ==========================================================================
  // 公共方法
  // ==========================================================================

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      logger.warn("DiscoveryScheduler already running");
      return;
    }

    this.isRunning = true;
    logger.info(
      `DiscoveryScheduler started. Check interval: ${this.config.checkIntervalMs / 1000}s`
    );

    // 立即执行一次检查
    this.runDiscovery().catch((err) => {
      logger.error("Initial discovery failed", err instanceof Error ? err : undefined);
    });

    // 设置定期检查
    this.timerId = setInterval(() => {
      this.runDiscovery().catch((err) => {
        logger.error("Scheduled discovery failed", err instanceof Error ? err : undefined);
      });
    }, this.config.checkIntervalMs);
  }

  /**
   * 停止调度器
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    logger.info("DiscoveryScheduler stopped");
  }

  /**
   * 手动触发项目发现
   */
  async runDiscovery(): Promise<DiscoveryResult> {
    const startTime = Date.now();
    logger.info("Running project discovery...");

    try {
      // 更新统计
      this.stats.totalChecks++;
      this.stats.lastCheckAt = new Date().toISOString();

      // 从 Upwork 获取新项目
      const jobs = await this.fetchNewJobs();

      const result: DiscoveryResult = {
        discovered: jobs.length,
        qualified: 0,
        bid: 0,
        skipped: 0,
        durationMs: 0,
      };

      // 处理每个项目
      for (const job of jobs) {
        const processResult = await this.processJob(job);
        if (processResult.qualified) {
          result.qualified++;
        }
        if (processResult.bid) {
          result.bid++;
        }
        if (processResult.skipped) {
          result.skipped++;
        }
      }

      // 更新统计
      this.stats.totalDiscovered += result.discovered;
      if (result.qualified > 0) {
        this.stats.qualifiedCount += result.qualified;
        this.stats.lastDiscoveryAt = new Date().toISOString();
      }
      this.stats.bidCount += result.bid;

      result.durationMs = Date.now() - startTime;

      // 记录分析事件
      this.analytics.track({
        eventType: "project_viewed", // 使用现有事件类型
        timestamp: new Date().toISOString(),
        properties: {
          source: "discovery_scheduler",
          discovered: result.discovered,
          qualified: result.qualified,
          bid: result.bid,
          skipped: result.skipped,
          durationMs: result.durationMs,
        },
      });

      logger.info(
        `Discovery complete: ${result.discovered} discovered, ${result.qualified} qualified, ${result.bid} bid in ${result.durationMs}ms`
      );

      return result;
    } catch (error) {
      logger.error("Discovery failed", error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): DiscoveryStats {
    return { ...this.stats };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalChecks: 0,
      totalDiscovered: 0,
      qualifiedCount: 0,
      bidCount: 0,
      lastCheckAt: null,
      lastDiscoveryAt: null,
    };
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  /**
   * 从 Upwork 获取新项目
   */
  private async fetchNewJobs(): Promise<UpworkJob[]> {
    try {
      // 使用 UpworkClient 搜索项目
      // TODO: 实现 RSS feed 解析或 API 调用
      // 这里返回空数组作为占位符
      const jobs: UpworkJob[] = await this.upworkClient.searchJobs({
        query: "typescript javascript",
        limit: this.config.maxJobsPerCheck,
      });

      logger.debug(`Fetched ${jobs.length} jobs from Upwork`);
      return jobs;
    } catch (error) {
      logger.error("Failed to fetch jobs from Upwork", error instanceof Error ? error : undefined);
      return [];
    }
  }

  /**
   * 处理单个项目
   */
  private async processJob(job: UpworkJob): Promise<{
    qualified: boolean;
    bid: boolean;
    skipped: boolean;
  }> {
    try {
      // 检查项目是否已存在
      const existing = this.repository.getProjectByPlatformId("upwork", job.id);
      if (existing) {
        return { qualified: false, bid: false, skipped: true };
      }

      // 创建项目记录
      const client = this.repository.getOrCreateClient({
        platform: "upwork",
        platformClientId: job.client.id,
        name: job.client.name,
        // reputation: job.client.reputation, // TODO: add to type
        totalSpentCents: job.client.totalSpent,
      });

      const project = this.repository.createProject({
        platform: "upwork",
        platformProjectId: job.id,
        clientId: client.id,
        title: job.title,
        description: job.description,
        budgetCents: job.budget?.amount, // Use budgetCents instead of min/max
        // jobType: job.jobType, // TODO: add to type
        // status: "discovered", // Default status
        // publishedAt: job.publishedAt, // TODO: add to type
      });

      // 评分项目（这里使用简化的评分逻辑）
      // 实际评分应该由 Scorer 服务完成
      const score = this.calculateJobScore(job);

      if (score < this.config.minScoreThreshold) {
        logger.debug(`Job ${job.id} score ${score} below threshold ${this.config.minScoreThreshold}`);
        return { qualified: false, bid: false, skipped: false };
      }

      // 更新项目评分
      // TODO: Update ProjectScoreFactors type to include these fields
      this.repository.updateProjectScore(project.id, score, {
        // budgetMatch: 0.8,
        // clientReputation: job.client.reputation / 100,
        // jobClarity: 0.7,
        // competitionLevel: 0.5,
        // skillsMatch: 0.6,
      } as any);

      // 检查投标冷却期
      if (this.isInCooldown(job.client.id)) {
        logger.debug(`Client ${job.client.id} is in bid cooldown`);
        return { qualified: true, bid: false, skipped: false };
      }

      // 自动投标（如果启用）
      if (this.config.autoBidEnabled) {
        // TODO: 实现自动投标逻辑
        // 这里应该调用 BidGenerator 生成投标并提交
        logger.debug(`Would bid on job ${job.id} (auto-bid enabled)`);
        this.recordBidTime(job.client.id);
        return { qualified: true, bid: true, skipped: false };
      }

      return { qualified: true, bid: false, skipped: false };
    } catch (error) {
      logger.error(`Failed to process job ${job.id}`, error instanceof Error ? error : undefined);
      return { qualified: false, bid: false, skipped: false };
    }
  }

  /**
   * 计算项目评分（简化版）
   *
   * 实际实现应该使用 Scorer 服务
   */
  private calculateJobScore(job: UpworkJob): number {
    let score = 50; // 基础分

    // 客户声誉加分
    // TODO: Add reputation to ClientInfo type
    const reputation = (job.client as any).reputation ?? 50;
    score += Math.min(reputation / 10, 30);

    // 预算合理性
    // TODO: Add min/max to BudgetInfo type
    const budgetMin = (job.budget as any)?.min ?? 0;
    if (budgetMin > 100) {
      score += 10;
    }

    // 项目描述长度（更详细的项目通常质量更好）
    if (job.description && job.description.length > 200) {
      score += 5;
    }

    return Math.min(Math.max(score, 0), 100);
  }

  /**
   * 检查是否在冷却期内
   */
  private isInCooldown(clientId: string): boolean {
    const lastBidTime = this.lastBidTimes.get(clientId);
    if (!lastBidTime) {
      return false;
    }

    const elapsed = Date.now() - lastBidTime;
    return elapsed < this.config.bidCooldownMs;
  }

  /**
   * 记录投标时间
   */
  private recordBidTime(clientId: string): void {
    this.lastBidTimes.set(clientId, Date.now());
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建项目发现调度器
 */
export function createDiscoveryScheduler(
  upworkClient: UpworkClient,
  repository: FreelanceRepository,
  analytics: AnalyticsCollector,
  config?: Partial<DiscoverySchedulerConfig>
): DiscoveryScheduler {
  return new DiscoveryScheduler(upworkClient, repository, analytics, config);
}
