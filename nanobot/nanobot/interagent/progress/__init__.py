"""
进度报告 ANP 适配器
实现进度报告的 ANP 协议适配，支持增量进度更新和跨系统同步

@module nanobot.interagent.progress
@version 1.0.0
"""

# 导入原始进度模块的符号（保持向后兼容）
import sys
from pathlib import Path

# 获取原始 progress.py 模块的路径
_original_progress_path = Path(__file__).parent.parent / "progress.py"

# 动态导入原始模块
import importlib.util
spec = importlib.util.spec_from_file_location("nanobot.interagent._original_progress", _original_progress_path)
_original_progress = importlib.util.module_from_spec(spec)
sys.modules["nanobot.interagent._original_progress"] = _original_progress
spec.loader.exec_module(_original_progress)

# 重新导出原始符号
Milestone = _original_progress.Milestone
MilestoneStatus = _original_progress.MilestoneStatus
ProgressSnapshot = _original_progress.ProgressSnapshot
ProgressTracker = _original_progress.ProgressTracker
format_progress = _original_progress.format_progress
create_progress_bar = _original_progress.create_progress_bar
estimate_completion_time = _original_progress.estimate_completion_time

# 导入 ANP 适配器
from .adapter import (
    ProgressReportSender,
    ProgressReportReceiver,
    create_progress_adapter,
    ProgressSyncConfig,
    ProgressSyncStats,
    ProgressSyncState,
)

__all__ = [
    # 原始进度模块符号（向后兼容）
    "Milestone",
    "MilestoneStatus",
    "ProgressSnapshot",
    "ProgressTracker",
    "format_progress",
    "create_progress_bar",
    "estimate_completion_time",
    # ANP 适配器
    "ProgressReportSender",
    "ProgressReportReceiver",
    "create_progress_adapter",
    "ProgressSyncConfig",
    "ProgressSyncStats",
    "ProgressSyncState",
]
