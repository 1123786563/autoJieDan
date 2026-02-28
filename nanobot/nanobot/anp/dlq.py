"""
ANP 死信队列 (Dead Letter Queue) - DLQ

用于存储和处理失败的消息，确保消息可追溯和可重试

@module anp.dlq
@version 1.0.0
"""

import json
import os
import sqlite3
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field, asdict

from pydantic import BaseModel, Field


# ============================================================================
# 类型定义
# ============================================================================

class DeadMessageStatus(str):
    """死信消息状态"""
    PENDING = "pending"          # 等待处理
    RETRYING = "retrying"        # 重试中
    FAILED = "failed"            # 最终失败
    RESOLVED = "resolved"        # 已解决


@dataclass
class DeadMessage:
    """死信消息"""
    id: str
    """消息ID"""

    original_message_id: str
    """原始消息ID"""

    original_message: Dict[str, Any]
    """原始消息内容"""

    error_type: str
    """错误类型"""

    error_message: str
    """错误消息"""

    failed_at: datetime
    """失败时间"""

    retry_count: int = 0
    """重试次数"""

    max_retries: int = 3
    """最大重试次数"""

    status: str = DeadMessageStatus.PENDING
    """当前状态"""

    last_retry_at: Optional[datetime] = None
    """最后重试时间"""

    resolved_at: Optional[datetime] = None
    """解决时间"""

    metadata: Dict[str, Any] = field(default_factory=dict)
    """附加元数据"""

    stack_trace: Optional[str] = None
    """错误堆栈跟踪"""

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "id": self.id,
            "original_message_id": self.original_message_id,
            "original_message": self.original_message,
            "error_type": self.error_type,
            "error_message": self.error_message,
            "failed_at": self.failed_at.isoformat(),
            "retry_count": self.retry_count,
            "max_retries": self.max_retries,
            "status": self.status,
            "last_retry_at": self.last_retry_at.isoformat() if self.last_retry_at else None,
            "resolved_at": self.resolved_at.isoformat() if self.resolved_at else None,
            "metadata": self.metadata,
            "stack_trace": self.stack_trace,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DeadMessage":
        """从字典创建实例"""
        return cls(
            id=data["id"],
            original_message_id=data["original_message_id"],
            original_message=data["original_message"],
            error_type=data["error_type"],
            error_message=data["error_message"],
            failed_at=datetime.fromisoformat(data["failed_at"]),
            retry_count=data.get("retry_count", 0),
            max_retries=data.get("max_retries", 3),
            status=data.get("status", DeadMessageStatus.PENDING),
            last_retry_at=datetime.fromisoformat(data["last_retry_at"]) if data.get("last_retry_at") else None,
            resolved_at=datetime.fromisoformat(data["resolved_at"]) if data.get("resolved_at") else None,
            metadata=data.get("metadata", {}),
            stack_trace=data.get("stack_trace"),
        )


@dataclass
class RetryResult:
    """重试结果"""
    success: bool
    """是否成功"""

    message: str
    """结果消息"""

    retried_at: datetime = field(default_factory=datetime.now)
    """重试时间"""

    new_message_id: Optional[str] = None
    """新的消息ID（如果成功）"""


@dataclass
class DLQQuery:
    """DLQ 查询条件"""
    status: Optional[str] = None
    """按状态筛选"""

    error_type: Optional[str] = None
    """按错误类型筛选"""

    limit: int = 100
    """返回数量限制"""

    offset: int = 0
    """偏移量"""

    date_from: Optional[datetime] = None
    """起始日期"""

    date_to: Optional[datetime] = None
    """结束日期"""


# ============================================================================
# DLQ 存储实现
# ============================================================================

class DLQStorage:
    """
    死信队列存储

    使用 SQLite 存储失败的消息，支持查询和重试
    """

    def __init__(self, db_path: Optional[Path] = None):
        """
        初始化 DLQ 存储

        Args:
            db_path: 数据库文件路径，默认为 ~/.automaton/dlq.db
        """
        if db_path is None:
            home = Path.home()
            db_dir = home / ".automaton"
            db_dir.mkdir(parents=True, exist_ok=True)
            db_path = db_dir / "dlq.db"

        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _init_db(self) -> None:
        """初始化数据库表"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS dead_messages (
                    id TEXT PRIMARY KEY,
                    original_message_id TEXT NOT NULL,
                    original_message TEXT NOT NULL,
                    error_type TEXT NOT NULL,
                    error_message TEXT NOT NULL,
                    failed_at TEXT NOT NULL,
                    retry_count INTEGER DEFAULT 0,
                    max_retries INTEGER DEFAULT 3,
                    status TEXT DEFAULT 'pending',
                    last_retry_at TEXT,
                    resolved_at TEXT,
                    metadata TEXT DEFAULT '{}',
                    stack_trace TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # 创建索引
            conn.execute("CREATE INDEX IF NOT EXISTS idx_status ON dead_messages(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_error_type ON dead_messages(error_type)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_failed_at ON dead_messages(failed_at)")

            conn.commit()

    def add_message(
        self,
        original_message_id: str,
        original_message: Dict[str, Any],
        error_type: str,
        error_message: str,
        max_retries: int = 3,
        metadata: Optional[Dict[str, Any]] = None,
        stack_trace: Optional[str] = None,
    ) -> str:
        """
        添加失败消息到 DLQ

        Args:
            original_message_id: 原始消息ID
            original_message: 原始消息内容
            error_type: 错误类型
            error_message: 错误消息
            max_retries: 最大重试次数
            metadata: 附加元数据
            stack_trace: 错误堆栈跟踪

        Returns:
            消息ID
        """
        import uuid

        msg_id = f"dlq-{uuid.uuid4()}"
        now = datetime.now()

        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute("""
                    INSERT INTO dead_messages (
                        id, original_message_id, original_message,
                        error_type, error_message, failed_at,
                        retry_count, max_retries, status,
                        metadata, stack_trace
                    ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?, ?)
                """, (
                    msg_id,
                    original_message_id,
                    json.dumps(original_message),
                    error_type,
                    error_message,
                    now.isoformat(),
                    max_retries,
                    json.dumps(metadata or {}),
                    stack_trace,
                ))

                conn.commit()

        return msg_id

    def get_message(self, msg_id: str) -> Optional[DeadMessage]:
        """
        获取单个死信消息

        Args:
            msg_id: 消息ID

        Returns:
            DeadMessage 或 None
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(
                    "SELECT * FROM dead_messages WHERE id = ?",
                    (msg_id,)
                )
                row = cursor.fetchone()

                if not row:
                    return None

                return self._row_to_message(row)

    def query_messages(self, query: DLQQuery) -> List[DeadMessage]:
        """
        查询死信消息

        Args:
            query: 查询条件

        Returns:
            消息列表
        """
        conditions = []
        params = []

        if query.status:
            conditions.append("status = ?")
            params.append(query.status)

        if query.error_type:
            conditions.append("error_type = ?")
            params.append(query.error_type)

        if query.date_from:
            conditions.append("failed_at >= ?")
            params.append(query.date_from.isoformat())

        if query.date_to:
            conditions.append("failed_at <= ?")
            params.append(query.date_to.isoformat())

        where_clause = " AND ".join(conditions) if conditions else "1=1"

        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute(f"""
                    SELECT * FROM dead_messages
                    WHERE {where_clause}
                    ORDER BY failed_at DESC
                    LIMIT ? OFFSET ?
                """, params + [query.limit, query.offset])

                return [self._row_to_message(row) for row in cursor.fetchall()]

    def update_status(
        self,
        msg_id: str,
        status: str,
        resolved_at: Optional[datetime] = None,
    ) -> bool:
        """
        更新消息状态

        Args:
            msg_id: 消息ID
            status: 新状态
            resolved_at: 解决时间

        Returns:
            是否成功
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    UPDATE dead_messages
                    SET status = ?, resolved_at = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (status, resolved_at.isoformat() if resolved_at else None, msg_id))

                conn.commit()
                return cursor.rowcount > 0

    def increment_retry(self, msg_id: str) -> bool:
        """
        增加重试计数

        Args:
            msg_id: 消息ID

        Returns:
            是否成功
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute("""
                    UPDATE dead_messages
                    SET retry_count = retry_count + 1,
                        last_retry_at = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                """, (msg_id,))

                conn.commit()
                return cursor.rowcount > 0

    def delete_message(self, msg_id: str) -> bool:
        """
        删除消息

        Args:
            msg_id: 消息ID

        Returns:
            是否成功
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.execute(
                    "DELETE FROM dead_messages WHERE id = ?",
                    (msg_id,)
                )

                conn.commit()
                return cursor.rowcount > 0

    def get_statistics(self) -> Dict[str, Any]:
        """
        获取 DLQ 统计信息

        Returns:
            统计信息字典
        """
        with self._lock:
            with sqlite3.connect(self.db_path) as conn:
                conn.row_factory = sqlite3.Row
                cursor = conn.execute("""
                    SELECT
                        COUNT(*) as total,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                        SUM(CASE WHEN status = 'retrying' THEN 1 ELSE 0 END) as retrying,
                        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
                        AVG(retry_count) as avg_retries
                    FROM dead_messages
                """)

                row = cursor.fetchone()

                # 按错误类型统计
                cursor = conn.execute("""
                    SELECT error_type, COUNT(*) as count
                    FROM dead_messages
                    WHERE status != 'resolved'
                    GROUP BY error_type
                    ORDER BY count DESC
                """)

                error_types = {row["error_type"]: row["count"] for row in cursor.fetchall()}

                return {
                    "total": row["total"] or 0,
                    "pending": row["pending"] or 0,
                    "retrying": row["retrying"] or 0,
                    "failed": row["failed"] or 0,
                    "resolved": row["resolved"] or 0,
                    "avg_retries": round(row["avg_retries"] or 0, 2),
                    "error_types": error_types,
                }

    def _row_to_message(self, row: sqlite3.Row) -> DeadMessage:
        """将数据库行转换为 DeadMessage 对象"""
        return DeadMessage(
            id=row["id"],
            original_message_id=row["original_message_id"],
            original_message=json.loads(row["original_message"]),
            error_type=row["error_type"],
            error_message=row["error_message"],
            failed_at=datetime.fromisoformat(row["failed_at"]),
            retry_count=row["retry_count"],
            max_retries=row["max_retries"],
            status=row["status"],
            last_retry_at=datetime.fromisoformat(row["last_retry_at"]) if row["last_retry_at"] else None,
            resolved_at=datetime.fromisoformat(row["resolved_at"]) if row["resolved_at"] else None,
            metadata=json.loads(row["metadata"]),
            stack_trace=row["stack_trace"],
        )


# ============================================================================
# 全局 DLQ 实例
# ============================================================================

_global_dlq: Optional[DLQStorage] = None


def get_global_dlq() -> DLQStorage:
    """获取全局 DLQ 存储实例"""
    global _global_dlq
    if _global_dlq is None:
        _global_dlq = DLQStorage()
    return _global_dlq


def set_global_dlq(dlq: DLQStorage) -> None:
    """设置全局 DLQ 存储实例"""
    global _global_dlq
    _global_dlq = dlq


def close_global_dlq() -> None:
    """关闭全局 DLQ 存储实例"""
    global _global_dlq
    _global_dlq = None


# ============================================================================
# DLQ 管理器
# ============================================================================

class DLQManager:
    """
    死信队列管理器

    提供高级 DLQ 操作功能
    """

    def __init__(self, storage: Optional[DLQStorage] = None):
        """
        初始化 DLQ 管理器

        Args:
            storage: DLQ 存储实例，默认使用全局实例
        """
        self.storage = storage or get_global_dlq()

    def enqueue_failed_message(
        self,
        message_id: str,
        message: Dict[str, Any],
        error: Exception,
        max_retries: int = 3,
    ) -> str:
        """
        将失败的消息加入 DLQ

        Args:
            message_id: 消息ID
            message: 消息内容
            error: 异常对象
            max_retries: 最大重试次数

        Returns:
            DLQ 消息ID
        """
        import traceback

        error_type = type(error).__name__
        error_message = str(error)
        stack_trace = traceback.format_exc()

        return self.storage.add_message(
            original_message_id=message_id,
            original_message=message,
            error_type=error_type,
            error_message=error_message,
            max_retries=max_retries,
            stack_trace=stack_trace,
        )

    def retry_message(
        self,
        dlq_message_id: str,
        retry_func,
    ) -> RetryResult:
        """
        重试失败的消息

        Args:
            dlq_message_id: DLQ 消息ID
            retry_func: 重试函数，接收原始消息作为参数

        Returns:
            重试结果
        """
        # 获取消息
        dead_message = self.storage.get_message(dlq_message_id)
        if not dead_message:
            return RetryResult(
                success=False,
                message=f"Message {dlq_message_id} not found"
            )

        # 检查重试次数
        if dead_message.retry_count >= dead_message.max_retries:
            self.storage.update_status(
                dlq_message_id,
                DeadMessageStatus.FAILED
            )
            return RetryResult(
                success=False,
                message=f"Max retries ({dead_message.max_retries}) exceeded"
            )

        # 更新状态为重试中
        self.storage.update_status(
            dlq_message_id,
            DeadMessageStatus.RETRYING
        )
        self.storage.increment_retry(dlq_message_id)

        # 执行重试
        try:
            result = retry_func(dead_message.original_message)

            # 重试成功
            self.storage.update_status(
                dlq_message_id,
                DeadMessageStatus.RESOLVED,
                resolved_at=datetime.now()
            )

            return RetryResult(
                success=True,
                message="Message retry successful",
                new_message_id=result.get("message_id") if isinstance(result, dict) else None,
            )

        except Exception as e:
            # 重试失败，保持状态
            import traceback

            self.storage.update_status(
                dlq_message_id,
                DeadMessageStatus.PENDING
            )

            return RetryResult(
                success=False,
                message=f"Retry failed: {str(e)}",
            )

    def query_pending_messages(
        self,
        limit: int = 100,
        error_type: Optional[str] = None,
    ) -> List[DeadMessage]:
        """
        查询待处理的消息

        Args:
            limit: 返回数量限制
            error_type: 按错误类型筛选

        Returns:
            消息列表
        """
        query = DLQQuery(
            status=DeadMessageStatus.PENDING,
            limit=limit,
            error_type=error_type,
        )

        return self.storage.query_messages(query)

    def get_failed_messages_summary(self, days: int = 7) -> Dict[str, Any]:
        """
        获取失败消息摘要

        Args:
            days: 查询最近多少天的消息

        Returns:
            摘要信息
        """
        date_from = datetime.now() - timedelta(days=days)

        query = DLQQuery(
            date_from=date_from,
            limit=1000,
        )

        messages = self.storage.query_messages(query)
        stats = self.storage.get_statistics()

        # 按错误类型分组
        by_error: Dict[str, int] = {}
        for msg in messages:
            by_error[msg.error_type] = by_error.get(msg.error_type, 0) + 1

        return {
            "period_days": days,
            "total_failed": len(messages),
            "statistics": stats,
            "by_error_type": by_error,
            "recent_failures": [
                {
                    "id": msg.id,
                    "original_message_id": msg.original_message_id,
                    "error_type": msg.error_type,
                    "error_message": msg.error_message,
                    "failed_at": msg.failed_at.isoformat(),
                    "retry_count": msg.retry_count,
                }
                for msg in messages[:10]  # 最近10条
            ],
        }
