"""
消息压缩测试
"""

import pytest
from nanobot.interagent.compression import (
    MessageCompressor,
    CompressionOptions,
    CompressionResult,
    CompressionStats,
    compress_message,
    decompress_message,
    is_compressed_message,
)


def generate_large_text(size: int) -> str:
    """生成测试数据"""
    pattern = "Hello World! 这是一个测试消息。"
    repeats = (size // len(pattern)) + 1
    return (pattern * repeats)[:size]


class TestMessageCompressor:
    """MessageCompressor 测试"""

    def test_default_options(self):
        """应该有默认配置"""
        compressor = MessageCompressor()
        assert compressor.threshold == 1024
        assert compressor.level == 6

    def test_custom_options(self):
        """应该支持自定义配置"""
        compressor = MessageCompressor(threshold=512, level=9)
        assert compressor.threshold == 512
        assert compressor.level == 9

    def test_compress_small_data(self):
        """不应该压缩小数据"""
        compressor = MessageCompressor(threshold=100)
        result = compressor.compress("small")

        assert result.compressed is False
        assert result.data.decode("utf-8") == "small"
        assert result.original_size == 5

    def test_compress_large_data(self):
        """应该压缩大数据"""
        compressor = MessageCompressor(threshold=100)
        large_data = generate_large_text(1000)
        result = compressor.compress(large_data)

        assert result.compressed is True
        assert result.compressed_size < result.original_size

    def test_compress_empty_string(self):
        """应该处理空字符串"""
        compressor = MessageCompressor(threshold=100)
        result = compressor.compress("")

        assert result.compressed is False
        assert result.original_size == 0

    def test_decompress_compressed_data(self):
        """应该解压压缩数据"""
        compressor = MessageCompressor(threshold=100)
        original = generate_large_text(1000)
        compressed = compressor.compress(original)

        assert compressed.compressed is True

        decompressed = compressor.decompress(compressed.data, compressed.compressed)
        assert decompressed == original

    def test_decompress_uncompressed_data(self):
        """应该处理未压缩数据"""
        compressor = MessageCompressor(threshold=100)
        original = "small data"
        result = compressor.compress(original)

        decompressed = compressor.decompress(result.data, result.compressed)
        assert decompressed == original

    def test_statistics_tracking(self):
        """应该跟踪统计"""
        compressor = MessageCompressor(threshold=100)

        # 压缩大数据
        compressor.compress(generate_large_text(1000))
        compressor.compress(generate_large_text(1000))

        # 跳过小数据
        compressor.compress("small")

        stats = compressor.get_stats()
        assert stats.total_compressions == 2
        assert stats.skipped_compressions == 1
        assert stats.total_original_bytes > 0

    def test_decompression_count(self):
        """应该跟踪解压次数"""
        compressor = MessageCompressor(threshold=100)
        compressed = compressor.compress(generate_large_text(1000))

        compressor.decompress(compressed.data, compressed.compressed)
        compressor.decompress(compressed.data, compressed.compressed)

        stats = compressor.get_stats()
        assert stats.total_decompressions == 2

    def test_reset_stats(self):
        """应该重置统计"""
        compressor = MessageCompressor(threshold=100)
        compressor.compress(generate_large_text(1000))
        compressor.reset_stats()

        stats = compressor.get_stats()
        assert stats.total_compressions == 0

    def test_compression_ratio_empty(self):
        """空压缩率应该为 0"""
        compressor = MessageCompressor()
        assert compressor.get_compression_ratio() == 0.0

    def test_compression_ratio_calculation(self):
        """应该正确计算压缩率"""
        compressor = MessageCompressor(threshold=100)
        compressor.compress(generate_large_text(1000))

        ratio = compressor.get_compression_ratio()
        assert 0 < ratio < 1


class TestCompressMessage:
    """compress_message 测试"""

    def test_compress_large_message(self):
        """应该压缩大消息"""
        message = {
            "type": "data",
            "payload": generate_large_text(1000),
        }

        compressor = MessageCompressor(threshold=100)
        result = compress_message(message, compressor)
        import json

        parsed = json.loads(result)

        assert parsed.get("__compressed") is True
        assert "payload" in parsed

    def test_not_compress_small_message(self):
        """不应该压缩小消息"""
        message = {"type": "ping"}
        compressor = MessageCompressor(threshold=100)
        result = compress_message(message, compressor)

        import json

        parsed = json.loads(result)
        assert "__compressed" not in parsed
        assert parsed["type"] == "ping"

    def test_default_compressor(self):
        """应该使用默认压缩器"""
        message = {"type": "test"}
        result = compress_message(message)

        import json

        parsed = json.loads(result)
        assert "type" in parsed


class TestDecompressMessage:
    """decompress_message 测试"""

    def test_decompress_compressed_message(self):
        """应该解压压缩消息"""
        compressor = MessageCompressor(threshold=100)
        original = {"type": "data", "payload": generate_large_text(1000)}
        compressed = compress_message(original, compressor)
        decompressed = decompress_message(compressed, compressor)

        assert decompressed["type"] == original["type"]
        assert decompressed["payload"] == original["payload"]

    def test_handle_uncompressed_message(self):
        """应该处理未压缩消息"""
        original = {"type": "ping"}
        import json

        decompressed = decompress_message(json.dumps(original))
        assert decompressed == original

    def test_default_compressor(self):
        """应该使用默认压缩器"""
        message = {"type": "test"}
        import json

        result = decompress_message(json.dumps(message))
        assert result["type"] == "test"


class TestIsCompressedMessage:
    """is_compressed_message 测试"""

    def test_detect_compressed_message(self):
        """应该检测压缩消息"""
        compressor = MessageCompressor(threshold=100)
        compressed = compress_message(
            {"payload": generate_large_text(1000)}, compressor
        )
        assert is_compressed_message(compressed) is True

    def test_return_false_for_uncompressed(self):
        """未压缩消息应该返回 False"""
        import json

        json_str = json.dumps({"type": "ping"})
        assert is_compressed_message(json_str) is False

    def test_return_false_for_invalid_json(self):
        """无效 JSON 应该返回 False"""
        assert is_compressed_message("not json") is False

    def test_return_false_for_non_dict(self):
        """非字典类型应该返回 False"""
        import json

        assert is_compressed_message(json.dumps([1, 2, 3])) is False
