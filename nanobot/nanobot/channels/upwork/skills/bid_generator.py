"""Bid proposal generator using LLM."""

from loguru import logger

from nanobot.config.schema import UpworkBiddingConfig

from ..models import BidProposal, MatchResult, UpworkProject

# Maximum length of project description to include in LLM prompts
MAX_DESCRIPTION_LENGTH_FOR_PROMPT = 1500


class BidGenerator:
    """Generate bid proposals using LLM."""

    SYSTEM_PROMPT = """You are an expert Upwork proposal writer with years of freelance experience.
Generate compelling, personalized cover letters that:
1. Address the client's specific needs and pain points
2. Highlight relevant experience and skills that match the project
3. Demonstrate understanding of the project requirements
4. Include a brief, relevant example or approach
5. End with a clear, professional call to action

Keep it professional, concise (150-250 words), and engaging.
Avoid generic phrases like "I am the best candidate" - instead, show value.
Do not include pricing in the cover letter."""

    COVER_LETTER_TEMPLATE = """Hi there,

I noticed your project "{title}" and it aligns perfectly with my expertise.

{relevant_experience}

{approach}

I'd love to discuss how I can help bring your vision to life. When would be a good time for a quick chat?

Best regards"""

    def __init__(self, config: UpworkBiddingConfig, llm_client=None):
        self.config = config
        self.llm = llm_client

    async def generate_proposal(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> BidProposal:
        """Generate a complete bid proposal."""
        # Generate cover letter
        cover_letter = await self.generate_cover_letter(project, match_result)

        # Calculate bid amount
        if match_result.estimated_hours:
            bid_amount = match_result.estimated_hours * self.config.hourly_rate_usd
        else:
            # Fallback estimate based on budget
            bid_amount = self._estimate_from_budget(project)

        # Ensure within bounds
        bid_amount = max(
            self.config.min_budget_usd,
            min(self.config.max_budget_usd, bid_amount),
        )

        # Estimate duration
        duration_days = self._estimate_duration(
            match_result.estimated_hours or bid_amount / self.config.hourly_rate_usd
        )

        return BidProposal(
            project_id=project.id,
            cover_letter=cover_letter,
            bid_amount=round(bid_amount, 2),
            duration_days=duration_days,
        )

    async def generate_cover_letter(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> str:
        """Generate cover letter using LLM or template."""
        if self.llm:
            try:
                return await self._generate_with_llm(project, match_result)
            except Exception as e:
                logger.warning(
                    "LLM generation failed, using template: {}",
                    e,
                )

        # Fallback to template
        return self._generate_from_template(project, match_result)

    async def _generate_with_llm(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> str:
        """Generate cover letter using LLM."""
        prompt = self._build_prompt(project, match_result)

        # Use LiteLLM-style call
        response = await self.llm.chat(
            messages=[
                {"role": "system", "content": self.SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            max_tokens=500,
            temperature=0.7,
        )

        return response.content

    def _build_prompt(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> str:
        """Build the prompt for LLM."""
        skills_str = ", ".join(project.skills) if project.skills else "Not specified"
        matched_str = (
            ", ".join(match_result.matched_skills)
            if match_result.matched_skills
            else "General fit"
        )

        budget_str = "Not specified"
        if project.budget:
            if project.budget.type == "fixed":
                if project.budget.min_amount and project.budget.max_amount:
                    budget_str = f"${project.budget.min_amount:.0f} - ${project.budget.max_amount:.0f} (fixed)"
                elif project.budget.max_amount:
                    budget_str = f"${project.budget.max_amount:.0f} (fixed)"
            else:
                if project.budget.min_amount and project.budget.max_amount:
                    budget_str = f"${project.budget.min_amount:.0f} - ${project.budget.max_amount:.0f}/hr"

        prompt = f"""Project Title: {project.title}

Project Description:
{project.description[:MAX_DESCRIPTION_LENGTH_FOR_PROMPT]}

Required Skills: {skills_str}
Our Matched Skills: {matched_str}
Match Score: {match_result.score:.0%}
Budget: {budget_str}

Write a compelling cover letter for this Upwork project. Focus on the matched skills and how they relate to the project requirements. Be specific and professional."""

        return prompt

    def _generate_from_template(
        self,
        project: UpworkProject,
        match_result: MatchResult,
    ) -> str:
        """Generate cover letter from template when LLM unavailable."""
        # Build relevant experience section
        if match_result.matched_skills:
            skills_list = ", ".join(match_result.matched_skills[:3])
            relevant_exp = f"I have extensive experience with {skills_list}, which seems to be exactly what you're looking for."
        else:
            relevant_exp = "I have the skills and experience needed for this project."

        # Build approach section based on project type
        approach = self._suggest_approach(project)

        return self.COVER_LETTER_TEMPLATE.format(
            title=project.title,
            relevant_experience=relevant_exp,
            approach=approach,
        )

    def _suggest_approach(self, project: UpworkProject) -> str:
        """Suggest an approach based on project type."""
        desc_lower = project.description.lower()

        if "api" in desc_lower or "backend" in desc_lower:
            return "I can build a robust, scalable solution with proper error handling and documentation."
        elif "frontend" in desc_lower or "ui" in desc_lower or "react" in desc_lower:
            return "I focus on creating clean, responsive interfaces with great user experience."
        elif "automation" in desc_lower or "script" in desc_lower:
            return "I can develop an efficient automated solution that saves you time."
        elif "data" in desc_lower or "database" in desc_lower:
            return "I have experience with data processing and can ensure accuracy and performance."
        else:
            return "I'm confident I can deliver quality work within your timeline."

    def _estimate_from_budget(self, project: UpworkProject) -> float:
        """Estimate bid amount from project budget."""
        if project.budget and project.budget.max_amount:
            # Bid at 75% of max budget
            return project.budget.max_amount * 0.75

        # Default estimate
        return self.config.min_budget_usd * 2

    def _estimate_duration(self, estimated_hours: float) -> int:
        """Estimate project duration in days."""
        # Assume 5 productive hours per day
        hours_per_day = 5
        days = max(1, int(estimated_hours / hours_per_day))

        # Add buffer for communication and revisions
        if days <= 3:
            return days + 1
        elif days <= 7:
            return days + 2
        else:
            return int(days * 1.2)
