/**
 * BidGenerator - 投标消息生成器
 *
 * 实现投标提案生成、报价计算和模板管理
 * 参考 nanobot/nanobot/channels/upwork/skills/bid_generator.py
 */

import { createLogger } from "../observability/logger.js";

const logger = createLogger("bid-generator");

// ─── Types ─────────────────────────────────────────────────────────────

/**
 * 投标模板
 */
export interface BidTemplate {
  id: string;
  name: string;
  language: "en" | "zh";
  sections: {
    greeting: string;
    technicalApproach: string;
    relevantExperience: string;
    timeline: string;
    pricing: string;
    callToAction: string;
  };
}

/**
 * 投标上下文
 */
export interface BidContext {
  projectTitle: string;
  projectDescription: string;
  clientName?: string;
  budget: { min: number; max: number };
  deadline?: string;
  requiredSkills: string[];
  clientTier: "gold" | "silver" | "bronze" | "new";
  complexity?: "low" | "medium" | "high";
}

/**
 * 生成的投标
 */
export interface GeneratedBid {
  message: string;
  proposedAmount: number;
  estimatedDuration: string;
  templateUsed: string;
}

/**
 * 报价计算参数
 */
export interface PricingConfig {
  hourlyRate: number;           // 时薪 (USD)
  minBudget: number;            // 最低预算
  maxBudget: number;            // 最高预算
  profitMarginMin: number;      // 最低利润率 (0-1)
  profitMarginMax: number;      // 最高利润率 (0-1)
  urgencyMultiplier: number;    // 紧急系数 (1.0-1.5)
}

/**
 * 投标生成器配置
 */
export interface BidGeneratorConfig {
  pricing: PricingConfig;
  defaultLanguage: "en" | "zh";
  enableABTesting: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────

/**
 * 默认报价配置
 */
const DEFAULT_PRICING_CONFIG: PricingConfig = {
  hourlyRate: 80,
  minBudget: 100,
  maxBudget: 50000,
  profitMarginMin: 0.2,
  profitMarginMax: 0.4,
  urgencyMultiplier: 1.0,
};

/**
 * 默认投标生成器配置
 */
const DEFAULT_CONFIG: BidGeneratorConfig = {
  pricing: DEFAULT_PRICING_CONFIG,
  defaultLanguage: "en",
  enableABTesting: false,
};

/**
 * 英文投标模板
 */
const ENGLISH_TEMPLATES: BidTemplate[] = [
  {
    id: "en-professional",
    name: "Professional (English)",
    language: "en",
    sections: {
      greeting: "Hi there,",
      technicalApproach:
        "I noticed your project \"{title}\" and it aligns perfectly with my expertise.\n\n{approach}",
      relevantExperience:
        "I have extensive experience with {skills}, which seems to be exactly what you're looking for.",
      timeline:
        "Based on the project requirements, I estimate this can be completed in {duration}.",
      pricing:
        "My proposed budget for this project is ${amount}, which reflects the scope and complexity involved.",
      callToAction:
        "I'd love to discuss how I can help bring your vision to life. When would be a good time for a quick chat?\n\nBest regards",
    },
  },
  {
    id: "en-casual",
    name: "Casual (English)",
    language: "en",
    sections: {
      greeting: "Hey!",
      technicalApproach:
        "Your project \"{title}\" caught my eye - it's right up my alley.\n\n{approach}",
      relevantExperience:
        "I've worked extensively with {skills} and can hit the ground running.",
      timeline: "I can deliver this in about {duration}.",
      pricing: "I'm proposing ${amount} for the complete project.",
      callToAction:
        "Let's chat about your vision - I'm excited to help make it happen!\n\nCheers",
    },
  },
  {
    id: "en-formal",
    name: "Formal (English)",
    language: "en",
    sections: {
      greeting: "Dear {clientName},",
      technicalApproach:
        "Thank you for posting \"{title}\". After reviewing your requirements, I am confident in my ability to deliver exceptional results.\n\n{approach}",
      relevantExperience:
        "My professional background includes extensive work with {skills}, directly relevant to your project needs.",
      timeline:
        "I have carefully analyzed the scope and can complete the deliverables within {duration}.",
      pricing:
        "For this engagement, I propose a budget of ${amount}, ensuring comprehensive coverage of all requirements.",
      callToAction:
        "I would welcome the opportunity to discuss your project in detail. Please let me know a convenient time for a discussion.\n\nRespectfully",
    },
  },
];

/**
 * 中文投标模板
 */
const CHINESE_TEMPLATES: BidTemplate[] = [
  {
    id: "zh-professional",
    name: "专业版 (中文)",
    language: "zh",
    sections: {
      greeting: "您好，",
      technicalApproach:
        "我看到了您的项目\"{title}\"，这与我的专业领域非常契合。\n\n{approach}",
      relevantExperience:
        "我在{skills}方面有丰富的经验，正是您所需要的。",
      timeline: "根据项目需求，我估计可以在{duration}内完成。",
      pricing: "我对这个项目的报价是${amount}，这个价格反映了项目的范围和复杂度。",
      callToAction:
        "期待与您进一步沟通，了解如何帮助您实现项目目标。方便的话我们可以约个时间聊聊。\n\n祝好",
    },
  },
  {
    id: "zh-casual",
    name: "轻松版 (中文)",
    language: "zh",
    sections: {
      greeting: "嗨！",
      technicalApproach:
        "您的项目\"{title}\"很吸引我 - 正是我擅长的领域。\n\n{approach}",
      relevantExperience: "我在{skills}方面经验丰富，可以快速上手。",
      timeline: "预计{duration}可以交付。",
      pricing: "我的报价是${amount}。",
      callToAction: "期待和您聊聊，一起把项目做好！\n\n祝好",
    },
  },
];

/**
 * 客户等级语气调整
 */
const CLIENT_TIER_TONE: Record<
  BidContext["clientTier"],
  { formality: "casual" | "professional" | "formal"; confidence: number }
> = {
  gold: { formality: "formal", confidence: 1.0 },
  silver: { formality: "professional", confidence: 0.9 },
  bronze: { formality: "professional", confidence: 0.8 },
  new: { formality: "casual", confidence: 0.7 },
};

/**
 * 复杂度对应工期估算 (天)
 */
const COMPLEXITY_DURATION: Record<NonNullable<BidContext["complexity"]>, {
  min: number;
  max: number;
  label: { en: string; zh: string };
}> = {
  low: { min: 2, max: 5, label: { en: "2-5 days", zh: "2-5天" } },
  medium: { min: 5, max: 14, label: { en: "1-2 weeks", zh: "1-2周" } },
  high: { min: 14, max: 30, label: { en: "2-4 weeks", zh: "2-4周" } },
};

// ─── BidGenerator Class ────────────────────────────────────────────────

/**
 * 投标生成器
 *
 * 负责生成投标提案，包括：
 * - 模板选择
 * - 报价计算
 * - 工期估算
 * - 消息生成
 */
export class BidGenerator {
  private readonly config: BidGeneratorConfig;
  private readonly templates: Map<string, BidTemplate>;
  private abTestCounter = 0;

  constructor(config: Partial<BidGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config, pricing: { ...DEFAULT_PRICING_CONFIG, ...config.pricing } };
    this.templates = new Map<string, BidTemplate>();

    // 加载模板
    this.loadTemplates();
  }

  // ─── Public Methods ───────────────────────────────────────────────────

  /**
   * 生成投标提案
   */
  generateBid(context: BidContext): GeneratedBid {
    logger.info(`Generating bid for project: ${context.projectTitle}`);

    // 选择模板
    const template = this.selectTemplate(context);

    // 计算报价
    const proposedAmount = this.calculatePrice(
      context.budget,
      context.complexity || "medium"
    );

    // 估算工期
    const estimatedDuration = this.estimateDuration(
      context.projectDescription,
      context.requiredSkills
    );

    // 生成消息
    const message = this.buildMessage(template, {
      ...context,
      amount: proposedAmount,
      duration: estimatedDuration,
    });

    logger.info(
      `Bid generated: $${proposedAmount}, duration: ${estimatedDuration}, template: ${template.id}`
    );

    return {
      message,
      proposedAmount,
      estimatedDuration,
      templateUsed: template.id,
    };
  }

  /**
   * 选择模板
   */
  selectTemplate(context: BidContext): BidTemplate {
    // 确定语言
    const language = this.detectLanguage(context);

    // 确定语气
    const tone = CLIENT_TIER_TONE[context.clientTier];

    // 获取该语言的模板
    const languageTemplates = Array.from(this.templates.values()).filter(
      (t) => t.language === language
    );

    if (languageTemplates.length === 0) {
      // 回退到英文
      const englishTemplates = ENGLISH_TEMPLATES;
      return this.selectByFormality(englishTemplates, tone.formality);
    }

    // 根据 A/B 测试设置选择
    if (this.config.enableABTesting && languageTemplates.length > 1) {
      return this.selectForABTest(languageTemplates);
    }

    // 根据正式程度选择
    return this.selectByFormality(languageTemplates, tone.formality);
  }

  /**
   * 计算报价
   *
   * 报价公式：
   * 基准成本 = 预估工时 × 时薪
   * 风险溢价 = 需求清晰度逆映射 (0-30%)
   * 利润率 = 20-40%
   * 紧急系数 = 1.0-1.5
   *
   * 最终报价 = (基准成本 × (1 + 风险溢价) × (1 + 利润率)) × 紧急系数
   */
  calculatePrice(
    budget: { min: number; max: number },
    complexity: string
  ): number {
    const { pricing } = this.config;

    // 1. 预估工时 (基于复杂度)
    const estimatedHours = this.estimateHours(complexity);

    // 2. 基准成本
    const baseCost = estimatedHours * pricing.hourlyRate;

    // 3. 风险溢价 (0-30%, 基于复杂度)
    const riskPremium = this.calculateRiskPremium(complexity);

    // 4. 利润率 (20-40%, 随机或基于策略)
    const profitMargin = this.selectProfitMargin();

    // 5. 紧急系数
    const urgencyMultiplier = pricing.urgencyMultiplier;

    // 6. 计算最终报价
    let price =
      baseCost * (1 + riskPremium) * (1 + profitMargin) * urgencyMultiplier;

    // 7. 确保在预算范围内
    price = Math.max(pricing.minBudget, Math.min(pricing.maxBudget, price));

    // 8. 如果有预算范围，确保在范围内
    if (budget.min > 0 && budget.max > 0) {
      // 目标是预算范围的 70-85%
      const targetRatio = 0.75 + Math.random() * 0.1;
      const targetPrice = budget.min + (budget.max - budget.min) * targetRatio;

      // 如果计算价格在范围内，使用计算价格；否则使用目标价格
      if (price >= budget.min && price <= budget.max) {
        // 价格在范围内，可以略微调整
        price = Math.round(price);
      } else if (price < budget.min) {
        price = budget.min;
      } else {
        // 价格超出上限，使用目标价格
        price = Math.round(targetPrice);
      }
    }

    logger.debug(
      `Price calculation: base=$${baseCost.toFixed(2)}, risk=${(riskPremium * 100).toFixed(0)}%, profit=${(profitMargin * 100).toFixed(0)}%, urgency=${urgencyMultiplier.toFixed(2)}x, final=$${price}`
    );

    return Math.round(price);
  }

  /**
   * 估算工期
   */
  estimateDuration(description: string, skills: string[]): string {
    // 基于描述和技能分析复杂度
    const complexity = this.analyzeComplexity(description, skills);
    const durationInfo = COMPLEXITY_DURATION[complexity];

    // 返回英文标签（可以扩展为根据语言返回）
    return durationInfo.label.en;
  }

  /**
   * 获取所有模板
   */
  getTemplates(): BidTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 添加自定义模板
   */
  addTemplate(template: BidTemplate): void {
    this.templates.set(template.id, template);
    logger.info(`Added template: ${template.id}`);
  }

  /**
   * 移除模板
   */
  removeTemplate(templateId: string): boolean {
    const result = this.templates.delete(templateId);
    if (result) {
      logger.info(`Removed template: ${templateId}`);
    }
    return result;
  }

  // ─── Private Methods ──────────────────────────────────────────────────

  /**
   * 加载默认模板
   */
  private loadTemplates(): void {
    for (const template of [...ENGLISH_TEMPLATES, ...CHINESE_TEMPLATES]) {
      this.templates.set(template.id, template);
    }
    logger.debug(`Loaded ${this.templates.size} templates`);
  }

  /**
   * 检测语言偏好
   */
  private detectLanguage(context: BidContext): "en" | "zh" {
    // 如果客户名称包含中文字符，使用中文
    if (context.clientName) {
      const hasChinese = /[\u4e00-\u9fff]/.test(context.clientName);
      if (hasChinese) {
        return "zh";
      }
    }

    // 如果项目描述主要是中文，使用中文
    const chineseRatio = this.calculateChineseRatio(context.projectDescription);
    if (chineseRatio > 0.3) {
      return "zh";
    }

    // 默认使用配置的语言
    return this.config.defaultLanguage;
  }

  /**
   * 计算中文字符比例
   */
  private calculateChineseRatio(text: string): number {
    if (!text || text.length === 0) return 0;
    const chineseChars = text.match(/[\u4e00-\u9fff]/g);
    return chineseChars ? chineseChars.length / text.length : 0;
  }

  /**
   * 根据正式程度选择模板
   */
  private selectByFormality(
    templates: BidTemplate[],
    formality: "casual" | "professional" | "formal"
  ): BidTemplate {
    // 尝试匹配精确的正式程度
    const matched = templates.find((t) => t.id.includes(formality));
    if (matched) return matched;

    // 回退到第一个模板
    return templates[0]!;
  }

  /**
   * A/B 测试选择
   */
  private selectForABTest(templates: BidTemplate[]): BidTemplate {
    // 轮询选择
    const index = this.abTestCounter % templates.length;
    this.abTestCounter++;
    return templates[index]!;
  }

  /**
   * 估算工时
   */
  private estimateHours(complexity: string): number {
    const hoursMap: Record<string, number> = {
      low: 8,      // 1天
      medium: 24,  // 3天
      high: 80,    // 10天
    };
    return hoursMap[complexity] || hoursMap.medium;
  }

  /**
   * 计算风险溢价
   */
  private calculateRiskPremium(complexity: string): number {
    // 复杂度越高，风险溢价越高
    const premiumMap: Record<string, number> = {
      low: 0.05,
      medium: 0.15,
      high: 0.30,
    };
    return premiumMap[complexity] || premiumMap.medium;
  }

  /**
   * 选择利润率
   */
  private selectProfitMargin(): number {
    const { profitMarginMin, profitMarginMax } = this.config.pricing;
    return profitMarginMin + Math.random() * (profitMarginMax - profitMarginMin);
  }

  /**
   * 分析复杂度
   */
  private analyzeComplexity(
    description: string,
    _skills: string[]
  ): "low" | "medium" | "high" {
    const descLower = description.toLowerCase();

    // 高复杂度关键词
    const highComplexityKeywords = [
      "enterprise",
      "scalable",
      "microservice",
      "distributed",
      "real-time",
      "machine learning",
      "ai",
      "blockchain",
      "企业级",
      "分布式",
      "实时",
    ];

    // 低复杂度关键词
    const lowComplexityKeywords = [
      "simple",
      "landing page",
      "bug fix",
      "small",
      "quick",
      "简单",
      "修复",
      "小",
    ];

    // 检查高复杂度关键词
    if (highComplexityKeywords.some((kw) => descLower.includes(kw))) {
      return "high";
    }

    // 检查低复杂度关键词
    if (lowComplexityKeywords.some((kw) => descLower.includes(kw))) {
      return "low";
    }

    // 默认中等复杂度
    return "medium";
  }

  /**
   * 构建消息
   */
  private buildMessage(
    template: BidTemplate,
    context: BidContext & { amount: number; duration: string }
  ): string {
    const sections = template.sections;

    // 格式化技能列表
    const skillsStr = this.formatSkills(context.requiredSkills, template.language);

    // 根据项目类型生成方法建议
    const approach = this.suggestApproach(
      context.projectDescription,
      template.language
    );

    // 构建各部分
    const parts: string[] = [];

    // 问候语
    parts.push(
      sections.greeting.replace("{clientName}", context.clientName || "there")
    );

    // 技术方法
    parts.push(
      sections.technicalApproach
        .replace("{title}", context.projectTitle)
        .replace("{approach}", approach)
    );

    // 相关经验
    parts.push(sections.relevantExperience.replace("{skills}", skillsStr));

    // 时间线
    parts.push(sections.timeline.replace("{duration}", context.duration));

    // 报价
    parts.push(sections.pricing.replace("{amount}", context.amount.toString()));

    // 行动号召
    parts.push(sections.callToAction);

    return parts.join("\n\n");
  }

  /**
   * 格式化技能列表
   */
  private formatSkills(skills: string[], language: "en" | "zh"): string {
    if (!skills || skills.length === 0) {
      return language === "zh" ? "相关技术" : "relevant technologies";
    }

    // 最多显示 3 个技能
    const topSkills = skills.slice(0, 3);

    if (language === "zh") {
      return topSkills.join("、");
    }

    if (topSkills.length === 1) {
      return topSkills[0]!;
    }

    if (topSkills.length === 2) {
      return `${topSkills[0]} and ${topSkills[1]}`;
    }

    return `${topSkills[0]}, ${topSkills[1]}, and ${topSkills[2]}`;
  }

  /**
   * 根据项目描述建议方法
   */
  private suggestApproach(description: string, language: "en" | "zh"): string {
    const descLower = description.toLowerCase();

    if (language === "zh") {
      if (descLower.includes("api") || descLower.includes("backend") || descLower.includes("后端")) {
        return "我可以构建一个健壮、可扩展的后端解决方案，包含完善的错误处理和文档。";
      }
      if (descLower.includes("frontend") || descLower.includes("ui") || descLower.includes("react") || descLower.includes("前端")) {
        return "我专注于创建清晰、响应式的界面，提供出色的用户体验。";
      }
      if (descLower.includes("automation") || descLower.includes("script") || descLower.includes("自动化")) {
        return "我可以开发高效的自动化解决方案，帮您节省时间。";
      }
      if (descLower.includes("data") || descLower.includes("database") || descLower.includes("数据")) {
        return "我有丰富的数据处理经验，可以确保准确性和性能。";
      }
      return "我有信心按时交付高质量的工作成果。";
    }

    // English
    if (descLower.includes("api") || descLower.includes("backend")) {
      return "I can build a robust, scalable solution with proper error handling and documentation.";
    }
    if (descLower.includes("frontend") || descLower.includes("ui") || descLower.includes("react")) {
      return "I focus on creating clean, responsive interfaces with great user experience.";
    }
    if (descLower.includes("automation") || descLower.includes("script")) {
      return "I can develop an efficient automated solution that saves you time.";
    }
    if (descLower.includes("data") || descLower.includes("database")) {
      return "I have experience with data processing and can ensure accuracy and performance.";
    }
    return "I'm confident I can deliver quality work within your timeline.";
  }
}

// ─── Factory Function ───────────────────────────────────────────────────

/**
 * 创建 BidGenerator 实例
 */
export function createBidGenerator(
  config?: Partial<BidGeneratorConfig>
): BidGenerator {
  return new BidGenerator(config);
}

// ─── Default Export ─────────────────────────────────────────────────────

export default BidGenerator;
