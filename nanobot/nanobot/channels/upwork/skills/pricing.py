"""Pricing calculator for Upwork bids."""

from dataclasses import dataclass

from loguru import logger

from nanobot.config.schema import UpworkBiddingConfig

from ..models import UpworkProject


@dataclass
class PricingStrategy:
    """Pricing strategy recommendation."""
    suggested_amount: float
    strategy: str  # "competitive", "premium", "budget"
    reasoning: str
    min_bid: float
    max_bid: float
    confidence: float = 0.8  # How confident in the suggestion


class PricingCalculator:
    """Calculate optimal bid pricing."""

    # Markup factors for different strategies
    STRATEGY_MARKUP = {
        "budget": 0.85,  # 15% below market
        "competitive": 1.0,  # Market rate
        "premium": 1.25,  # 25% above market
    }

    def __init__(self, config: UpworkBiddingConfig):
        self.config = config

    def calculate(
        self,
        project: UpworkProject,
        estimated_hours: float,
        match_score: float = 0.5,
    ) -> PricingStrategy:
        """Calculate bid amount based on effort estimate."""
        hourly_rate = self.config.hourly_rate_usd
        base_amount = estimated_hours * hourly_rate

        # Determine strategy based on project and match
        strategy = self._determine_strategy(project, match_score, estimated_hours)

        # Apply strategy markup
        markup = self.STRATEGY_MARKUP.get(strategy, 1.0)
        adjusted_amount = base_amount * markup

        # Adjust based on project budget if available
        if project.budget:
            adjusted_amount = self._adjust_for_budget(
                adjusted_amount, project.budget, strategy
            )

        # Apply min/max constraints
        final_amount = max(
            self.config.min_budget_usd,
            min(self.config.max_budget_usd, adjusted_amount),
        )

        # Calculate confidence based on how much we had to adjust
        confidence = self._calculate_confidence(
            base_amount, final_amount, project.budget is not None
        )

        # Calculate bid range
        min_bid = final_amount * 0.85
        max_bid = final_amount * 1.15

        reasoning = self._generate_reasoning(
            strategy, estimated_hours, hourly_rate, final_amount, project.budget
        )

        logger.debug(
            "Pricing for project {}: ${:.0f} ({})",
            project.id,
            final_amount,
            strategy,
        )

        return PricingStrategy(
            suggested_amount=round(final_amount, 2),
            strategy=strategy,
            reasoning=reasoning,
            min_bid=round(min_bid, 2),
            max_bid=round(max_bid, 2),
            confidence=confidence,
        )

    def _determine_strategy(
        self,
        project: UpworkProject,
        match_score: float,
        estimated_hours: float,
    ) -> str:
        """Determine pricing strategy."""
        # High match score -> can charge premium
        if match_score >= 0.8:
            return "premium"

        # Low match score -> be competitive
        if match_score < 0.4:
            return "competitive"

        # Check client history
        if project.client:
            # High-value client -> premium
            if project.client.total_spent and project.client.total_spent > 10000:
                return "premium"
            # New client with no history -> competitive
            if project.client.reviews_count == 0:
                return "competitive"

        # Large project -> competitive to win
        if estimated_hours > 80:
            return "competitive"

        # Small project -> can be premium
        if estimated_hours < 10:
            return "premium"

        return "competitive"

    def _adjust_for_budget(
        self,
        amount: float,
        budget,
        strategy: str,
    ) -> float:
        """Adjust bid based on project budget."""
        if budget.type == "fixed":
            # For fixed price projects, aim for 70-85% of max budget
            if budget.max_amount:
                target_pct = 0.75 if strategy == "competitive" else 0.85
                target = budget.max_amount * target_pct

                # Don't go below our minimum
                if target >= self.config.min_budget_usd:
                    amount = min(amount, target)

                # Don't exceed budget max
                amount = min(amount, budget.max_amount)

        elif budget.type == "hourly":
            # For hourly, ensure our rate fits in their range
            if budget.max_amount and budget.max_amount < self.config.hourly_rate_usd:
                # Client's max is below our rate - adjust down slightly
                amount = amount * (budget.max_amount / self.config.hourly_rate_usd)

        return amount

    def _calculate_confidence(
        self,
        original: float,
        final: float,
        has_budget: bool,
    ) -> float:
        """Calculate confidence in pricing."""
        # High confidence if we didn't adjust much
        adjustment_ratio = abs(final - original) / max(original, 1)
        confidence = 1.0 - (adjustment_ratio * 0.5)

        # Lower confidence if no budget info
        if not has_budget:
            confidence *= 0.8

        return max(0.3, min(1.0, confidence))

    def _generate_reasoning(
        self,
        strategy: str,
        hours: float,
        rate: float,
        final: float,
        budget,
    ) -> str:
        """Generate human-readable reasoning."""
        base = f"Based on {hours:.0f}h @ ${rate:.0f}/hr"

        strategy_notes = {
            "budget": "Priced competitively to win the project",
            "competitive": "Market rate pricing",
            "premium": "Premium rate for high-skill match",
        }

        note = strategy_notes.get(strategy, "")

        budget_note = ""
        if budget and budget.max_amount:
            budget_note = f", within ${budget.max_amount:.0f} budget"

        return f"{base}. {note}{budget_note}. Final: ${final:.0f}"

    def suggest_hourly_rate(
        self,
        project: UpworkProject,
        match_score: float,
    ) -> float:
        """Suggest hourly rate for the project."""
        base_rate = self.config.hourly_rate_usd

        # Adjust based on match score
        if match_score >= 0.8:
            return base_rate * 1.2  # 20% premium
        elif match_score < 0.4:
            return base_rate * 0.9  # 10% discount

        return base_rate
