/**
 * Bid Generator for Upwork Projects
 *
 * Automatically generates bid proposals based on project information and scores.
 * Supports personalization based on client history and project characteristics.
 */

import type { ProjectCandidate, ProjectScore } from "./project-filter.js";

/**
 * Client history for personalization
 */
export interface ClientHistory {
  client_id: string;
  past_projects?: number;
  total_spent?: number;
  average_rating_given?: number;
  communication_style?: "formal" | "casual" | "direct";
  previous_interactions?: Array<{
    project_id: string;
    outcome: "hired" | "not_hired";
    feedback?: string;
  }>;
}

/**
 * Milestone for project delivery
 */
export interface Milestone {
  id: string;
  title: string;
  description: string;
  deliverables: string[];
  estimated_hours: number;
  percentage: number; // Percentage of total payment
}

/**
 * Bid proposal
 */
export interface BidProposal {
  project_id: string;
  cover_letter: string;
  bid_amount: number;
  duration_days: number;
  milestone_plan?: Milestone[];
  attachment_urls?: string[];
  questions?: string[];
  generated_at: string;
  strategy: string; // "competitive", "premium", "budget"
  confidence: number; // 0.0 - 1.0
}

/**
 * Bid generator configuration
 */
export interface BidGeneratorConfig {
  // Agent profile
  agent_name: string;
  agent_title: string;
  agent_bio: string;
  hourly_rate_usd: number;
  years_experience: number;

  // Portfolio and expertise
  portfolio_urls: string[];
  expertise_areas: string[];

  // Bidding strategy
  default_strategy: "competitive" | "premium" | "budget";
  min_bid_acceptable: number;
  max_bid_acceptable: number;

  // Personalization
  use_personalization: boolean;
  include_milestones: boolean;
  include_questions: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_BID_CONFIG: BidGeneratorConfig = {
  agent_name: "Automaton AI",
  agent_title: "Full Stack Developer & AI Specialist",
  agent_bio: "Experienced developer specializing in TypeScript, Python, and AI integration.",
  hourly_rate_usd: 50,
  years_experience: 5,
  portfolio_urls: [],
  expertise_areas: ["TypeScript", "Python", "React", "Node.js", "API Design"],
  default_strategy: "competitive",
  min_bid_acceptable: 100,
  max_bid_acceptable: 10000,
  use_personalization: true,
  include_milestones: true,
  include_questions: true,
};

/**
 * IBidGenerator interface
 */
export interface IBidGenerator {
  generate(
    project: ProjectCandidate,
    score: ProjectScore
  ): Promise<BidProposal>;
  personalize(
    proposal: BidProposal,
    clientHistory?: ClientHistory
  ): BidProposal;
}

/**
 * Bid Generator implementation
 */
export class BidGenerator implements IBidGenerator {
  private config: BidGeneratorConfig;

  constructor(config?: Partial<BidGeneratorConfig>) {
    this.config = { ...DEFAULT_BID_CONFIG, ...config };
  }

  /**
   * Generate a bid proposal for a project
   */
  async generate(
    project: ProjectCandidate,
    score: ProjectScore
  ): Promise<BidProposal> {
    // Determine bidding strategy
    const strategy = this.determineStrategy(project, score);

    // Calculate bid amount
    const bidAmount = this.calculateBidAmount(project, score, strategy);

    // Estimate duration
    const durationDays = this.estimateDuration(project, score);

    // Generate cover letter
    const coverLetter = this.generateCoverLetter(project, score, strategy);

    // Generate milestone plan if enabled
    const milestonePlan = this.config.include_milestones
      ? this.generateMilestonePlan(project, score)
      : undefined;

    // Generate clarifying questions if enabled
    const questions = this.config.include_questions
      ? this.generateQuestions(project, score)
      : undefined;

    // Calculate confidence
    const confidence = this.calculateConfidence(project, score);

    return {
      project_id: project.id,
      cover_letter: coverLetter,
      bid_amount: bidAmount,
      duration_days: durationDays,
      milestone_plan: milestonePlan,
      questions: questions,
      attachment_urls: this.config.portfolio_urls,
      generated_at: new Date().toISOString(),
      strategy: strategy,
      confidence: confidence,
    };
  }

  /**
   * Personalize a proposal based on client history
   */
  personalize(proposal: BidProposal, clientHistory?: ClientHistory): BidProposal {
    if (!clientHistory || !this.config.use_personalization) {
      return proposal;
    }

    let personalizedLetter = proposal.cover_letter;

    // Adjust tone based on communication style
    if (clientHistory.communication_style === "formal") {
      personalizedLetter = this.makeFormal(personalizedLetter);
    } else if (clientHistory.communication_style === "casual") {
      personalizedLetter = this.makeCasual(personalizedLetter);
    }

    // Add reference to past interactions
    if (clientHistory.previous_interactions && clientHistory.previous_interactions.length > 0) {
      const reference = this.generatePastInteractionReference(clientHistory);
      personalizedLetter = personalizedLetter + "\n\n" + reference;
    }

    // Adjust questions based on client history
    if (proposal.questions && clientHistory.past_projects && clientHistory.past_projects > 0) {
      proposal.questions = this.refineQuestionsForReturningClient(proposal.questions);
    }

    return {
      ...proposal,
      cover_letter: personalizedLetter,
    };
  }

  /**
   * Determine bidding strategy based on project and score
   */
  private determineStrategy(
    project: ProjectCandidate,
    score: ProjectScore
  ): "competitive" | "premium" | "budget" {
    // High score and low competition -> premium
    if (score.total_score >= 0.7 && score.factors.competition >= 0.7) {
      return "premium";
    }

    // High quality client -> premium
    if (
      score.factors.client_quality >= 0.8 &&
      score.total_score >= 0.6
    ) {
      return "premium";
    }

    // High competition -> competitive
    if (score.factors.competition < 0.4) {
      return "competitive";
    }

    // Default to configured strategy
    return this.config.default_strategy;
  }

  /**
   * Calculate bid amount based on project, score, and strategy
   */
  private calculateBidAmount(
    project: ProjectCandidate,
    score: ProjectScore,
    strategy: string
  ): number {
    let baseAmount = 0;

    // Start with project budget if available
    if (project.budget_range?.max) {
      baseAmount = project.budget_range.max;
    } else if (score.estimated_hours) {
      // Calculate from estimated hours
      baseAmount = score.estimated_hours * this.config.hourly_rate_usd;
    } else {
      // Default calculation
      baseAmount = 20 * this.config.hourly_rate_usd; // 20 hours default
    }

    // Apply strategy multiplier
    const strategyMultipliers = {
      premium: 0.85, // Aim for 85% of max budget
      competitive: 0.75, // More competitive
      budget: 0.65, // Budget-friendly
    };

    const multiplier = strategyMultipliers[strategy as keyof typeof strategyMultipliers] || 0.75;
    let adjustedAmount = baseAmount * multiplier;

    // Adjust based on skill match
    if (score.factors.skill_match > 0.8) {
      adjustedAmount *= 1.1; // 10% premium for high skill match
    } else if (score.factors.skill_match < 0.4) {
      adjustedAmount *= 0.9; // Discount for lower skill match
    }

    // Ensure within acceptable range
    adjustedAmount = Math.max(
      this.config.min_bid_acceptable,
      Math.min(this.config.max_bid_acceptable, adjustedAmount)
    );

    // Round to nearest 10
    return Math.round(adjustedAmount / 10) * 10;
  }

  /**
   * Estimate project duration in days
   */
  private estimateDuration(
    project: ProjectCandidate,
    score: ProjectScore
  ): number {
    if (score.estimated_hours) {
      // Assume 6 productive hours per day
      const days = Math.ceil(score.estimated_hours / 6);
      return Math.max(1, Math.min(90, days));
    }

    // Default estimation based on complexity
    const complexity = project.metadata?.complexity;
    if (complexity === "low") return 3;
    if (complexity === "high") return 14;

    return 7; // Default for medium
  }

  /**
   * Generate cover letter
   */
  private generateCoverLetter(
    project: ProjectCandidate,
    score: ProjectScore,
    strategy: string
  ): string {
    const greeting = this.selectGreeting(project);
    const opening = this.generateOpening(project, score);
    const expertise = this.generateExpertiseSection(project, score);
    const approach = this.generateApproachSection(project);
    const closing = this.generateClosing(project, strategy);

    return `${greeting}\n\n${opening}\n\n${expertise}\n\n${approach}\n\n${closing}`;
  }

  /**
   * Select appropriate greeting
   */
  private selectGreeting(project: ProjectCandidate): string {
    const clientName = project.client?.id ? `Hi there` : "Hello";

    if (project.metadata?.category === "web development") {
      return `${clientName},`;
    }

    return `Dear Client,`;
  }

  /**
   * Generate opening paragraph
   */
  private generateOpening(project: ProjectCandidate, score: ProjectScore): string {
    const matchedSkills = (score.matched_skills || project.skills_required).slice(0, 3);
    const skills = matchedSkills.join(", ");

    const openings = [
      `I read your project for "${project.title}" and I'm excited to submit a proposal. With my expertise in ${skills}, I'm confident I can deliver the results you're looking for.`,
      `Thank you for posting this project. I've reviewed your requirements for ${project.skills_required.slice(0, 2).join(" and ")}, and I believe my skills and experience make me an ideal candidate.`,
      `I'm writing to express my strong interest in your project. With ${this.config.years_experience} years of experience and expertise in ${skills}, I'm well-equipped to help you achieve your goals.`,
    ];

    // Select opening based on score
    const index = score.total_score > 0.7 ? 0 : score.total_score > 0.4 ? 1 : 2;
    return openings[index];
  }

  /**
   * Generate expertise section
   */
  private generateExpertiseSection(project: ProjectCandidate, score: ProjectScore): string {
    const relevantSkills = (score.matched_skills || project.skills_required).slice(0, 4);
    const skillsList = relevantSkills.map((s) => `• ${s}`).join("\n");

    return `**Why I'm a Great Fit**\n\nI have extensive experience with:\n${skillsList}\n\n${
      relevantSkills.length > 2
        ? `My strong background in ${relevantSkills.slice(0, 2).join(" and ")} ensures I can handle your project efficiently and deliver high-quality results.`
        : "I'm ready to put my skills to work on your project."
    }`;
  }

  /**
   * Generate approach section
   */
  private generateApproachSection(project: ProjectCandidate): string {
    const complexity = project.metadata?.complexity || "medium";

    const approaches: Record<string, string> = {
      low: "For this project, I'll follow a streamlined approach: quick requirements clarification, efficient implementation, and thorough testing to ensure everything works perfectly.",
      medium: "My approach includes: 1) Detailed requirements analysis, 2) Iterative development with regular updates, 3) Comprehensive testing and quality assurance, 4) Final delivery with documentation.",
      high: "Given the complexity of this project, I'll employ a structured methodology: detailed planning, phased development, regular milestone reviews, and rigorous testing at each stage to ensure success.",
    };

    return `**My Approach**\n\n${approaches[complexity]}`;
  }

  /**
   * Generate closing paragraph
   */
  private generateClosing(project: ProjectCandidate, strategy: string): string {
    const availability = this.generateAvailabilityStatement();

    const closings: Record<string, string> = {
      premium: `I'm excited about the opportunity to work on this project and deliver exceptional results. Let's discuss how I can contribute to your success.\n\n${availability}\n\nBest regards,`,
      competitive: `I'm ready to start immediately and committed to delivering quality work on time. I'd love to discuss your project further.\n\n${availability}\n\nBest regards,`,
      budget: `I offer competitive rates without compromising on quality. I'm confident you'll be satisfied with my work.\n\n${availability}\n\nBest regards,`,
    };

    return `${closings[strategy]}\n\n${this.config.agent_name}\n${this.config.agent_title}`;
  }

  /**
   * Generate availability statement
   */
  private generateAvailabilityStatement(): string {
    return "I'm available to start immediately and can dedicate full-time attention to your project.";
  }

  /**
   * Generate milestone plan
   */
  private generateMilestonePlan(
    project: ProjectCandidate,
    score: ProjectScore
  ): Milestone[] {
    const totalHours = score.estimated_hours || 20;
    const complexity = project.metadata?.complexity || "medium";

    const plans: Record<string, Milestone[]> = {
      low: [
        {
          id: "1",
          title: "Requirements & Planning",
          description: "Understand requirements and create implementation plan",
          deliverables: "Project plan, technical approach",
          estimated_hours: totalHours * 0.1,
          percentage: 10,
        },
        {
          id: "2",
          title: "Implementation",
          description: "Core development and implementation",
          deliverables: "Working solution",
          estimated_hours: totalHours * 0.7,
          percentage: 70,
        },
        {
          id: "3",
          title: "Testing & Delivery",
          description: "Testing, bug fixes, and final delivery",
          deliverables: "Tested solution, documentation",
          estimated_hours: totalHours * 0.2,
          percentage: 20,
        },
      ],
      medium: [
        {
          id: "1",
          title: "Discovery & Planning",
          description: "Detailed requirements analysis and project planning",
          deliverables: "Requirements document, project plan, architecture",
          estimated_hours: totalHours * 0.15,
          percentage: 15,
        },
        {
          id: "2",
          title: "Core Development",
          description: "Implementation of core features and functionality",
          deliverables: "Core features implemented",
          estimated_hours: totalHours * 0.5,
          percentage: 50,
        },
        {
          id: "3",
          title: "Refinement & Integration",
          description: "Feature refinement and system integration",
          deliverables: "Integrated system",
          estimated_hours: totalHours * 0.25,
          percentage: 25,
        },
        {
          id: "4",
          title: "Testing & Deployment",
          description: "Comprehensive testing and deployment",
          deliverables: "Tested and deployed solution, documentation",
          estimated_hours: totalHours * 0.1,
          percentage: 10,
        },
      ],
      high: [
        {
          id: "1",
          title: "Requirement Analysis",
          description: "Comprehensive requirements gathering and analysis",
          deliverables: "Detailed requirements specification",
          estimated_hours: totalHours * 0.1,
          percentage: 10,
        },
        {
          id: "2",
          title: "Architecture Design",
          description: "System architecture and technical design",
          deliverables: "Architecture document, technical specifications",
          estimated_hours: totalHours * 0.15,
          percentage: 15,
        },
        {
          id: "3",
          title: "Phase 1 Development",
          description: "Implementation of foundation and core modules",
          deliverables: "Core modules completed",
          estimated_hours: totalHours * 0.3,
          percentage: 30,
        },
        {
          id: "4",
          title: "Phase 2 Development",
          description: "Implementation of advanced features and integration",
          deliverables: "Full feature implementation",
          estimated_hours: totalHours * 0.25,
          percentage: 25,
        },
        {
          id: "5",
          title: "Testing & QA",
          description: "Comprehensive testing, bug fixes, and quality assurance",
          deliverables: "Tested system, QA report",
          estimated_hours: totalHours * 0.15,
          percentage: 15,
        },
        {
          id: "6",
          title: "Deployment & Documentation",
          description: "Final deployment and documentation",
          deliverables: "Deployed solution, complete documentation",
          estimated_hours: totalHours * 0.05,
          percentage: 5,
        },
      ],
    };

    return plans[complexity] || plans.medium;
  }

  /**
   * Generate clarifying questions
   */
  private generateQuestions(project: ProjectCandidate, score: ProjectScore): string[] {
    const questions: string[] = [];

    // Time-related questions
    if (!project.deadline) {
      questions.push("What is your expected timeline for this project?");
    }

    // Budget-related questions
    if (!project.budget_range?.min && project.budget_range?.max) {
      questions.push("Do you have a specific budget range in mind?");
    }

    // Design/assets questions
    if (project.metadata?.category === "web development") {
      questions.push("Do you have design mockups, or should design be included?");
    }

    // Access/credentials questions
    questions.push("Will you provide necessary access credentials and assets?");

    // Communication preference
    questions.push("What is your preferred communication method and frequency?");

    // Project-specific question
    if (project.description.length < 100) {
      questions.push("Could you provide more details about the specific requirements?");
    }

    return questions.slice(0, 5); // Max 5 questions
  }

  /**
   * Calculate confidence in the bid
   */
  private calculateConfidence(project: ProjectCandidate, score: ProjectScore): number {
    let confidence = 0.5;

    // Skill match contributes significantly
    confidence += score.factors.skill_match * 0.3;

    // Client quality increases confidence
    confidence += score.factors.client_quality * 0.2;

    // Lower competition increases confidence
    confidence += score.factors.competition * 0.1;

    // Budget fit increases confidence
    confidence += score.factors.budget_fit * 0.1;

    return Math.min(1.0, Math.max(0.1, confidence));
  }

  /**
   * Make proposal tone more formal
   */
  private makeFormal(text: string): string {
    return text
      .replace(/I'm/g, "I am")
      .replace(/Hi there/g, "Dear Client")
      .replace(/Let's/g, "Let us")
      .replace(/you're/g, "you are");
  }

  /**
   * Make proposal tone more casual
   */
  private makeCasual(text: string): string {
    return text
      .replace(/I am/g, "I'm")
      .replace(/Dear Client/g, "Hi there")
      .replace(/would be/g, "would be")
      .replace(/I believe/g, "I think");
  }

  /**
   * Generate reference to past interactions
   */
  private generatePastInteractionReference(history: ClientHistory): string {
    if (!history.previous_interactions || history.previous_interactions.length === 0) {
      return "";
    }

    const lastInteraction = history.previous_interactions[history.previous_interactions.length - 1];

    if (lastInteraction.outcome === "hired") {
      return `I enjoyed working with you on our previous project and look forward to collaborating again!`;
    }

    return `I noticed we've interacted before. While we didn't work together last time, I hope to have the opportunity to collaborate on this project.`;
  }

  /**
   * Refine questions for returning clients
   */
  private refineQuestionsForReturningClient(questions: string[]): string[] {
    // Remove questions that would already be known
    const filtered = questions.filter((q) =>
      !q.toLowerCase().includes("timeline") &&
      !q.toLowerCase().includes("communication")
    );
    // Ensure at least one question remains
    return filtered.length > 0 ? filtered : questions.slice(0, 1);
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<BidGeneratorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): BidGeneratorConfig {
    return { ...this.config };
  }
}
