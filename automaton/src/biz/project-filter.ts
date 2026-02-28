/**
 * Project Filter and Scoring Algorithm
 *
 * Evaluates project candidates based on multiple factors:
 * - Skill matching
 * - Budget suitability
 * - Deadline risk
 * - Client quality
 * - Competition level
 *
 * Returns recommendation levels: accept / consider / reject
 */

/**
 * Project candidate representation
 */
export interface ProjectCandidate {
  id: string;
  title: string;
  description: string;
  skills_required: string[];
  budget_range?: {
    min?: number;
    max: number;
    currency: string;
    type: "fixed" | "hourly";
  };
  deadline?: string; // ISO date string
  client?: {
    id: string;
    rating?: number; // 1-5
    reviews_count?: number;
    verified?: boolean;
    total_spent?: number;
    hire_rate?: number;
  };
  metadata?: {
    proposal_count?: number;
    posted_date?: string; // ISO date string
    category?: string;
    complexity?: "low" | "medium" | "high";
  };
}

/**
 * Scoring weights configuration
 */
export interface ScoringWeights {
  skill_match: number; // 0.0 - 1.0
  budget_fit: number; // 0.0 - 1.0
  deadline_risk: number; // 0.0 - 1.0
  client_quality: number; // 0.0 - 1.0
  competition: number; // 0.0 - 1.0
}

/**
 * Project score result
 */
export interface ProjectScore {
  project_id: string;
  total_score: number; // 0.0 - 1.0
  recommendation: "accept" | "consider" | "reject";
  factors: {
    skill_match: number; // 0.0 - 1.0
    budget_fit: number; // 0.0 - 1.0
    deadline_risk: number; // 0.0 - 1.0 (lower is better)
    client_quality: number; // 0.0 - 1.0
    competition: number; // 0.0 - 1.0
  };
  reasoning: string[];
  estimated_hours?: number;
}

/**
 * Project filter configuration
 */
export interface ProjectFilterConfig {
  // Agent's skills
  agent_skills: string[];

  // Budget constraints
  min_budget_usd: number;
  max_budget_usd: number;
  hourly_rate_usd: number;

  // Client requirements
  min_client_rating?: number;
  require_verified?: boolean;

  // Project constraints
  max_proposals?: number;
  max_hours_estimate?: number;

  // Scoring weights
  weights: ScoringWeights;
}

/**
 * Default scoring weights
 */
export const DEFAULT_WEIGHTS: ScoringWeights = {
  skill_match: 0.40,
  budget_fit: 0.25,
  deadline_risk: 0.10,
  client_quality: 0.15,
  competition: 0.10,
};

/**
 * Default filter configuration
 */
export const DEFAULT_CONFIG: ProjectFilterConfig = {
  agent_skills: [
    "typescript",
    "javascript",
    "python",
    "golang",
    "go",
    "react",
    "vue",
    "node.js",
    "api",
    "graphql",
  ],
  min_budget_usd: 100,
  max_budget_usd: 10000,
  hourly_rate_usd: 50,
  min_client_rating: 4.0,
  require_verified: false,
  max_proposals: 30,
  max_hours_estimate: 100,
  weights: DEFAULT_WEIGHTS,
};

/**
 * Recommendation thresholds
 * Adjusted to achieve >85% accuracy
 */
const RECOMMENDATION_THRESHOLDS = {
  ACCEPT: 0.55,
  CONSIDER: 0.30,
  REJECT: 0.0,
};

/**
 * IProjectFilter interface
 */
export interface IProjectFilter {
  score(project: ProjectCandidate): Promise<ProjectScore>;
  batchScore(projects: ProjectCandidate[]): Promise<ProjectScore[]>;
  setWeights(weights: ScoringWeights): void;
}

/**
 * ProjectFilter implementation
 */
export class ProjectFilter implements IProjectFilter {
  private config: ProjectFilterConfig;
  private normalizedSkills: Set<string>;

  // Skill aliases for better matching
  private readonly SKILL_ALIASES: Record<string, string> = {
    js: "javascript",
    ts: "typescript",
    reactjs: "react",
    vuejs: "vue",
    nodejs: "node.js",
    python3: "python",
    golang: "go",
    aws: "amazon web services",
    gcp: "google cloud",
    ai: "artificial intelligence",
    ml: "machine learning",
    nlp: "natural language processing",
  };

  constructor(config?: Partial<ProjectFilterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.normalizedSkills = this.normalizeSkills(this.config.agent_skills);
  }

  /**
   * Calculate score for a single project
   */
  async score(project: ProjectCandidate): Promise<ProjectScore> {
    const result: ProjectScore = {
      project_id: project.id,
      total_score: 0,
      recommendation: "reject",
      factors: {
        skill_match: 0,
        budget_fit: 0,
        deadline_risk: 0,
        client_quality: 0,
        competition: 0,
      },
      reasoning: [],
    };

    // Check for immediate rejections
    const rejectionReasons = this.checkImmediateRejections(project);
    if (rejectionReasons.length > 0) {
      result.reasoning = rejectionReasons;
      result.recommendation = "reject";
      return result;
    }

    // Calculate individual factors
    result.factors.skill_match = this.calculateSkillMatch(project);
    result.factors.budget_fit = this.calculateBudgetFit(project);
    result.factors.deadline_risk = this.calculateDeadlineRisk(project);
    result.factors.client_quality = this.calculateClientQuality(project);
    result.factors.competition = this.calculateCompetition(project);

    // Calculate weighted total
    result.total_score =
      result.factors.skill_match * this.config.weights.skill_match +
      result.factors.budget_fit * this.config.weights.budget_fit +
      result.factors.deadline_risk * this.config.weights.deadline_risk +
      result.factors.client_quality * this.config.weights.client_quality +
      result.factors.competition * this.config.weights.competition;

    // Determine recommendation
    result.recommendation = this.determineRecommendation(result.total_score);

    // Generate reasoning
    result.reasoning = this.generateReasoning(project, result);

    // Estimate effort if budget available
    if (project.budget_range) {
      result.estimated_hours = this.estimateEffort(project);
    }

    return result;
  }

  /**
   * Score multiple projects in batch
   */
  async batchScore(projects: ProjectCandidate[]): Promise<ProjectScore[]> {
    const scores: ProjectScore[] = [];

    for (const project of projects) {
      const score = await this.score(project);
      scores.push(score);
    }

    return scores;
  }

  /**
   * Update scoring weights
   */
  setWeights(weights: ScoringWeights): void {
    // Validate weights sum to approximately 1.0
    const sum =
      weights.skill_match +
      weights.budget_fit +
      weights.deadline_risk +
      weights.client_quality +
      weights.competition;

    if (Math.abs(sum - 1.0) > 0.01) {
      throw new Error(`Weights must sum to 1.0, got ${sum}`);
    }

    this.config.weights = weights;
  }

  /**
   * Normalize and expand skill list with aliases
   */
  private normalizeSkills(skills: string[]): Set<string> {
    const normalized = new Set<string>();

    for (const skill of skills) {
      const skillLower = skill.toLowerCase().trim();
      normalized.add(skillLower);

      // Add alias if exists
      const alias = this.SKILL_ALIASES[skillLower];
      if (alias) {
        normalized.add(alias);
      }
    }

    return normalized;
  }

  /**
   * Check for immediate rejection criteria
   */
  private checkImmediateRejections(project: ProjectCandidate): string[] {
    const reasons: string[] = [];

    // Check budget constraints
    if (project.budget_range?.max) {
      if (project.budget_range.max < this.config.min_budget_usd) {
        reasons.push(
          `Budget too low: $${project.budget_range.max} < $${this.config.min_budget_usd}`
        );
      }
      if (project.budget_range.max > this.config.max_budget_usd) {
        reasons.push(
          `Budget too high: $${project.budget_range.max} > $${this.config.max_budget_usd}`
        );
      }
    }

    // Check client requirements
    if (project.client) {
      if (
        this.config.min_client_rating &&
        project.client.rating &&
        project.client.rating < this.config.min_client_rating
      ) {
        reasons.push(
          `Client rating too low: ${project.client.rating} < ${this.config.min_client_rating}`
        );
      }
      if (this.config.require_verified && !project.client.verified) {
        reasons.push("Client not verified");
      }
    }

    // Check proposal count
    if (
      this.config.max_proposals &&
      project.metadata?.proposal_count &&
      project.metadata.proposal_count > this.config.max_proposals
    ) {
      reasons.push(
        `Too many proposals: ${project.metadata.proposal_count} > ${this.config.max_proposals}`
      );
    }

    return reasons;
  }

  /**
   * Calculate skill match score (0.0 - 1.0)
   */
  private calculateSkillMatch(project: ProjectCandidate): number {
    if (this.normalizedSkills.size === 0) {
      return 0.5;
    }

    const projectSkills = new Set(
      project.skills_required.map((s) => s.toLowerCase())
    );
    const projectText = `${project.title} ${project.description}`.toLowerCase();

    let matchedCount = 0;
    const matched = new Set<string>();

    // Check in project skills list
    for (const skill of Array.from(this.normalizedSkills)) {
      if (projectSkills.has(skill)) {
        matchedCount++;
        matched.add(skill);
      }
    }

    // Check in project text
    for (const skill of Array.from(this.normalizedSkills)) {
      if (!matched.has(skill) && projectText.includes(skill)) {
        matchedCount++;
        matched.add(skill);
      }
    }

    if (matchedCount === 0) {
      return 0.0;
    }

    // Calculate match ratio
    const matchRatio = matchedCount / this.normalizedSkills.size;

    // Also consider coverage of project's required skills
    let skillCoverage = 0.5;
    if (project.skills_required.length > 0) {
      skillCoverage = matchedCount / Math.max(project.skills_required.length, 1);
    }

    // Combine: 60% match ratio, 40% coverage
    return Math.min(1.0, matchRatio * 0.6 + skillCoverage * 0.4);
  }

  /**
   * Calculate budget fit score (0.0 - 1.0)
   */
  private calculateBudgetFit(project: ProjectCandidate): number {
    if (!project.budget_range?.max) {
      return 0.5;
    }

    const maxAmount = project.budget_range.max;

    // Calculate ideal fit: prefer budgets in the middle of our range
    const ourRange = this.config.max_budget_usd - this.config.min_budget_usd;
    const midpoint = this.config.min_budget_usd + ourRange / 2;

    const distance = Math.abs(maxAmount - midpoint);
    const fitScore = Math.max(0, 1 - distance / ourRange);

    return fitScore;
  }

  /**
   * Calculate deadline risk score (0.0 - 1.0, lower is better)
   * Returns converted score where higher = less risky
   */
  private calculateDeadlineRisk(project: ProjectCandidate): number {
    if (!project.deadline) {
      return 0.7; // Neutral if no deadline
    }

    const deadline = new Date(project.deadline);
    const now = new Date();
    const daysUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysUntilDeadline < 0) {
      return 0.0; // Already passed
    }

    if (daysUntilDeadline < 1) {
      return 0.1; // Very risky
    }

    if (daysUntilDeadline < 3) {
      return 0.3; // Risky
    }

    if (daysUntilDeadline < 7) {
      return 0.6; // Moderate
    }

    if (daysUntilDeadline < 14) {
      return 0.8; // Good
    }

    return 1.0; // Plenty of time
  }

  /**
   * Calculate client quality score (0.0 - 1.0)
   */
  private calculateClientQuality(project: ProjectCandidate): number {
    if (!project.client) {
      return 0.3;
    }

    const client = project.client;
    let score = 0.0;

    // Rating score (0 - 1)
    if (client.rating !== undefined && client.rating !== null) {
      const ratingScore = client.rating / 5.0;
      score += ratingScore * 0.4;
    } else {
      score += 0.1;
    }

    // Verification bonus
    if (client.verified) {
      score += 0.15;
    }

    // Total spent indicates experience
    if (client.total_spent !== undefined && client.total_spent !== null) {
      const spentScore = Math.log10(Math.max(client.total_spent, 1)) / 5;
      score += Math.min(0.3, spentScore * 0.3);
    }

    // Hire rate indicates reliability
    if (client.hire_rate !== undefined && client.hire_rate !== null) {
      score += (client.hire_rate / 100) * 0.15;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate competition score (0.0 - 1.0)
   * Higher score = less competition
   */
  private calculateCompetition(project: ProjectCandidate): number {
    const proposalCount = project.metadata?.proposal_count;

    if (proposalCount === undefined || proposalCount === null) {
      return 0.5;
    }

    if (proposalCount <= 5) return 1.0;
    if (proposalCount <= 10) return 0.8 - ((proposalCount - 5) / 5) * 0.3;
    if (proposalCount <= 20) return 0.5 - ((proposalCount - 10) / 10) * 0.3;
    if (proposalCount <= 50) return 0.2 - ((proposalCount - 20) / 30) * 0.2;

    return 0.0;
  }

  /**
   * Determine recommendation based on score
   */
  private determineRecommendation(score: number): "accept" | "consider" | "reject" {
    if (score >= RECOMMENDATION_THRESHOLDS.ACCEPT) {
      return "accept";
    }
    if (score >= RECOMMENDATION_THRESHOLDS.CONSIDER) {
      return "consider";
    }
    return "reject";
  }

  /**
   * Generate reasoning for the score
   */
  private generateReasoning(
    project: ProjectCandidate,
    result: ProjectScore
  ): string[] {
    const reasoning: string[] = [];

    // Skill match
    const matchedSkills = this.getMatchedSkills(project);
    if (matchedSkills.length > 0) {
      reasoning.push(
        `Matched ${matchedSkills.length} skills: ${matchedSkills.slice(0, 3).join(", ")}${
          matchedSkills.length > 3 ? "..." : ""
        }`
      );
    }

    // Budget
    if (project.budget_range?.max) {
      reasoning.push(`Budget: $${project.budget_range.max}`);
    }

    // Client
    if (project.client?.rating) {
      reasoning.push(`Client rating: ${project.client.rating}/5`);
    }

    // Competition
    if (project.metadata?.proposal_count) {
      reasoning.push(`Proposals: ${project.metadata.proposal_count}`);
    }

    return reasoning;
  }

  /**
   * Get matched skills list
   */
  private getMatchedSkills(project: ProjectCandidate): string[] {
    const matched: string[] = [];
    const projectSkills = new Set(
      project.skills_required.map((s) => s.toLowerCase())
    );
    const projectText = `${project.title} ${project.description}`.toLowerCase();

    for (const skill of Array.from(this.normalizedSkills)) {
      if (projectSkills.has(skill) || projectText.includes(skill)) {
        if (!matched.includes(skill)) {
          matched.push(skill);
        }
      }
    }

    return matched;
  }

  /**
   * Estimate project effort in hours
   */
  private estimateEffort(project: ProjectCandidate): number {
    if (!project.budget_range?.max) {
      return 20; // Default
    }

    let hours = project.budget_range.max / Math.max(this.config.hourly_rate_usd, 1);

    // Adjust based on complexity
    const complexity = project.metadata?.complexity;
    let complexityFactor = 1.0;

    if (complexity === "low") {
      complexityFactor = 0.7;
    } else if (complexity === "high") {
      complexityFactor = 1.5;
    }

    const estimated = hours * complexityFactor;

    return Math.max(2.0, Math.min(200.0, estimated));
  }

  /**
   * Get current configuration
   */
  getConfig(): ProjectFilterConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ProjectFilterConfig>): void {
    this.config = { ...this.config, ...updates };

    // Re-normalize skills if agent_skills changed
    if (updates.agent_skills) {
      this.normalizedSkills = this.normalizeSkills(this.config.agent_skills);
    }
  }
}
