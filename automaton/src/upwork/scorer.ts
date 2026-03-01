/**
 * ProjectScorer - 评分引擎
 *
 * 实现多因子加权评分模型，用于项目筛选决策
 * 基于 requirements-analysis-v2.md 3.1.1.1 节 ICP 定义
 */

// ─── Types ───────────────────────────────────────────────────────────

/**
 * 评分因子
 */
export interface ScoringFactors {
  technicalMatch: number;      // 技术匹配度 (25%)
  budgetReasonable: number;    // 预算合理性 (20%)
  deliveryFeasible: number;    // 交付可行性 (20%)
  clientQuality: number;       // 客户质量 (20%)
  strategicValue: number;      // 战略价值 (15%)
}

/**
 * 项目评分结果
 */
export interface ProjectScore {
  total: number;               // 总分 (0-100)
  factors: ScoringFactors;
  recommendation: 'auto_bid' | 'manual_review' | 'reject';
  reasons: string[];
}

/**
 * ICP 评分因子
 */
export interface ICPFactors {
  companySize: number;         // 企业规模 (20%)
  technicalMaturity: number;   // 技术成熟度 (15%)
  budgetRange: number;         // 预算范围 (20%)
  paymentHistory: number;      // 付款记录 (20%)
  responseTime: number;        // 沟通响应 (15%)
  longTermPotential: number;   // 长期潜力 (10%)
}

/**
 * Upwork 项目信息
 */
export interface UpworkJob {
  id: string;
  title: string;
  description: string;
  requiredSkills: string[];
  budget: BudgetInfo;
  deadline?: string;
  complexity?: 'low' | 'medium' | 'high';
  client: ClientInfo;
  postedAt: string;
}

/**
 * 预算信息
 */
export interface BudgetInfo {
  type: 'fixed' | 'hourly';
  minAmount?: number;
  maxAmount?: number;
  hourlyRateMin?: number;
  hourlyRateMax?: number;
  currency: string;
}

/**
 * 客户信息
 */
export interface ClientInfo {
  id: string;
  name: string;
  companySize?: number;          // 员工数量
  totalSpent?: number;           // 历史总支出
  paymentVerificationRate?: number; // 付款验证率 (0-1)
  averageRating?: number;        // 平均评分 (0-5)
  totalJobsPosted?: number;      // 发布项目总数
  hireRate?: number;             // 雇佣率 (0-1)
  averageResponseTime?: number;  // 平均响应时间 (小时)
  country?: string;
  verified: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────

/**
 * 核心技术栈 (优先匹配)
 */
const CORE_SKILLS = new Set([
  'react',
  'next.js',
  'nextjs',
  'typescript',
  'javascript',
  'node.js',
  'nodejs',
  'html',
  'css',
  'tailwind',
  'rest api',
  'graphql',
  'postgresql',
  'mongodb',
  'sqlite',
  'web development',
  'frontend',
  'full stack',
  'fullstack',
]);

/**
 * 次要技术栈 (部分匹配)
 */
const SECONDARY_SKILLS = new Set([
  'vue',
  'angular',
  'python',
  'django',
  'fastapi',
  'aws',
  'docker',
  'kubernetes',
  'redis',
  'express',
  'redux',
  'webpack',
  'vite',
]);

/**
 * 排除技术栈 (不擅长)
 */
const EXCLUDED_SKILLS = new Set([
  'unity',
  'unreal engine',
  'game development',
  'blockchain',
  'smart contract',
  'solidity',
  'rust',
  'go',
  'golang',
  'mobile',
  'ios',
  'android',
  'flutter',
  'react native',
  'kotlin',
  'swift',
  'machine learning',
  'deep learning',
  'data science',
]);

/**
 * 评分权重
 */
const SCORING_WEIGHTS = {
  technicalMatch: 0.25,
  budgetReasonable: 0.20,
  deliveryFeasible: 0.20,
  clientQuality: 0.20,
  strategicValue: 0.15,
} as const;

/**
 * ICP 权重
 */
const ICP_WEIGHTS = {
  companySize: 0.20,
  technicalMaturity: 0.15,
  budgetRange: 0.20,
  paymentHistory: 0.20,
  responseTime: 0.15,
  longTermPotential: 0.10,
} as const;

/**
 * 评分阈值
 */
const SCORE_THRESHOLDS = {
  autoBid: 80,
  manualReview: 60,
  icpFilter: 60,
  icpFastTrack: 80,
} as const;

// ─── ProjectScorer Class ─────────────────────────────────────────────

/**
 * 项目评分引擎
 */
export class ProjectScorer {
  /**
   * 对项目进行综合评分
   */
  scoreProject(job: UpworkJob): ProjectScore {
    const reasons: string[] = [];

    // 计算各因子分数
    const technicalMatch = this.calculateTechMatch(job.requiredSkills);
    if (technicalMatch < 50) {
      reasons.push(`技术匹配度较低 (${technicalMatch.toFixed(0)}分)`);
    } else if (technicalMatch >= 90) {
      reasons.push(`技术栈高度匹配 (${technicalMatch.toFixed(0)}分)`);
    }

    const budgetReasonable = this.calculateBudgetScore(job.budget);
    if (budgetReasonable < 50) {
      reasons.push(`预算偏低 (${budgetReasonable.toFixed(0)}分)`);
    } else if (budgetReasonable >= 80) {
      reasons.push(`预算合理 (${budgetReasonable.toFixed(0)}分)`);
    }

    const deliveryFeasible = this.calculateDeliveryFeasibility(
      job.deadline,
      job.complexity || 'medium'
    );
    if (deliveryFeasible < 50) {
      reasons.push(`交付时间紧张 (${deliveryFeasible.toFixed(0)}分)`);
    }

    const clientQuality = this.calculateClientQuality(job.client);
    if (clientQuality < 50) {
      reasons.push(`客户质量较差 (${clientQuality.toFixed(0)}分)`);
    } else if (clientQuality >= 80) {
      reasons.push(`优质客户 (${clientQuality.toFixed(0)}分)`);
    }

    const strategicValue = this.calculateStrategicValue(job);
    if (strategicValue >= 70) {
      reasons.push(`具有战略价值 (${strategicValue.toFixed(0)}分)`);
    }

    const factors: ScoringFactors = {
      technicalMatch,
      budgetReasonable,
      deliveryFeasible,
      clientQuality,
      strategicValue,
    };

    // 计算加权总分
    const total = Math.round(
      technicalMatch * SCORING_WEIGHTS.technicalMatch +
      budgetReasonable * SCORING_WEIGHTS.budgetReasonable +
      deliveryFeasible * SCORING_WEIGHTS.deliveryFeasible +
      clientQuality * SCORING_WEIGHTS.clientQuality +
      strategicValue * SCORING_WEIGHTS.strategicValue
    );

    // 确定推荐
    let recommendation: ProjectScore['recommendation'];
    if (total >= SCORE_THRESHOLDS.autoBid) {
      recommendation = 'auto_bid';
      reasons.unshift('高分项目，建议自动投标');
    } else if (total >= SCORE_THRESHOLDS.manualReview) {
      recommendation = 'manual_review';
      reasons.unshift('中分项目，需人工复核');
    } else {
      recommendation = 'reject';
      reasons.unshift('低分项目，建议过滤');
    }

    // ICP 过滤检查
    const icpScore = this.calculateICP(job.client);
    if (icpScore < SCORE_THRESHOLDS.icpFilter) {
      recommendation = 'reject';
      reasons.unshift(`ICP评分过低 (${icpScore.toFixed(0)}分)，自动过滤`);
    }

    return {
      total,
      factors,
      recommendation,
      reasons,
    };
  }

  /**
   * 计算 ICP (理想客户画像) 评分
   */
  calculateICP(client: ClientInfo): number {
    const factors: ICPFactors = {
      companySize: this.scoreCompanySize(client.companySize),
      technicalMaturity: this.scoreTechnicalMaturity(client),
      budgetRange: this.scoreClientBudgetRange(client),
      paymentHistory: this.scorePaymentHistory(client.paymentVerificationRate),
      responseTime: this.scoreResponseTime(client.averageResponseTime),
      longTermPotential: this.scoreLongTermPotential(client),
    };

    return Math.round(
      factors.companySize * ICP_WEIGHTS.companySize +
      factors.technicalMaturity * ICP_WEIGHTS.technicalMaturity +
      factors.budgetRange * ICP_WEIGHTS.budgetRange +
      factors.paymentHistory * ICP_WEIGHTS.paymentHistory +
      factors.responseTime * ICP_WEIGHTS.responseTime +
      factors.longTermPotential * ICP_WEIGHTS.longTermPotential
    );
  }

  /**
   * 计算技术匹配度
   */
  calculateTechMatch(requiredSkills: string[]): number {
    if (!requiredSkills || requiredSkills.length === 0) {
      return 50; // 无技能要求，给中等分数
    }

    const normalizedSkills = requiredSkills.map(s =>
      s.toLowerCase().trim()
    );

    // Convert Sets to arrays for iteration
    const excludedSkillsArray = Array.from(EXCLUDED_SKILLS);
    const coreSkillsArray = Array.from(CORE_SKILLS);
    const secondarySkillsArray = Array.from(SECONDARY_SKILLS);

    let coreMatches = 0;
    let secondaryMatches = 0;
    let exclusions = 0;

    for (const skill of normalizedSkills) {
      let matched = false;

      // 检查排除技能 (只检查 skill 是否包含排除词，不检查反向)
      for (const excluded of excludedSkillsArray) {
        if (skill.includes(excluded)) {
          exclusions++;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // 检查核心技能 (双向匹配：skill 包含核心技能词，或核心技能词包含 skill)
      for (const core of coreSkillsArray) {
        if (skill.includes(core) || core.includes(skill)) {
          coreMatches++;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // 检查次要技能 (双向匹配)
      for (const secondary of secondarySkillsArray) {
        if (skill.includes(secondary) || secondary.includes(skill)) {
          secondaryMatches++;
          break;
        }
      }
    }

    // 排除技能严重扣分
    if (exclusions > 0) {
      return Math.max(0, 30 - exclusions * 15);
    }

    const totalSkills = normalizedSkills.length;
    const coreRatio = coreMatches / totalSkills;
    const secondaryRatio = secondaryMatches / totalSkills;

    // 计算分数：核心技能满分90，次要技能满分30
    const score = coreRatio * 90 + secondaryRatio * 30;
    return Math.min(100, Math.max(0, Math.round(score)));
  }

  /**
   * 计算预算评分
   */
  calculateBudgetScore(budget: BudgetInfo): number {
    if (budget.type === 'hourly') {
      return this.scoreHourlyBudget(budget);
    }
    return this.scoreFixedBudget(budget);
  }

  /**
   * 计算交付可行性
   */
  calculateDeliveryFeasibility(
    deadline: string | undefined,
    complexity: 'low' | 'medium' | 'high'
  ): number {
    // 无截止日期，默认可行
    if (!deadline) {
      return 80;
    }

    const deadlineDate = new Date(deadline);
    const now = new Date();
    const daysUntilDeadline = Math.ceil(
      (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    // 已过期
    if (daysUntilDeadline < 0) {
      return 0;
    }

    // 根据复杂度和时间评估
    const complexityMultiplier = {
      low: 1,
      medium: 2,
      high: 3,
    };

    const requiredDays = 7 * complexityMultiplier[complexity];
    const ratio = daysUntilDeadline / requiredDays;

    if (ratio >= 2) {
      return 100; // 时间充裕
    } else if (ratio >= 1.5) {
      return 85;
    } else if (ratio >= 1) {
      return 70;
    } else if (ratio >= 0.5) {
      return 50;
    } else {
      return 30; // 时间紧张
    }
  }

  /**
   * 计算客户质量评分
   */
  calculateClientQuality(client: ClientInfo): number {
    // 基础分数从 ICP 评分获取
    const icpScore = this.calculateICP(client);

    // 评分历史调整
    let ratingAdjustment = 0;
    if (client.averageRating !== undefined) {
      if (client.averageRating >= 4.5) {
        ratingAdjustment = 10;
      } else if (client.averageRating >= 4.0) {
        ratingAdjustment = 5;
      } else if (client.averageRating < 3.0) {
        ratingAdjustment = -20;
      } else if (client.averageRating < 3.5) {
        ratingAdjustment = -10;
      }
    }

    // 雇佣率调整
    let hireRateAdjustment = 0;
    if (client.hireRate !== undefined) {
      if (client.hireRate >= 0.8) {
        hireRateAdjustment = 5;
      } else if (client.hireRate < 0.3) {
        hireRateAdjustment = -10;
      }
    }

    return Math.min(100, Math.max(0, icpScore + ratingAdjustment + hireRateAdjustment));
  }

  // ─── Private Helper Methods ───────────────────────────────────────

  /**
   * 评估企业规模
   * 10-200人: 100分, <10人或>200人: 50分, >500人: 0分
   */
  private scoreCompanySize(companySize?: number): number {
    if (companySize === undefined) {
      return 60; // 未知，给中等偏上分数
    }

    if (companySize >= 10 && companySize <= 200) {
      return 100; // 理想规模
    } else if (companySize < 10 || (companySize > 200 && companySize <= 500)) {
      return 50; // 可接受
    } else {
      return 0; // 大企业，决策复杂
    }
  }

  /**
   * 评估技术成熟度 (基于历史项目)
   */
  private scoreTechnicalMaturity(client: ClientInfo): number {
    // 基于雇佣率和项目数量推断
    if (client.totalJobsPosted === undefined) {
      return 50;
    }

    if (client.totalJobsPosted >= 10 && client.hireRate && client.hireRate >= 0.7) {
      return 90; // 成熟客户
    } else if (client.totalJobsPosted >= 5) {
      return 70;
    } else if (client.totalJobsPosted >= 2) {
      return 50;
    } else {
      return 30; // 新客户
    }
  }

  /**
   * 评估客户预算范围
   * $1K-30K: 100分, $500-1K或$30K-50K: 60分, <$500: 0分
   */
  private scoreClientBudgetRange(client: ClientInfo): number {
    if (client.totalSpent === undefined) {
      return 50;
    }

    if (client.totalSpent >= 1000 && client.totalSpent <= 30000) {
      return 100;
    } else if (
      (client.totalSpent >= 500 && client.totalSpent < 1000) ||
      (client.totalSpent > 30000 && client.totalSpent <= 50000)
    ) {
      return 60;
    } else if (client.totalSpent < 500) {
      return 0;
    } else {
      return 40; // >50000，可能复杂度过高
    }
  }

  /**
   * 评估付款记录
   * 付款率 × 100
   */
  private scorePaymentHistory(paymentRate?: number): number {
    if (paymentRate === undefined) {
      return 50;
    }
    return Math.round(paymentRate * 100);
  }

  /**
   * 评估沟通响应时间
   * <12h: 100分, 12-24h: 60分, >24h: 20分
   */
  private scoreResponseTime(responseTime?: number): number {
    if (responseTime === undefined) {
      return 50;
    }

    if (responseTime < 12) {
      return 100;
    } else if (responseTime < 24) {
      return 60;
    } else {
      return 20;
    }
  }

  /**
   * 评估长期潜力
   */
  private scoreLongTermPotential(client: ClientInfo): number {
    let score = 50;

    // 有多个历史项目，可能复购
    if (client.totalJobsPosted && client.totalJobsPosted >= 5) {
      score += 20;
    }

    // 企业规模适中，可能有持续需求
    if (client.companySize && client.companySize >= 10 && client.companySize <= 100) {
      score += 20;
    }

    // 已验证用户
    if (client.verified) {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * 评估固定预算
   */
  private scoreFixedBudget(budget: BudgetInfo): number {
    const avgBudget = budget.minAmount && budget.maxAmount
      ? (budget.minAmount + budget.maxAmount) / 2
      : budget.minAmount || budget.maxAmount;

    if (!avgBudget) {
      return 50; // 预算未知
    }

    // $1000-$30000 理想范围
    if (avgBudget >= 1000 && avgBudget <= 30000) {
      return 100;
    } else if (avgBudget >= 500 && avgBudget < 1000) {
      return 60;
    } else if (avgBudget > 30000 && avgBudget <= 50000) {
      return 70; // 高预算，但可能复杂
    } else if (avgBudget < 500) {
      return 0; // 预算过低
    } else {
      return 50; // >50000，风险较高
    }
  }

  /**
   * 评估时薪预算
   */
  private scoreHourlyBudget(budget: BudgetInfo): number {
    const avgRate = budget.hourlyRateMin && budget.hourlyRateMax
      ? (budget.hourlyRateMin + budget.hourlyRateMax) / 2
      : budget.hourlyRateMin || budget.hourlyRateMax;

    if (!avgRate) {
      return 50;
    }

    // $80-$150/h 理想范围
    if (avgRate >= 80 && avgRate <= 150) {
      return 100;
    } else if (avgRate >= 50 && avgRate < 80) {
      return 70;
    } else if (avgRate > 150 && avgRate <= 200) {
      return 80;
    } else if (avgRate < 50) {
      return 30; // 费率过低
    } else {
      return 60; // >200，可能期望过高
    }
  }

  /**
   * 计算战略价值
   */
  private calculateStrategicValue(job: UpworkJob): number {
    let score = 40; // 基础分

    // 技术栈扩展价值
    const skills = job.requiredSkills.map(s => s.toLowerCase());
    const coreSkillsArray = Array.from(CORE_SKILLS);
    const secondarySkillsArray = Array.from(SECONDARY_SKILLS);
    const hasNewTech = skills.some(s =>
      !coreSkillsArray.some(core => s.includes(core)) &&
      secondarySkillsArray.some(sec => s.includes(sec))
    );
    if (hasNewTech) {
      score += 15;
    }

    // 长期合作潜力 (基于客户信息)
    if (job.client.totalJobsPosted && job.client.totalJobsPosted >= 5) {
      score += 20;
    }

    // 预算规模 (大型项目有更多学习机会)
    const avgBudget = job.budget.type === 'fixed'
      ? (job.budget.minAmount && job.budget.maxAmount
          ? (job.budget.minAmount + job.budget.maxAmount) / 2
          : job.budget.minAmount || 0)
      : 0;

    if (avgBudget >= 10000) {
      score += 15;
    } else if (avgBudget >= 5000) {
      score += 10;
    }

    // 技术难度 (适中难度最佳)
    if (job.complexity === 'medium') {
      score += 10;
    } else if (job.complexity === 'high') {
      score += 5; // 高难度有学习价值，但风险也高
    }

    return Math.min(100, score);
  }
}

// ─── Factory Function ────────────────────────────────────────────────

/**
 * 创建 ProjectScorer 实例
 */
export function createProjectScorer(): ProjectScorer {
  return new ProjectScorer();
}
