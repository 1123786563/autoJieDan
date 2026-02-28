/**
 * Project Filter and Scoring Algorithm for Upwork Projects
 *
 * Implements multi-factor scoring for project evaluation:
 * - Skill match (40%)
 * - Budget range (25%)
 * - Client rating (15%)
 * - Project freshness (10%)
 * - Competition level (10%)
 */

export interface BudgetInfo {
  type: "fixed" | "hourly";
  min_amount?: number;
  max_amount?: number;
  currency: string;
}

export interface ClientInfo {
  id: string;
  name?: string;
  country?: string;
  rating?: number;
  reviews_count: number;
  verified: boolean;
  total_spent?: number;
  jobs_posted: number;
  hire_rate?: number;
}

export interface UpworkProject {
  id: string;
  title: string;
  description: string;
  budget?: BudgetInfo;
  skills: string[];
  category: string;
  subcategory: string;
  client?: ClientInfo;
  posted_at?: Date;
  url: string;
  source: "rss" | "api";
  job_type: string;
  proposal_count?: number; // Number of proposals already submitted
  interview_rate?: number; // Client's interview rate
}

export interface FilterCriteria {
  // Skill matching
  skill_keywords: string[];
  excluded_keywords: string[];
  preferred_categories: string[];

  // Budget constraints
  min_budget_usd: number;
  max_budget_usd: number;
  hourly_rate_usd: number;

  // Client requirements
  min_client_rating?: number;
  min_client_spent?: number;
  require_verified?: boolean;

  // Project constraints
  max_hours_estimate?: number;
  max_proposals?: number; // Skip projects with too many proposals
  max_project_age_hours?: number; // Skip old projects
}

export interface ProjectScore {
  project_id: string;
  total_score: number; // 0.0 - 1.0
  should_bid: boolean;
  factors: {
    skill_match: number; // 0.0 - 1.0
    budget_fit: number; // 0.0 - 1.0
    client_quality: number; // 0.0 - 1.0
    freshness: number; // 0.0 - 1.0
    competition: number; // 0.0 - 1.0
  };
  matched_skills: string[];
  excluded_reasons: string[];
  estimated_hours: number;
}

/**
 * ProjectFilter - Multi-factor project scoring and filtering
 */
export class ProjectFilter {
  private readonly SKILL_WEIGHT = 0.40;
  private readonly BUDGET_WEIGHT = 0.25;
  private readonly CLIENT_WEIGHT = 0.15;
  private readonly FRESHNESS_WEIGHT = 0.10;
  private readonly COMPETITION_WEIGHT = 0.10;

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

  private normalizedSkills: Set<string>;

  constructor(private criteria: FilterCriteria) {
    this.normalizedSkills = this.normalizeSkills(criteria.skill_keywords);
  }

  /**
   * Calculate comprehensive score for a single project
   */
  calculateScore(project: UpworkProject): ProjectScore {
    const score: ProjectScore = {
      project_id: project.id,
      total_score: 0,
      should_bid: false,
      factors: {
        skill_match: 0,
        budget_fit: 0,
        client_quality: 0,
        freshness: 0,
        competition: 0,
      },
      matched_skills: [],
      excluded_reasons: [],
      estimated_hours: this.estimateEffort(project),
    };

    // Check exclusion criteria first
    const excluded = this.checkExclusions(project);
    if (excluded.length > 0) {
      score.excluded_reasons = excluded;
      return score;
    }

    // Calculate individual factors
    score.factors.skill_match = this.calculateSkillMatch(project);
    score.matched_skills = this.getMatchedSkills(project);

    score.factors.budget_fit = this.calculateBudgetFit(project);
    score.factors.client_quality = this.calculateClientQuality(project);
    score.factors.freshness = this.calculateFreshness(project);
    score.factors.competition = this.calculateCompetition(project);

    // Calculate weighted total
    score.total_score =
      score.factors.skill_match * this.SKILL_WEIGHT +
      score.factors.budget_fit * this.BUDGET_WEIGHT +
      score.factors.client_quality * this.CLIENT_WEIGHT +
      score.factors.freshness * this.FRESHNESS_WEIGHT +
      score.factors.competition * this.COMPETITION_WEIGHT;

    // Determine if should bid
    score.should_bid = this.shouldBid(project, score);

    return score;
  }

  /**
   * Filter projects based on criteria
   */
  filterProjects(projects: UpworkProject[]): UpworkProject[] {
    return projects.filter((project) => {
      const score = this.calculateScore(project);
      return score.should_bid;
    });
  }

  /**
   * Rank projects by score (highest first)
   */
  rankProjects(projects: UpworkProject[]): UpworkProject[] {
    const scored = projects.map((project) => ({
      project,
      score: this.calculateScore(project),
    }));

    scored.sort((a, b) => b.score.total_score - a.score.total_score);

    return scored.map((s) => s.project);
  }

  /**
   * Get top N projects with their scores
   */
  getTopProjects(projects: UpworkProject[], n: number): Array<{ project: UpworkProject; score: ProjectScore }> {
    const scored = projects.map((project) => ({
      project,
      score: this.calculateScore(project),
    }));

    scored.sort((a, b) => b.score.total_score - a.score.total_score);

    return scored.slice(0, n);
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
   * Check if project should be excluded
   */
  private checkExclusions(project: UpworkProject): string[] {
    const reasons: string[] = [];
    const projectText = `${project.title} ${project.description}`.toLowerCase();

    // Check excluded keywords
    for (const excluded of this.criteria.excluded_keywords) {
      if (projectText.includes(excluded.toLowerCase())) {
        reasons.push(`Excluded keyword: ${excluded}`);
      }
    }

    // Check budget constraints
    if (project.budget?.max_amount) {
      if (project.budget.max_amount < this.criteria.min_budget_usd) {
        reasons.push(
          `Budget too low: $${project.budget.max_amount} < $${this.criteria.min_budget_usd}`
        );
      }
      if (project.budget.max_amount > this.criteria.max_budget_usd) {
        reasons.push(
          `Budget too high: $${project.budget.max_amount} > $${this.criteria.max_budget_usd}`
        );
      }
    }

    // Check project age
    if (this.criteria.max_project_age_hours && project.posted_at) {
      const ageHours = (Date.now() - project.posted_at.getTime()) / (1000 * 60 * 60);
      if (ageHours > this.criteria.max_project_age_hours) {
        reasons.push(`Project too old: ${Math.round(ageHours)}h`);
      }
    }

    // Check proposal count
    if (this.criteria.max_proposals && project.proposal_count) {
      if (project.proposal_count > this.criteria.max_proposals) {
        reasons.push(
          `Too many proposals: ${project.proposal_count} > ${this.criteria.max_proposals}`
        );
      }
    }

    // Check hours estimate
    if (this.criteria.max_hours_estimate) {
      const estimated = this.estimateEffort(project);
      if (estimated > this.criteria.max_hours_estimate) {
        reasons.push(`Project too large: ${estimated}h`);
      }
    }

    return reasons;
  }

  /**
   * Calculate skill match score (0.0 - 1.0)
   */
  private calculateSkillMatch(project: UpworkProject): number {
    if (this.normalizedSkills.size === 0) {
      return 0.5; // Neutral if no skills configured
    }

    const projectSkills = new Set(project.skills.map((s) => s.toLowerCase()));
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

    // Score based on match ratio
    const matchRatio = matchedCount / this.normalizedSkills.size;

    // Also consider coverage of project's required skills
    let skillCoverage = 0.5;
    if (project.skills.length > 0) {
      skillCoverage = matchedCount / Math.max(project.skills.length, 1);
    }

    // Combine: 60% match ratio, 40% coverage
    return Math.min(1.0, matchRatio * 0.6 + skillCoverage * 0.4);
  }

  /**
   * Get list of matched skills
   */
  private getMatchedSkills(project: UpworkProject): string[] {
    const matched: string[] = [];
    const projectSkills = new Set(project.skills.map((s) => s.toLowerCase()));
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
   * Calculate budget fit score (0.0 - 1.0)
   */
  private calculateBudgetFit(project: UpworkProject): number {
    if (!project.budget) {
      return 0.5; // Neutral if no budget info
    }

    const { min_amount, max_amount } = project.budget;

    if (!max_amount) {
      return 0.5;
    }

    // Check if budget is in acceptable range
    if (max_amount < this.criteria.min_budget_usd) {
      return 0.0;
    }

    if (max_amount > this.criteria.max_budget_usd) {
      return 0.3; // Still consider but lower score
    }

    // Calculate ideal fit: prefer budgets in the middle of our range
    const ourRange = this.criteria.max_budget_usd - this.criteria.min_budget_usd;
    const midpoint = this.criteria.min_budget_usd + ourRange / 2;

    const distance = Math.abs(max_amount - midpoint);
    const fitScore = Math.max(0, 1 - distance / ourRange);

    return fitScore;
  }

  /**
   * Calculate client quality score (0.0 - 1.0)
   */
  private calculateClientQuality(project: UpworkProject): number {
    if (!project.client) {
      return 0.3; // Lower score for unknown clients
    }

    const client = project.client;
    let score = 0.0;

    // Rating score (0 - 1)
    if (client.rating !== undefined && client.rating !== null) {
      // Normalize 5-star scale to 0-1
      const ratingScore = client.rating / 5.0;

      // Apply minimum rating threshold
      if (this.criteria.min_client_rating && client.rating < this.criteria.min_client_rating) {
        return 0.0;
      }

      score += ratingScore * 0.4;
    } else {
      score += 0.1; // Low score for unrated clients
    }

    // Verification bonus
    if (client.verified) {
      score += 0.15;
    }
    if (this.criteria.require_verified && !client.verified) {
      return 0.0;
    }

    // Total spent indicates experience
    if (client.total_spent !== undefined && client.total_spent !== null) {
      if (this.criteria.min_client_spent && client.total_spent < this.criteria.min_client_spent) {
        return 0.0;
      }

      // Logarithmic scale: $100 = 0.1, $10k = 0.3, $100k = 0.5
      const spentScore = Math.log10(Math.max(client.total_spent, 1)) / 5;
      score += Math.min(0.3, spentScore * 0.3);
    }

    // Hire rate indicates reliability
    if (client.hire_rate !== undefined && client.hire_rate !== null) {
      score += (client.hire_rate / 100) * 0.15;
    }

    // Jobs posted indicates experience
    if (client.jobs_posted > 0) {
      const jobsScore = Math.min(0.2, Math.log10(client.jobs_posted + 1) / 3);
      score += jobsScore;
    }

    return Math.min(1.0, score);
  }

  /**
   * Calculate project freshness score (0.0 - 1.0)
   */
  private calculateFreshness(project: UpworkProject): number {
    if (!project.posted_at) {
      return 0.5; // Neutral if no date
    }

    const now = Date.now();
    const posted = project.posted_at.getTime();
    const ageHours = (now - posted) / (1000 * 60 * 60);

    // Fresher is better
    // < 1 hour = 1.0
    // 1 hour = 0.9
    // 6 hours = 0.7
    // 24 hours = 0.5
    // 72 hours = 0.2
    // > 72 hours = 0.1

    if (ageHours < 1) return 1.0;
    if (ageHours < 6) return 0.9 - (ageHours - 1) * 0.05;
    if (ageHours < 24) return 0.7 - (ageHours - 6) * 0.02;
    if (ageHours < 72) return 0.5 - (ageHours - 24) * 0.01;

    return 0.1;
  }

  /**
   * Calculate competition score (0.0 - 1.0)
   * Higher score = less competition
   */
  private calculateCompetition(project: UpworkProject): number {
    if (project.proposal_count === undefined || project.proposal_count === null) {
      return 0.5; // Neutral if no data
    }

    // Fewer proposals is better
    // 0-5 proposals = 1.0
    // 5-10 proposals = 0.8
    // 10-20 proposals = 0.5
    // 20-50 proposals = 0.2
    // > 50 proposals = 0.0

    const count = project.proposal_count;

    if (count <= 5) return 1.0;
    if (count <= 10) return 0.8 - ((count - 5) / 5) * 0.3;
    if (count <= 20) return 0.5 - ((count - 10) / 10) * 0.3;
    if (count <= 50) return 0.2 - ((count - 20) / 30) * 0.2;

    return 0.0;
  }

  /**
   * Determine if we should bid on this project
   */
  private shouldBid(project: UpworkProject, score: ProjectScore): boolean {
    // Must not be excluded
    if (score.excluded_reasons.length > 0) {
      return false;
    }

    // Minimum score threshold
    const MIN_SCORE_THRESHOLD = 0.35;
    if (score.total_score < MIN_SCORE_THRESHOLD) {
      return false;
    }

    // Must have at least some skill match
    if (score.factors.skill_match < 0.2) {
      return false;
    }

    // If categories specified, should match at least one
    if (
      this.criteria.preferred_categories.length > 0 &&
      !this.matchesCategory(project)
    ) {
      return false;
    }

    return true;
  }

  /**
   * Check if project matches preferred categories
   */
  private matchesCategory(project: UpworkProject): boolean {
    if (this.criteria.preferred_categories.length === 0) {
      return true;
    }

    const projectCategory = project.category.toLowerCase();
    const projectSubcategory = project.subcategory.toLowerCase();

    for (const cat of this.criteria.preferred_categories) {
      const catLower = cat.toLowerCase();
      if (
        projectCategory.includes(catLower) ||
        projectSubcategory.includes(catLower) ||
        catLower.includes(projectCategory)
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Estimate project effort in hours
   */
  estimateEffort(project: UpworkProject): number {
    let hours = 20; // Default

    // Budget-based estimate
    if (project.budget?.max_amount) {
      hours = project.budget.max_amount / Math.max(this.criteria.hourly_rate_usd, 1);
    }

    // Adjust based on description length
    const descLength = project.description.length;
    let complexityFactor = 1.0;

    if (descLength > 2000) {
      complexityFactor = 1.5;
    } else if (descLength > 1000) {
      complexityFactor = 1.2;
    } else if (descLength < 300) {
      complexityFactor = 0.7;
    }

    // Adjust based on skills count (more skills = more complex)
    if (project.skills.length > 8) {
      complexityFactor *= 1.4;
    } else if (project.skills.length > 5) {
      complexityFactor *= 1.2;
    }

    const estimated = hours * complexityFactor;

    // Clamp between 2-200 hours
    return Math.max(2.0, Math.min(200.0, estimated));
  }
}

/**
 * Default filter criteria
 */
export const DEFAULT_FILTER_CRITERIA: FilterCriteria = {
  skill_keywords: [
    "typescript",
    "javascript",
    "python",
    "go",
    "react",
    "node.js",
    "api",
    "graphql",
  ],
  excluded_keywords: [
    "urgent",
    "asap",
    "immediately",
    "emergency",
  ],
  preferred_categories: [
    "web development",
    "api development",
    "backend",
  ],
  min_budget_usd: 100,
  max_budget_usd: 5000,
  hourly_rate_usd: 50,
  min_client_rating: 4.0,
  min_client_spent: 100,
  require_verified: false,
  max_hours_estimate: 100,
  max_proposals: 30,
  max_project_age_hours: 48,
};
