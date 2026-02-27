"""Upwork channel for RSS monitoring and project tracking."""

from nanobot.channels.upwork.channel import UpworkChannel
from nanobot.channels.upwork.models import (
    BidProposal,
    BidResult,
    BudgetInfo,
    ClientInfo,
    MatchResult,
    ProjectNotification,
    UpworkProject,
)
from nanobot.channels.upwork.rss_monitor import RSSMonitor

__all__ = [
    "UpworkChannel",
    "BudgetInfo",
    "BidProposal",
    "BidResult",
    "ClientInfo",
    "MatchResult",
    "ProjectNotification",
    "UpworkProject",
    "RSSMonitor",
]
