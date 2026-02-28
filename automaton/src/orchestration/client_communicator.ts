/**
 * Automaton 客户沟通模块
 * 负责生成提案、求职信和客户回复
 *
 * @module orchestration/client_communicator
 * @version 1.0.0
 */

import type { ChatMessage } from "../types.js";
import type { ModelTier } from "../inference/provider-registry.js";
import { UnifiedInferenceClient } from "../inference/inference-client.js";

// ============================================================================
// 类型定义
// ============================================================================

/** Upwork 项目信息 */
export interface UpworkProject {
  /** 项目 ID */
  id: string;
  /** 项目标题 */
  title: string;
  /** 项目描述 */
  description: string;
  /** 预算信息 */
  budget: {
    type: "fixed" | "hourly";
    min_amount?: number;
    max_amount?: number;
    currency?: string;
  } | null;
  /** 所需技能 */
  skills: string[];
  /** 项目分类 */
  category: string;
  /** 子分类 */
  subcategory?: string;
  /** 客户信息 */
  client?: {
    id: string;
    name?: string;
    country?: string;
    rating?: number;
    reviews_count?: number;
    verified?: boolean;
    total_spent?: number;
    jobs_posted?: number;
    hire_rate?: number;
  } | null;
  /** 发布时间 */
  posted_at?: string;
  /** 项目 URL */
  url: string;
  /** 项目类型 */
  job_type: "fixed" | "hourly";
}

/** 生成的投标 */
export interface GeneratedBid {
  /** 项目 ID */
  project_id: string;
  /** 求职信 */
  cover_letter: string;
  /** 投标金额 */
  bid_amount: number;
  /** 预计工期（天） */
  duration_days?: number;
  /** 里程碑描述 */
  milestone_description?: string;
  /** 匹配分数 */
  match_score?: number;
  /** 匹配的技能 */
  matched_skills?: string[];
  /** 置信度 */
  confidence?: number;
}

/** 项目上下文 */
export interface ProjectContext {
  /** 项目 ID */
  projectId: string;
  /** 项目名称 */
  projectName: string;
  /** 项目根路径 */
  projectRoot: string;
  /** 主要编程语言 */
  primaryLanguage: string;
  /** 框架 */
  frameworks: string[];
  /** 依赖项 */
  dependencies: Record<string, string>;
  /** Git 信息 */
  git: {
    branch: string;
    commit: string;
    remote: string;
    isClean: boolean;
  };
  /** 环境变量 */
  environment: Record<string, string>;
  /** 自定义配置 */
  customConfig: Record<string, unknown>;
}

/** 提案生成选项 */
export interface ProposalGenerationOptions {
  /** 强调的技能 */
  emphasizeSkills?: string[];
  /** 相关项目经验 */
  relevantExperience?: string[];
  /** 语气风格 */
  tone?: "professional" | "friendly" | "enthusiastic";
  /** 包含的问题 */
  questions?: string[];
  /** 最大长度 */
  maxLength?: number;
}

/** 消息模板 */
export interface MessageTemplate {
  /** 模板名称 */
  name: string;
  /** 模板内容 */
  content: string;
  /** 变量占位符 */
  variables: string[];
  /** 模板类型 */
  type: "proposal" | "cover_letter" | "response" | "follow_up";
}

/** 沟通配置 */
export interface CommunicatorConfig {
  /** 默认模型层级 */
  defaultModelTier: ModelTier;
  /** 默认最大 Token 数 */
  defaultMaxTokens: number;
  /** 默认温度 */
  defaultTemperature: number;
  /** 模板目录 */
  templatesDir: string;
  /** 是否启用缓存 */
  enableCache: boolean;
  /** 缓存 TTL (毫秒) */
  cacheTtlMs: number;
}

// ============================================================================
// 默认配置
// ============================================================================

const DEFAULT_COMMUNICATOR_CONFIG: CommunicatorConfig = {
  defaultModelTier: "fast",
  defaultMaxTokens: 2000,
  defaultTemperature: 0.7,
  templatesDir: "./templates/client",
  enableCache: true,
  cacheTtlMs: 60 * 60 * 1000, // 1 hour
};

// ============================================================================
// 消息模板
// ============================================================================

const DEFAULT_PROPOSAL_TEMPLATE = `Dear {{client_name}},

I came across your project "{{project_title}}" and was immediately drawn to it.

{{relevant_experience}}

Based on my experience, I can help you with:
{{deliverables}}

**My Approach:**
{{approach}}

**Timeline:** {{timeline}}
**Budget:** {{bid_amount}}

I noticed that your project requires {{key_skills}}. I have extensive experience with these technologies and would love to discuss how I can contribute to your project.

{{questions}}

Best regards,
{{your_name}}`;

const DEFAULT_COVER_LETTER_TEMPLATE = `Subject: Proposal for {{project_title}}

Dear {{client_name}},

I am writing to express my interest in your project "{{project_title}}".

{{introduction}}

**Why Me:**
{{why_me}}

**My Skills:**
{{skills}}

I am excited about the opportunity to work with you and am confident I can deliver the results you're looking for.

Thank you for considering my proposal.

Best regards,
{{your_name}}`;

const DEFAULT_RESPONSE_TEMPLATE = `{{greeting}}

Thank you for your message. {{acknowledgment}}

{{response_content}}

{{next_steps}}

Best regards,
{{your_name}}`;

// ============================================================================
// 客户沟通器
// ============================================================================

/**
 * Automaton 客户沟通器
 * 负责生成提案、求职信和客户回复
 */
export class ClientCommunicator {
  private config: CommunicatorConfig;
  private inferenceClient: UnifiedInferenceClient;
  private cache: Map<string, { data: string; expiresAt: number }>;
  private templates: Map<string, MessageTemplate>;

  constructor(
    inferenceClient: UnifiedInferenceClient,
    config: Partial<CommunicatorConfig> = {}
  ) {
    this.config = { ...DEFAULT_COMMUNICATOR_CONFIG, ...config };
    this.inferenceClient = inferenceClient;
    this.cache = new Map();
    this.templates = new Map();

    // 加载默认模板
    this.loadDefaultTemplates();
  }

  // ===========================================================================
  // 提案生成
  // ===========================================================================

  /**
   * 生成项目提案
   */
  async generateProposal(
    project: UpworkProject,
    bid: GeneratedBid,
    options: ProposalGenerationOptions = {}
  ): Promise<string> {
    const cacheKey = this.buildCacheKey("proposal", project.id, bid);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const emphasizeSkills = options.emphasizeSkills || bid.matched_skills || project.skills.slice(0, 3);
    const relevantExperience = options.relevantExperience || this.buildRelevantExperience(project);
    const tone = options.tone || "professional";

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: this.buildSystemPrompt(tone),
      },
      {
        role: "user",
        content: this.buildProposalPrompt(project, bid, emphasizeSkills, relevantExperience, options.questions),
      },
    ];

    const result = await this.inferenceClient.chat({
      tier: this.config.defaultModelTier,
      messages,
      temperature: this.config.defaultTemperature,
      maxTokens: this.config.defaultMaxTokens,
    });

    const proposal = this.formatProposal(result.content, project, bid);
    this.setToCache(cacheKey, proposal);

    return proposal;
  }

  /**
   * 生成求职信
   */
  async generateCoverLetter(
    project: UpworkProject,
    options: ProposalGenerationOptions = {}
  ): Promise<string> {
    const cacheKey = this.buildCacheKey("cover_letter", project.id);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const emphasizeSkills = options.emphasizeSkills || project.skills.slice(0, 3);
    const tone = options.tone || "professional";

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: this.buildSystemPrompt(tone),
      },
      {
        role: "user",
        content: this.buildCoverLetterPrompt(project, emphasizeSkills),
      },
    ];

    const result = await this.inferenceClient.chat({
      tier: this.config.defaultModelTier,
      messages,
      temperature: this.config.defaultTemperature,
      maxTokens: this.config.defaultMaxTokens,
    });

    const coverLetter = this.formatCoverLetter(result.content, project);
    this.setToCache(cacheKey, coverLetter);

    return coverLetter;
  }

  /**
   * 生成回复
   */
  async generateResponse(
    question: string,
    context: ProjectContext,
    tone: "professional" | "friendly" | "enthusiastic" = "professional"
  ): Promise<string> {
    const cacheKey = this.buildCacheKey("response", question, context.projectId);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: this.buildSystemPrompt(tone),
      },
      {
        role: "user",
        content: this.buildResponsePrompt(question, context),
      },
    ];

    const result = await this.inferenceClient.chat({
      tier: this.config.defaultModelTier,
      messages,
      temperature: this.config.defaultTemperature,
      maxTokens: this.config.defaultMaxTokens,
    });

    const response = this.formatResponse(result.content);
    this.setToCache(cacheKey, response);

    return response;
  }

  // ===========================================================================
  // 模板格式化
  // ===========================================================================

  /**
   * 格式化消息
   */
  formatMessage(template: string, data: Record<string, unknown>): string {
    let formatted = template;

    for (const [key, value] of Object.entries(data)) {
      const placeholder = `{{${key}}}`;
      formatted = formatted.replaceAll(placeholder, String(value ?? ""));
    }

    return formatted;
  }

  /**
   * 使用模板生成消息
   */
  async generateFromTemplate(
    templateName: string,
    data: Record<string, unknown>
  ): Promise<string> {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(`Template '${templateName}' not found`);
    }

    return this.formatMessage(template.content, data);
  }

  // ===========================================================================
  // 模板管理
  // ===========================================================================

  /**
   * 注册模板
   */
  registerTemplate(template: MessageTemplate): void {
    this.templates.set(template.name, template);
  }

  /**
   * 获取模板
   */
  getTemplate(name: string): MessageTemplate | undefined {
    return this.templates.get(name);
  }

  /**
   * 列出所有模板
   */
  listTemplates(): MessageTemplate[] {
    return Array.from(this.templates.values());
  }

  // ===========================================================================
  // 缓存管理
  // ===========================================================================

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * 清除过期缓存
   */
  clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }

  // ===========================================================================
  // 私有方法
  // ===========================================================================

  /**
   * 加载默认模板
   */
  private loadDefaultTemplates(): void {
    this.registerTemplate({
      name: "default_proposal",
      content: DEFAULT_PROPOSAL_TEMPLATE,
      variables: ["client_name", "project_title", "relevant_experience", "deliverables", "approach", "timeline", "bid_amount", "key_skills", "questions", "your_name"],
      type: "proposal",
    });

    this.registerTemplate({
      name: "default_cover_letter",
      content: DEFAULT_COVER_LETTER_TEMPLATE,
      variables: ["project_title", "client_name", "introduction", "why_me", "skills", "your_name"],
      type: "cover_letter",
    });

    this.registerTemplate({
      name: "default_response",
      content: DEFAULT_RESPONSE_TEMPLATE,
      variables: ["greeting", "acknowledgment", "response_content", "next_steps", "your_name"],
      type: "response",
    });
  }

  /**
   * 构建系统提示
   */
  private buildSystemPrompt(tone: "professional" | "friendly" | "enthusiastic"): string {
    const toneInstructions = {
      professional: "Maintain a professional, courteous, and business-like tone.",
      friendly: "Be warm, approachable, and friendly while remaining professional.",
      enthusiastic: "Show enthusiasm and energy while maintaining professionalism.",
    };

    return `You are an expert freelance developer writing proposals and communications for clients on Upwork.

Guidelines:
- ${toneInstructions[tone]}
- Be concise and to the point
- Highlight relevant skills and experience
- Ask thoughtful questions when appropriate
- Always proofread for grammar and spelling
- Focus on the value you can provide to the client
- Avoid generic templates - customize for each project`;
  }

  /**
   * 构建提案提示
   */
  private buildProposalPrompt(
    project: UpworkProject,
    bid: GeneratedBid,
    emphasizeSkills: string[],
    relevantExperience: string[],
    questions?: string[]
  ): string {
    const clientName = project.client?.name || "Client";
    const budgetText = project.budget
      ? `${project.budget.type === "fixed" ? "Fixed" : "Hourly"} Budget: $${project.budget.min_amount || 0}-${project.budget.max_amount || 0}`
      : "Budget not specified";

    let prompt = `Write a proposal for the following Upwork project:

**Project:**
- Title: ${project.title}
- Description: ${project.description}
- Category: ${project.category}${project.subcategory ? ` / ${project.subcategory}` : ""}
- Budget: ${budgetText}
- Type: ${project.job_type}

**Client:**
- Name: ${clientName}${project.client?.rating ? `\n- Rating: ${project.client.rating}/5` : ""}${project.client?.verified ? "\n- Verified: Yes" : ""}

**Required Skills:** ${project.skills.join(", ")}

**My Bid:**
- Amount: $${bid.bid_amount}${bid.duration_days ? `\n- Duration: ${bid.duration_days} days` : ""}

**Skills to Emphasize:** ${emphasizeSkills.join(", ")}

**Relevant Experience:**
${relevantExperience.map((exp) => `- ${exp}`).join("\n")}`;

    if (questions && questions.length > 0) {
      prompt += `\n\n**Questions to Ask:**\n${questions.map((q) => `- ${q}`).join("\n")}`;
    }

    prompt += `\n\nWrite a compelling, customized proposal that demonstrates understanding of the project and shows why I'm the best fit.`;

    return prompt;
  }

  /**
   * 构建求职信提示
   */
  private buildCoverLetterPrompt(project: UpworkProject, emphasizeSkills: string[]): string {
    const clientName = project.client?.name || "Client";

    return `Write a cover letter for the following Upwork project:

**Project:** ${project.title}
**Description:** ${project.description}
**Category:** ${project.category}
**Required Skills:** ${project.skills.join(", ")}

**Skills to Emphasize:** ${emphasizeSkills.join(", ")}

Write a concise, engaging cover letter that:
1. Shows understanding of the project
2. Highlights relevant skills and experience
3. Expresses genuine interest
4. Is addressed to ${clientName}

Keep it under 300 words.`;
  }

  /**
   * 构建回复提示
   */
  private buildResponsePrompt(question: string, context: ProjectContext): string {
    return `Write a response to the following client message:

**Client Question:** ${question}

**Project Context:**
- Project: ${context.projectName}
- Language: ${context.primaryLanguage}
- Frameworks: ${context.frameworks.join(", ")}

Write a helpful, clear response that addresses the client's question directly and professionally.`;
  }

  /**
   * 格式化提案
   */
  private formatProposal(content: string, project: UpworkProject, bid: GeneratedBid): string {
    // 确保提案包含关键信息
    if (!content.toLowerCase().includes(project.title.toLowerCase())) {
      content = `Re: ${project.title}\n\n${content}`;
    }

    // 添加投标金额
    if (!content.includes("$") && bid.bid_amount > 0) {
      content += `\n\n**Bid Amount:** $${bid.bid_amount}`;
    }

    return content.trim();
  }

  /**
   * 格式化求职信
   */
  private formatCoverLetter(content: string, project: UpworkProject): string {
    // 确保求职信有合适的主题行
    if (!content.toLowerCase().startsWith("subject:") && !content.toLowerCase().startsWith("re:")) {
      content = `Subject: Proposal for ${project.title}\n\n${content}`;
    }

    return content.trim();
  }

  /**
   * 格式化回复
   */
  private formatResponse(content: string): string {
    return content.trim();
  }

  /**
   * 构建相关经验
   */
  private buildRelevantExperience(project: UpworkProject): string[] {
    const experiences: string[] = [];

    // 基于技能生成相关经验
    const skillExperience: Record<string, string> = {
      typescript: "Built scalable TypeScript applications for enterprise clients",
      python: "Developed Python-based APIs and data processing pipelines",
      react: "Created responsive React applications with modern UI/UX",
      "fastapi": "Built high-performance REST APIs using FastAPI",
      postgresql: "Designed and optimized PostgreSQL database schemas",
      api: "Integrated with third-party APIs and built robust API services",
    };

    for (const skill of project.skills) {
      const exp = skillExperience[skill.toLowerCase()];
      if (exp) {
        experiences.push(exp);
      }
    }

    if (experiences.length === 0) {
      experiences.push("Delivered high-quality software solutions for clients worldwide");
    }

    return experiences;
  }

  /**
   * 构建缓存键
   */
  private buildCacheKey(...parts: (string | number | object)[]): string {
    return parts
      .map((p) => (typeof p === "object" ? JSON.stringify(p) : String(p)))
      .join(":");
  }

  /**
   * 从缓存获取
   */
  private getFromCache(key: string): string | null {
    if (!this.config.enableCache) return null;

    const cached = this.cache.get(key);
    if (!cached) return null;

    if (cached.expiresAt < Date.now()) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * 设置缓存
   */
  private setToCache(key: string, data: string): void {
    if (!this.config.enableCache) return;

    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
  }
}

// ============================================================================
// 工厂函数
// ============================================================================

/**
 * 创建客户沟通器
 */
export function createClientCommunicator(
  inferenceClient: UnifiedInferenceClient,
  config?: Partial<CommunicatorConfig>
): ClientCommunicator {
  return new ClientCommunicator(inferenceClient, config);
}
