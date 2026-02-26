"""
消息压缩模块
实现大消息的 gzip 压缩，减少网络传输量

@module interagent.compression
@version 1.0.0
"""

import gzip
import json
import base64
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Tuple


@dataclass
class CompressionOptions:
    """压缩选项"""

    threshold: int = 1024
    """压缩阈值 (字节)，小于此值不压缩"""

    level: int = 6
    """压缩级别 (1-9)，1 最快，9 最佳压缩"""


@dataclass
class CompressionResult:
    """压缩结果"""

    data: bytes
    """压缩后的数据"""

    compressed: bool
    """是否被压缩"""

    original_size: int
    """原始大小 (字节)"""

    compressed_size: int
    """压缩后大小 (字节)"""


@dataclass
class CompressionStats:
    """压缩统计"""

    total_compressions: int = 0
    """总压缩次数"""

    total_decompressions: int = 0
    """总解压次数"""

    total_original_bytes: int = 0
    """总原始字节数"""

    total_compressed_bytes: int = 0
    """总压缩字节数"""

    skipped_compressions: int = 0
    """跳过压缩次数（数据太小）"""


class MessageCompressor:
    """
    消息压缩器

    使用 gzip 算法压缩数据，支持配置压缩阈值和级别

    Example:
        compressor = MessageCompressor(threshold=512, level=6)

        # 压缩数据
        result = compressor.compress("large text data...")
        print(f"Compressed: {result.compressed}, Ratio: {result.compressed_size / result.original_size}")

        # 解压数据
        original = compressor.decompress(result.data, result.compressed)
    """

    def __init__(
        self,
        threshold: int = 1024,
        level: int = 6,
    ):
        """
        初始化压缩器

        Args:
            threshold: 压缩阈值 (字节)，默认 1KB
            level: 压缩级别 (1-9)，默认 6
        """
        self.threshold = threshold
        self.level = level
        self._stats = CompressionStats()

    def compress(self, data: str) -> CompressionResult:
        """
        压缩数据

        Args:
            data: 要压缩的字符串数据

        Returns:
            CompressionResult: 压缩结果
        """
        raw_bytes = data.encode("utf-8")
        original_size = len(raw_bytes)

        # 小于阈值不压缩
        if original_size < self.threshold:
            self._stats.skipped_compressions += 1
            return CompressionResult(
                data=raw_bytes,
                compressed=False,
                original_size=original_size,
                compressed_size=original_size,
            )

        # 执行压缩
        compressed = gzip.compress(raw_bytes, compresslevel=self.level)
        compressed_size = len(compressed)

        # 如果压缩后反而更大，则不使用压缩
        if compressed_size >= original_size:
            self._stats.skipped_compressions += 1
            return CompressionResult(
                data=raw_bytes,
                compressed=False,
                original_size=original_size,
                compressed_size=original_size,
            )

        # 更新统计
        self._stats.total_compressions += 1
        self._stats.total_original_bytes += original_size
        self._stats.total_compressed_bytes += compressed_size

        return CompressionResult(
            data=compressed,
            compressed=True,
            original_size=original_size,
            compressed_size=compressed_size,
        )

    def decompress(self, data: bytes, compressed: bool) -> str:
        """
        解压数据

        Args:
            data: 要解压的数据
            compressed: 数据是否被压缩

        Returns:
            str: 解压后的字符串
        """
        if not compressed:
            return data.decode("utf-8")

        self._stats.total_decompressions += 1
        decompressed = gzip.decompress(data)
        return decompressed.decode("utf-8")

    def get_stats(self) -> CompressionStats:
        """获取压缩统计"""
        return CompressionStats(
            total_compressions=self._stats.total_compressions,
            total_decompressions=self._stats.total_decompressions,
            total_original_bytes=self._stats.total_original_bytes,
            total_compressed_bytes=self._stats.total_compressed_bytes,
            skipped_compressions=self._stats.skipped_compressions,
        )

    def reset_stats(self) -> None:
        """重置统计"""
        self._stats = CompressionStats()

    def get_compression_ratio(self) -> float:
        """获取压缩率"""
        if self._stats.total_original_bytes == 0:
            return 0.0
        return self._stats.total_compressed_bytes / self._stats.total_original_bytes


# ============================================================================
# Helper Functions
# ============================================================================


def compress_message(
    message: Dict[str, Any],
    compressor: Optional[MessageCompressor] = None,
) -> str:
    """
    压缩消息对象

    将消息对象序列化为 JSON，如果压缩后更小则使用压缩

    Args:
        message: 要压缩的消息对象
        compressor: 压缩器实例，默认创建新实例

    Returns:
        str: 序列化后的字符串（可能包含压缩标记）
    """
    if compressor is None:
        compressor = MessageCompressor()

    json_str = json.dumps(message)
    result = compressor.compress(json_str)

    if result.compressed:
        return json.dumps(
            {
                "__compressed": True,
                "payload": base64.b64encode(result.data).decode("ascii"),
                "originalSize": result.original_size,
            }
        )

    return json_str


def decompress_message(
    raw: str,
    compressor: Optional[MessageCompressor] = None,
) -> Dict[str, Any]:
    """
    解压消息对象

    检测消息是否被压缩，如果是则解压后返回原始对象

    Args:
        raw: 原始消息字符串
        compressor: 压缩器实例，默认创建新实例

    Returns:
        Dict[str, Any]: 解析后的消息对象
    """
    if compressor is None:
        compressor = MessageCompressor()

    parsed = json.loads(raw)

    # 检查是否是压缩格式
    if isinstance(parsed, dict) and parsed.get("__compressed") is True:
        payload = base64.b64decode(parsed["payload"])
        decompressed = compressor.decompress(payload, True)
        return json.loads(decompressed)

    return parsed


def is_compressed_message(raw: str) -> bool:
    """
    检查字符串是否是压缩消息格式

    Args:
        raw: 原始消息字符串

    Returns:
        bool: 是否是压缩消息
    """
    try:
        parsed = json.loads(raw)
        return (
            isinstance(parsed, dict)
            and parsed.get("__compressed") is True
            and "payload" in parsed
        )
    except (json.JSONDecodeError, TypeError):
        return False
