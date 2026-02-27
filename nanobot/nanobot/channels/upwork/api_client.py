"""Upwork API client for bidding and messaging."""

import re
from datetime import datetime, timedelta
from typing import Any

import httpx
from loguru import logger

from nanobot.config.schema import UpworkAPIConfig

from .models import BidProposal, BidResult

# Pattern to detect sensitive tokens in logs
TOKEN_PATTERN = re.compile(r'Bearer\s+[\w\.-]+|access_token["\s:]+[\w\.-]+', re.IGNORECASE)


def _redact_sensitive(text: str) -> str:
    """Redact sensitive information like access tokens from text."""
    return TOKEN_PATTERN.sub("[REDACTED]", text)


class UpworkAPIClient:
    """Upwork API client for bidding and messaging."""

    BASE_URL = "https://www.upwork.com/api"
    AUTH_URL = "https://www.upwork.com/api/v3/oauth2/token"

    def __init__(self, config: UpworkAPIConfig):
        self.config = config
        self._client = httpx.AsyncClient(timeout=30.0)
        self._token_expires_at: datetime | None = None

        # Parse token expiration if available
        if config.token_expires_at:
            try:
                self._token_expires_at = datetime.fromisoformat(config.token_expires_at)
            except ValueError:
                pass

    async def ensure_authenticated(self) -> bool:
        """Ensure we have a valid access token."""
        if not self.config.access_token:
            logger.warning("No Upwork access token configured")
            return False

        # Check if token needs refresh
        if self._token_expires_at and self._token_expires_at < datetime.now() + timedelta(minutes=5):
            return await self._refresh_token()

        return True

    async def _refresh_token(self) -> bool:
        """Refresh the access token."""
        if not self.config.refresh_token or not self.config.client_id:
            logger.warning("Cannot refresh token: missing credentials")
            return False

        try:
            response = await self._client.post(
                self.AUTH_URL,
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": self.config.refresh_token,
                    "client_id": self.config.client_id,
                    "client_secret": self.config.client_secret,
                },
            )

            if response.status_code == 200:
                data = response.json()
                if not self._validate_token_response(data):
                    logger.error("Token refresh response validation failed")
                    return False

                self.config.access_token = data.get("access_token", self.config.access_token)
                self.config.refresh_token = data.get("refresh_token", self.config.refresh_token)

                # Update expiration
                expires_in = data.get("expires_in", 3600)
                self._token_expires_at = datetime.now() + timedelta(seconds=expires_in)

                logger.info("Successfully refreshed Upwork access token")
                return True
            else:
                logger.error("Token refresh failed: {}", _redact_sensitive(response.text))
                return False

        except Exception as e:
            logger.error("Token refresh error: {}", _redact_sensitive(str(e)))
            return False

    def _validate_token_response(self, data: dict[str, Any]) -> bool:
        """Validate token refresh response contains required fields."""
        required_fields = ["access_token", "expires_in"]
        for field in required_fields:
            if field not in data:
                logger.error("Token response missing required field: {}", field)
                return False

        # Validate access_token is not empty
        if not data.get("access_token"):
            logger.error("Token response contains empty access_token")
            return False

        # Validate expires_in is a reasonable number (between 60 and 86400 seconds)
        expires_in = data.get("expires_in", 0)
        try:
            if not (60 <= expires_in <= 86400):
                logger.warning("Token expires_in value unusual: {}", expires_in)
        except (TypeError, ValueError):
            logger.error("Token expires_in is not a valid number")
            return False

        return True

    async def submit_bid(self, proposal: BidProposal) -> BidResult:
        """Submit a bid proposal to Upwork."""
        if not await self.ensure_authenticated():
            return BidResult(
                success=False,
                project_id=proposal.project_id,
                error_message="Authentication failed",
            )

        try:
            payload = {
                "job_id": proposal.project_id,
                "cover_letter": proposal.cover_letter,
                "bid_amount": proposal.bid_amount,
            }

            if proposal.duration_days:
                payload["duration_days"] = proposal.duration_days

            if proposal.milestone_description:
                payload["milestone_description"] = proposal.milestone_description

            response = await self._client.post(
                f"{self.BASE_URL}/applications/v1/proposals",
                headers=self._get_headers(),
                json=payload,
            )

            if response.status_code == 200:
                data = response.json()
                return BidResult(
                    success=True,
                    project_id=proposal.project_id,
                    bid_id=data.get("proposal_id") or data.get("id"),
                )
            elif response.status_code == 401:
                # Token expired, try refresh and retry
                if await self._refresh_token():
                    return await self.submit_bid(proposal)
                return BidResult(
                    success=False,
                    project_id=proposal.project_id,
                    error_message="Authentication expired",
                )
            elif response.status_code == 429:
                return BidResult(
                    success=False,
                    project_id=proposal.project_id,
                    error_message="Rate limit exceeded",
                )
            else:
                error_msg = self._parse_error(response)
                logger.error("Bid submission failed: {} - {}", response.status_code, error_msg)
                return BidResult(
                    success=False,
                    project_id=proposal.project_id,
                    error_message=error_msg,
                )

        except httpx.TimeoutException:
            return BidResult(
                success=False,
                project_id=proposal.project_id,
                error_message="Request timeout",
            )
        except Exception as e:
            logger.error("Bid submission error: {}", _redact_sensitive(str(e)))
            return BidResult(
                success=False,
                project_id=proposal.project_id,
                error_message=str(e),
            )

    async def send_message(
        self,
        project_id: str,
        recipient_id: str,
        message: str,
    ) -> bool:
        """Send a message to a client."""
        if not await self.ensure_authenticated():
            logger.warning("Cannot send message: not authenticated")
            return False

        try:
            response = await self._client.post(
                f"{self.BASE_URL}/messages/v3/rooms",
                headers=self._get_headers(),
                json={
                    "job_id": project_id,
                    "recipient_id": recipient_id,
                    "body": message,
                },
            )

            if response.status_code == 200:
                logger.info("Message sent to client for project {}", project_id)
                return True
            else:
                logger.error(
                    "Failed to send message: {} - {}",
                    response.status_code,
                    _redact_sensitive(response.text),
                )
                return False

        except Exception as e:
            logger.error("Message send error: {}", _redact_sensitive(str(e)))
            return False

    async def get_job_details(self, job_id: str) -> dict[str, Any] | None:
        """Get details of a specific job."""
        if not await self.ensure_authenticated():
            return None

        try:
            response = await self._client.get(
                f"{self.BASE_URL}/jobs/v3/jobs/{job_id}",
                headers=self._get_headers(),
            )

            if response.status_code == 200:
                return response.json()
            return None

        except Exception as e:
            logger.error("Get job details error: {}", e)
            return None

    async def get_my_bids(self, status: str = "active") -> list[dict[str, Any]]:
        """Get list of submitted bids."""
        if not await self.ensure_authenticated():
            return []

        try:
            response = await self._client.get(
                f"{self.BASE_URL}/applications/v1/proposals",
                headers=self._get_headers(),
                params={"status": status},
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("proposals", [])
            return []

        except Exception as e:
            logger.error("Get bids error: {}", e)
            return []

    def _get_headers(self) -> dict[str, str]:
        """Get API headers with auth token."""
        return {
            "Authorization": f"Bearer {self.config.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _parse_error(self, response: httpx.Response) -> str:
        """Parse error message from response, redacting sensitive info."""
        try:
            data = response.json()
            if "error" in data:
                return _redact_sensitive(str(data["error"]))
            if "message" in data:
                return _redact_sensitive(str(data["message"]))
            return _redact_sensitive(response.text[:200])
        except Exception:
            return _redact_sensitive(response.text[:200])

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()
