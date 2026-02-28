/**
 * Tests for ContractEvaluator - contract risk assessment
 */

import { describe, it, expect } from "vitest";
import {
  ContractEvaluator,
  ContractText,
  ContractEvaluation,
  RiskLevel,
  ClauseType,
  DEFAULT_EVALUATOR_CONFIG,
} from "../../biz/contract-evaluator";

describe("ContractEvaluator", () => {
  describe("evaluate", () => {
    it("should evaluate a safe contract", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        title: "Simple Service Agreement",
        content: `
          This is a simple service agreement.
          Payment will be made within 30 days of invoice.
          A 30% deposit is required.
          IP rights remain with developer until full payment.
          Either party may terminate with 14 days notice.
          Liability is limited to contract value.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.contract_id).toBe("1");
      expect(evaluation.risk_score).toBeLessThan(0.4);
      expect(evaluation.overall_risk).toBe(RiskLevel.LOW);
      expect(evaluation.should_accept).toBe(true);
      expect(evaluation.deal_breakers).toHaveLength(0);
    });

    it("should identify risky payment terms", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Payment will be made within 60 days of invoice.
          No deposit is required.
          Full payment upon completion only.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.risk_score).toBeGreaterThan(0);
      const paymentClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.PAYMENT
      );
      expect(paymentClauses.length).toBeGreaterThan(0);
    });

    it("should detect IP transfer clauses", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          All work created shall be considered work for hire.
          Contractor transfers all intellectual property rights to client.
          This transfer is irrevocable.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      const ipClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.INTELLECTUAL_PROPERTY
      );
      expect(ipClauses.length).toBeGreaterThan(0);

      // Should have suggestions
      expect(ipClauses[0].suggestions.length).toBeGreaterThan(0);
    });

    it("should identify unlimited liability as deal-breaker", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Contractor accepts unlimited liability for any damages.
          Personal guarantee required for all obligations.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.should_accept).toBe(false);
      expect(evaluation.deal_breakers.length).toBeGreaterThan(0);
      expect(evaluation.deal_breakers.some((d) =>
        d.toLowerCase().includes("unlimited liability")
      )).toBe(true);
    });

    it("should detect problematic termination clauses", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Client may terminate immediately without cause at any time.
          Early termination fee of $1000 applies.
          No termination for convenience permitted.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      const terminationClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.TERMINATION
      );
      expect(terminationClauses.length).toBeGreaterThan(0);
    });

    it("should detect exclusivity requirements", () => {
      const evaluator = new ContractEvaluator({
        allow_exclusivity: false,
      });

      const contract: ContractText = {
        id: "1",
        content: `
          Contractor agrees to exclusive relationship with client.
          Contractor will not work with other clients during project.
          Non-compete agreement for 12 months after completion.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      const exclusivityClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.EXCLUSIVITY
      );
      expect(exclusivityClauses.length).toBeGreaterThan(0);

      // Should be a deal-breaker when exclusivity not allowed
      expect(evaluation.deal_breakers.some((d) =>
        d.toLowerCase().includes("exclusivity")
      )).toBe(true);
    });

    it("should detect unlimited revisions", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Contractor agrees to unlimited revisions until client satisfied.
          No limit on changes to project scope.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      const deliverableClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.DELIVERABLES
      );
      expect(deliverableClauses.length).toBeGreaterThan(0);
    });

    it("should generate suggestions for each risky clause", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Payment within 60 days of invoice.
          All IP rights transferred to client.
          Unlimited liability for damages.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      for (const clause of evaluation.clauses) {
        expect(clause.suggestions.length).toBeGreaterThan(0);
      }
    });

    it("should generate summary with risk level", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Payment within 60 days.
          No deposit required.
          IP transfer required.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.summary).toBeDefined();
      expect(evaluation.summary).toContain("Risk Assessment");
      expect(evaluation.summary).toContain("potentially risky");
    });

    it("should generate recommendations", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "Payment within 90 days.",
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.recommendations).toBeDefined();
      expect(evaluation.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe("risk identification accuracy", () => {
    it("should identify >90% of risky clauses", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          This contract contains several risky clauses:

          1. Payment within 60 days of invoice.
          2. No deposit required.
          3. Work for hire - all IP transferred to client.
          4. Irrevocable transfer of rights.
          5. Unlimited liability for contractor.
          6. Personal guarantee required.
          7. Client may terminate immediately without cause.
          8. $500 termination fee.
          9. Perpetual confidentiality obligation.
          10. Exclusive relationship required.
          11. Unlimited revisions until satisfied.
          12. Late delivery penalty of $100 per day.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      // Should identify most of the 12 risky clauses (>90% = at least 11)
      expect(evaluation.clauses.length).toBeGreaterThanOrEqual(11);
    });
  });

  describe("deal breaker identification", () => {
    it("should identify personal guarantee as deal-breaker", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "Personal guarantee required for all obligations.",
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.deal_breakers.length).toBeGreaterThan(0);
      expect(evaluation.should_accept).toBe(false);
    });

    it("should identify unlimited liability as deal-breaker", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "Contractor accepts unlimited liability.",
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.deal_breakers.length).toBeGreaterThan(0);
      expect(evaluation.should_accept).toBe(false);
    });

    it("should identify no deposit as deal-breaker", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "No deposit required. Full payment on completion.",
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.deal_breakers.length).toBeGreaterThan(0);
    });
  });

  describe("risk level calculation", () => {
    it("should assign CRITICAL for very high risk", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Unlimited liability.
          Personal guarantee.
          No deposit.
          Irrevocable IP transfer.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.overall_risk).toBe(RiskLevel.CRITICAL);
    });

    it("should assign LOW for safe contract", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          Payment within 14 days.
          30% deposit required.
          Liability limited to contract value.
          IP rights protected.
          30 days termination notice.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.overall_risk).toBe(RiskLevel.LOW);
    });
  });

  describe("configuration", () => {
    it("should use custom configuration", () => {
      const evaluator = new ContractEvaluator({
        acceptable_risk_score: 0.2,
        strict_mode: true,
        allow_exclusivity: true,
      });

      const contract: ContractText = {
        id: "1",
        content: "Exclusive relationship required.",
      };

      const evaluation = evaluator.evaluate(contract);

      // With exclusivity allowed, should not be a deal-breaker
      expect(evaluation.deal_breakers.some((d) =>
        d.toLowerCase().includes("exclusivity")
      )).toBe(false);
    });

    it("should allow configuration updates", () => {
      const evaluator = new ContractEvaluator();

      evaluator.updateConfig({
        acceptable_risk_score: 0.3,
        max_payment_days: 45,
      });

      const config = evaluator.getConfig();

      expect(config.acceptable_risk_score).toBe(0.3);
      expect(config.max_payment_days).toBe(45);
    });
  });

  describe("DEFAULT_EVALUATOR_CONFIG", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_EVALUATOR_CONFIG.acceptable_risk_score).toBe(0.4);
      expect(DEFAULT_EVALUATOR_CONFIG.max_payment_days).toBe(30);
      expect(DEFAULT_EVALUATOR_CONFIG.min_deposit_percentage).toBe(25);
      expect(DEFAULT_EVALUATOR_CONFIG.allow_exclusivity).toBe(false);
    });
  });

  describe("suggestion generation", () => {
    it("should provide specific suggestions for payment issues", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "Payment within 60 days. No deposit required.",
      };

      const evaluation = evaluator.evaluate(contract);

      const paymentClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.PAYMENT
      );

      expect(paymentClauses.length).toBeGreaterThan(0);
      expect(paymentClauses[0].suggestions.length).toBeGreaterThan(0);
    });

    it("should provide specific suggestions for IP issues", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "All IP rights transferred to client.",
      };

      const evaluation = evaluator.evaluate(contract);

      const ipClauses = evaluation.clauses.filter(
        (c) => c.type === ClauseType.INTELLECTUAL_PROPERTY
      );

      expect(ipClauses.length).toBeGreaterThan(0);
      expect(ipClauses[0].suggestions.length).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty contract", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "",
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.risk_score).toBe(0);
      expect(evaluation.clauses).toHaveLength(0);
      expect(evaluation.should_accept).toBe(true);
    });

    it("should handle contract with no risky clauses", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: `
          This is a simple agreement.
          Both parties agree to work together.
          Payment terms are fair.
          Both parties respect each other.
        `,
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.clauses).toHaveLength(0);
      expect(evaluation.risk_score).toBe(0);
    });

    it("should be case insensitive", () => {
      const evaluator = new ContractEvaluator();

      const contract: ContractText = {
        id: "1",
        content: "PAYMENT WITHIN 60 DAYS. NO DEPOSIT REQUIRED.",
      };

      const evaluation = evaluator.evaluate(contract);

      expect(evaluation.clauses.length).toBeGreaterThan(0);
    });
  });
});
