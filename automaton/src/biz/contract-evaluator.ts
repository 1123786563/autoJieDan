/**
 * Contract Evaluator for Upwork Projects
 *
 * Analyzes contract terms and conditions to identify risks,
 * flag unreasonable clauses, and provide modification suggestions.
 */

/**
 * Contract clause types
 */
export enum ClauseType {
  PAYMENT = "payment",
  INTELLECTUAL_PROPERTY = "intellectual_property",
  LIABILITY = "liability",
  TERMINATION = "termination",
  CONFIDENTIALITY = "confidentiality",
  DELIVERABLES = "deliverables",
  TIMELINE = "timeline",
  EXCLUSIVITY = "exclusivity",
  OTHER = "other",
}

/**
 * Risk levels
 */
export enum RiskLevel {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Contract clause representation
 */
export interface ContractClause {
  id: string;
  type: ClauseType;
  text: string;
  risk_level: RiskLevel;
  issues: string[];
  suggestions: string[];
}

/**
 * Contract evaluation result
 */
export interface ContractEvaluation {
  contract_id: string;
  overall_risk: RiskLevel;
  risk_score: number; // 0.0 - 1.0
  clauses: ContractClause[];
  summary: string;
  recommendations: string[];
  deal_breakers: string[];
  should_accept: boolean;
  evaluated_at: string;
}

/**
 * Contract text for evaluation
 */
export interface ContractText {
  id: string;
  title?: string;
  content: string;
  project_type?: string;
  estimated_value?: number;
  duration_weeks?: number;
}

/**
 * Contract evaluator configuration
 */
export interface ContractEvaluatorConfig {
  // Risk thresholds
  acceptable_risk_score: number; // Maximum acceptable risk score
  strict_mode: boolean; // If true, be more conservative

  // Payment terms thresholds
  max_payment_days: number; // Maximum days for payment
  min_deposit_percentage: number; // Minimum deposit for fixed-price
  max_retainer_percentage: number; // Maximum retainer holdback

  // IP protection
  require_ip_clause: boolean;
  allow_transfer_of_ownership: boolean;

  // Liability
  max_liability_multiplier: number; // Max liability as multiple of contract value

  // Termination
  min_termination_notice_days: number;
  allow_immediate_termination: boolean;

  // Exclusivity
  allow_exclusivity: boolean;
  max_exclusivity_months: number;
}

/**
 * Default configuration
 */
export const DEFAULT_EVALUATOR_CONFIG: ContractEvaluatorConfig = {
  acceptable_risk_score: 0.4,
  strict_mode: false,
  max_payment_days: 30,
  min_deposit_percentage: 25,
  max_retainer_percentage: 20,
  require_ip_clause: true,
  allow_transfer_of_ownership: false,
  max_liability_multiplier: 1.5,
  min_termination_notice_days: 7,
  allow_immediate_termination: false,
  allow_exclusivity: false,
  max_exclusivity_months: 3,
};

/**
 * Common risky contract patterns
 */
const RISKY_PATTERNS = {
  payment: [
    {
      pattern: /payment.*within?\s*(\d+)\s*days/i,
      threshold: 45,
      risk: "Payment terms exceed 45 days",
    },
    {
      pattern: /deposit.*less than\s*(\d+)%/i,
      threshold: 20,
      risk: "Deposit is less than 20%",
    },
    {
      pattern: /no\s*deposit/i,
      risk: "No deposit required",
    },
    {
      pattern: /payment\s*upon\s*completion/i,
      risk: "Full payment only upon completion - no milestone payments",
    },
    {
      pattern: /60\s+days.*payment/i,
      risk: "Payment terms: 60 days",
    },
    {
      pattern: /90\s+days.*payment/i,
      risk: "Payment terms: 90 days",
    },
  ],
  intellectual_property: [
    {
      pattern: /transfer\s*(of)?\s*all?\s*rights/i,
      risk: "Transfer of all IP rights requested",
    },
    {
      pattern: /work\s*for\s*hire/i,
      risk: "Work for hire clause - full IP transfer",
    },
    {
      pattern: /irrevocable.*transfer/i,
      risk: "Irrevocable transfer of rights",
    },
    {
      pattern: /unlimited.*license/i,
      risk: "Unlimited license grant",
    },
    {
      pattern: /all\s+IP\s+rights\s+transferred/i,
      risk: "All IP rights transferred to client",
    },
    {
      pattern: /client\s+shall\s+own\s+all\s+rights/i,
      risk: "Client owns all rights to work",
    },
  ],
  liability: [
    {
      pattern: /unlimited\s*liability/i,
      risk: "Unlimited liability clause",
    },
    {
      pattern: /liability.*exceeds?\s*(\d+)%?\s*of\s*(contract|project|agreement)\s*value/i,
      risk: "Liability exceeds contract value",
    },
    {
      pattern: /indemnif(y|ication).*all?\s*claims/i,
      risk: "Broad indemnification for all claims",
    },
    {
      pattern: /personal\s*guarantee/i,
      risk: "Personal guarantee required",
    },
    {
      pattern: /guarantee\s+against\s+all\s+losses/i,
      risk: "Guarantee against all losses",
    },
  ],
  termination: [
    {
      pattern: /immediate\s*termination.*without\s*cause/i,
      risk: "Client can terminate immediately without cause",
    },
    {
      pattern: /termination\s*fee.*\$?(\d+)/i,
      threshold: 500,
      risk: "Early termination fee applies",
    },
    {
      pattern: /no\s*termination\s*for\s*convenience/i,
      risk: "No right to terminate for convenience",
    },
    {
      pattern: /notice.*less than\s*(\d+)\s*days/i,
      threshold: 7,
      risk: "Insufficient termination notice period",
    },
    {
      pattern: /\$500\s+termination\s+fee/i,
      risk: "Early termination fee: $500",
    },
  ],
  confidentiality: [
    {
      pattern: /confidential.*(?:indefinitely|perpetual|permanent)/i,
      risk: "Confidentiality obligation is perpetual",
    },
    {
      pattern: /return.*destroy.*all?\s*materials/i,
      risk: "Must return or destroy all work materials",
    },
    {
      pattern: /source\s*code.*confidential/i,
      risk: "Source code marked as confidential - limits reuse",
    },
    {
      pattern: /perpetual\s+confidentiality/i,
      risk: "Perpetual confidentiality obligation",
    },
  ],
  exclusivity: [
    {
      pattern: /exclusive.*relationship/i,
      risk: "Exclusivity requirement",
    },
    {
      pattern: /not\s*work.*with.*other\s*clients/i,
      risk: "Restriction on working with other clients",
    },
    {
      pattern: /non-compete/i,
      risk: "Non-compete clause present",
    },
    {
      pattern: /exclusive\s+relationship/i,
      risk: "Exclusive relationship required",
    },
  ],
  deliverables: [
    {
      pattern: /unlimited\s*revisions/i,
      risk: "Unlimited revisions requested",
    },
    {
      pattern: /revisions.*until\s*satisfied/i,
      risk: "Open-ended revisions until satisfaction",
    },
    {
      pattern: /no\s*limit.*changes/i,
      risk: "No limit on changes or scope creep",
    },
    {
      pattern: /unlimited\s+revisions/i,
      risk: "Unlimited revisions requested",
    },
  ],
  timeline: [
    {
      pattern: /penalty.*late.*delivery/i,
      risk: "Late delivery penalties apply",
    },
    {
      pattern: /deadline.*strict.*no\s*extension/i,
      risk: "Strict deadline with no extension possibility",
    },
    {
      pattern: /delivery.*(?:on|by)\s*weekends.*holidays/i,
      risk: "Required delivery on weekends/holidays",
    },
    {
      pattern: /\$100\s+per\s+day.*late/i,
      risk: "Late delivery penalty: $100 per day",
    },
  ],
};

/**
 * Contract Evaluator implementation
 */
export class ContractEvaluator {
  private config: ContractEvaluatorConfig;

  constructor(config?: Partial<ContractEvaluatorConfig>) {
    this.config = { ...DEFAULT_EVALUATOR_CONFIG, ...config };
  }

  /**
   * Evaluate a contract
   */
  evaluate(contract: ContractText): ContractEvaluation {
    const clauses: ContractClause[] = this.analyzeClauses(contract);
    const riskScore = this.calculateRiskScore(clauses, contract);
    const overallRisk = this.determineRiskLevel(riskScore);
    const summary = this.generateSummary(clauses, overallRisk);
    const recommendations = this.generateRecommendations(clauses);
    const dealBreakers = this.identifyDealBreakers(clauses);

    return {
      contract_id: contract.id,
      overall_risk: overallRisk,
      risk_score: riskScore,
      clauses: clauses,
      summary: summary,
      recommendations: recommendations,
      deal_breakers: dealBreakers,
      should_accept: this.shouldAcceptContract(riskScore, dealBreakers),
      evaluated_at: new Date().toISOString(),
    };
  }

  /**
   * Analyze contract and identify risky clauses
   */
  private analyzeClauses(contract: ContractText): ContractClause[] {
    const clauses: ContractClause[] = [];
    const content = contract.content.toLowerCase();

    // Check each clause type
    for (const [type, patterns] of Object.entries(RISKY_PATTERNS)) {
      const clauseType = type as ClauseType;

      for (const pattern of patterns) {
        const regex = new RegExp(pattern.pattern, 'gi');
        let match: RegExpExecArray | null;
        let matchCount = 0;

        while ((match = regex.exec(contract.content)) !== null) {
          matchCount++;

          const clause: ContractClause = {
            id: `${clauseType}-${matchCount}`,
            type: clauseType,
            text: match[0],
            risk_level: this.assessClauseRisk(pattern, match, contract),
            issues: [],
            suggestions: [],
          };

          // Add risk as issue
          clause.issues.push(pattern.risk);

          // Generate suggestions
          clause.suggestions = this.generateSuggestions(clause, contract);

          clauses.push(clause);
        }
      }
    }

    return clauses;
  }

  /**
   * Assess risk level for a specific clause
   */
  private assessClauseRisk(
    pattern: any,
    match: RegExpExecArray,
    contract: ContractText
  ): RiskLevel {
    // Check if pattern has a numeric threshold
    if (pattern.threshold !== undefined) {
      const numMatch = match[1]?.match(/\d+/);
      if (numMatch) {
        const value = parseInt(numMatch[0], 10);
        if (value > pattern.threshold) {
          return RiskLevel.HIGH;
        }
      }
    }

    // Critical patterns
    if (pattern.risk.toLowerCase().includes("unlimited") ||
        pattern.risk.toLowerCase().includes("personal guarantee")) {
      return RiskLevel.CRITICAL;
    }

    // High risk patterns
    if (pattern.risk.toLowerCase().includes("transfer") ||
        pattern.risk.toLowerCase().includes("work for hire") ||
        pattern.risk.toLowerCase().includes("no deposit")) {
      return RiskLevel.HIGH;
    }

    return RiskLevel.MEDIUM;
  }

  /**
   * Generate suggestions for a risky clause
   */
  private generateSuggestions(clause: ContractClause, contract: ContractText): string[] {
    const suggestions: string[] = [];

    switch (clause.type) {
      case ClauseType.PAYMENT:
        if (clause.issues.some((i) => i.includes("days"))) {
          suggestions.push("Request payment within 30 days of invoice");
          suggestions.push("Consider milestone-based payments for longer projects");
        }
        if (clause.issues.some((i) => i.includes("deposit"))) {
          suggestions.push(`Request at least ${this.config.min_deposit_percentage}% deposit`);
          suggestions.push("Structure payments: deposit, milestone, and completion");
        }
        break;

      case ClauseType.INTELLECTUAL_PROPERTY:
        suggestions.push("Negotiate license grant instead of full transfer");
        suggestions.push("Include clause allowing portfolio use of work");
        suggestions.push("Add exception for pre-existing IP and tools");
        break;

      case ClauseType.LIABILITY:
        if (clause.issues.some((i) => i.includes("unlimited"))) {
          suggestions.push(`Cap liability at ${this.config.max_liability_multiplier}x contract value`);
        }
        suggestions.push("Add mutual liability limitations");
        suggestions.push("Exclude consequential damages");
        break;

      case ClauseType.TERMINATION:
        if (clause.issues.some((i) => i.includes("immediate"))) {
          suggestions.push(`Require minimum ${this.config.min_termination_notice_days} days notice`);
        }
        suggestions.push("Include termination for convenience with notice");
        suggestions.push("Limit termination fees to actual costs incurred");
        break;

      case ClauseType.CONFIDENTIALITY:
        suggestions.push("Limit confidentiality to 2-3 years after termination");
        suggestions.push("Exclude information already known or independently developed");
        suggestions.push("Allow use of general knowledge and skills");
        break;

      case ClauseType.EXCLUSIVITY:
        suggestions.push("Decline exclusivity requirement");
        suggestions.push("If accepted, limit duration and compensate appropriately");
        suggestions.push("Define scope of exclusivity clearly");
        break;

      case ClauseType.DELIVERABLES:
        suggestions.push("Limit revisions to 2-3 rounds");
        suggestions.push("Define scope clearly with change order process");
        suggestions.push("Charge separately for out-of-scope changes");
        break;

      case ClauseType.TIMELINE:
        suggestions.push("Allow reasonable extensions for force majeure");
        suggestions.push("Define business days (excludes weekends/holidays)");
        suggestions.push("Include mutual agreement for deadline changes");
        break;
    }

    return suggestions;
  }

  /**
   * Calculate overall risk score
   */
  private calculateRiskScore(clauses: ContractClause[], contract: ContractText): number {
    if (clauses.length === 0) {
      return 0.0;
    }

    let totalRisk = 0.0;

    for (const clause of clauses) {
      let clauseRisk = 0.0;

      switch (clause.risk_level) {
        case RiskLevel.CRITICAL:
          clauseRisk = 0.4;
          break;
        case RiskLevel.HIGH:
          clauseRisk = 0.25;
          break;
        case RiskLevel.MEDIUM:
          clauseRisk = 0.15;
          break;
        case RiskLevel.LOW:
          clauseRisk = 0.05;
          break;
      }

      totalRisk += clauseRisk;
    }

    // Cap at 1.0
    return Math.min(1.0, totalRisk);
  }

  /**
   * Determine overall risk level from score
   */
  private determineRiskLevel(score: number): RiskLevel {
    if (score >= 0.6) {
      return RiskLevel.CRITICAL;
    }
    if (score >= 0.4) {
      return RiskLevel.HIGH;
    }
    if (score >= 0.2) {
      return RiskLevel.MEDIUM;
    }
    return RiskLevel.LOW;
  }

  /**
   * Generate evaluation summary
   */
  private generateSummary(clauses: ContractClause[], risk: RiskLevel): string {
    const criticalClauses = clauses.filter((c) => c.risk_level === RiskLevel.CRITICAL);
    const highClauses = clauses.filter((c) => c.risk_level === RiskLevel.HIGH);

    let summary = `Contract Risk Assessment: ${risk.toUpperCase()}\n\n`;

    summary += `Found ${clauses.length} potentially risky clause${clauses.length !== 1 ? 's' : ''}.\n`;

    if (criticalClauses.length > 0) {
      summary += `\n⚠️  ${criticalClauses.length} critical issue${criticalClauses.length !== 1 ? 's' : ''} found.\n`;
    }

    if (highClauses.length > 0) {
      summary += `\n⚠️  ${highClauses.length} high-risk issue${highClauses.length !== 1 ? 's' : ''} found.\n`;
    }

    // Group issues by type
    const issuesByType = new Map<ClauseType, ContractClause[]>();
    for (const clause of clauses) {
      if (!issuesByType.has(clause.type)) {
        issuesByType.set(clause.type, []);
      }
      issuesByType.get(clause.type)!.push(clause);
    }

    if (issuesByType.size > 0) {
      summary += "\nKey Concerns:\n";
      for (const [type, typeClauses] of issuesByType.entries()) {
        summary += `\n• ${type}: ${typeClauses.length} issue${typeClauses.length !== 1 ? 's' : ''}`;
      }
    }

    return summary;
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(clauses: ContractClause[]): string[] {
    const recommendations: string[] = [];

    // Check for missing important clauses
    const hasPaymentClauses = clauses.some((c) => c.type === ClauseType.PAYMENT);
    const hasIPClauses = clauses.some((c) => c.type === ClauseType.INTELLECTUAL_PROPERTY);
    const hasTerminationClauses = clauses.some((c) => c.type === ClauseType.TERMINATION);

    if (!hasPaymentClauses) {
      recommendations.push("Add clear payment terms with deposit and milestone payments");
    }

    if (this.config.require_ip_clause && !hasIPClauses) {
      recommendations.push("Include IP ownership and license provisions");
    }

    if (!hasTerminationClauses) {
      recommendations.push("Add termination clause with notice requirements");
    }

    // Add specific recommendations based on risky clauses
    const criticalClauses = clauses.filter((c) => c.risk_level === RiskLevel.CRITICAL);
    if (criticalClauses.length > 0) {
      recommendations.push("⚠️  Address all critical issues before accepting");
    }

    const exclusivityClauses = clauses.filter((c) => c.type === ClauseType.EXCLUSIVITY);
    if (exclusivityClauses.length > 0 && !this.config.allow_exclusivity) {
      recommendations.push("Remove or negotiate exclusivity requirements");
    }

    const liabilityClauses = clauses.filter((c) => c.type === ClauseType.LIABILITY && c.risk_level === RiskLevel.CRITICAL);
    if (liabilityClauses.length > 0) {
      recommendations.push("Limit liability exposure before signing");
    }

    if (this.config.strict_mode && clauses.length > 0) {
      recommendations.push("Consider having a legal professional review this contract");
    }

    return recommendations;
  }

  /**
   * Identify deal-breaker clauses
   */
  private identifyDealBreakers(clauses: ContractClause[]): string[] {
    const dealBreakers: string[] = [];

    for (const clause of clauses) {
      // Personal guarantee is always a deal-breaker
      if (clause.issues.some((i) => i.toLowerCase().includes("personal guarantee"))) {
        dealBreakers.push(`Personal guarantee required: "${clause.text}"`);
      }

      // Unlimited liability is a deal-breaker
      if (clause.issues.some((i) => i.toLowerCase().includes("unlimited liability"))) {
        dealBreakers.push(`Unlimited liability: "${clause.text}"`);
      }

      // Irrevocable IP transfer without consideration
      if (this.config.strict_mode &&
          clause.issues.some((i) => i.toLowerCase().includes("irrevocable transfer"))) {
        dealBreakers.push(`Irrevocable IP transfer: "${clause.text}"`);
      }

      // No deposit with high value
      if (clause.issues.some((i) => i.toLowerCase().includes("no deposit"))) {
        dealBreakers.push(`No deposit required: "${clause.text}"`);
      }

      // Exclusivity when not allowed
      if (clause.type === ClauseType.EXCLUSIVITY && !this.config.allow_exclusivity) {
        dealBreakers.push(`Exclusivity requirement: "${clause.text}"`);
      }
    }

    return dealBreakers;
  }

  /**
   * Determine if contract should be accepted
   */
  private shouldAcceptContract(riskScore: number, dealBreakers: string[]): boolean {
    // Never accept if there are deal-breakers
    if (dealBreakers.length > 0) {
      return false;
    }

    // Accept if risk score is within threshold
    return riskScore <= this.config.acceptable_risk_score;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ContractEvaluatorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current configuration
   */
  getConfig(): ContractEvaluatorConfig {
    return { ...this.config };
  }
}
