"""
测试重试与指数退避模块
"""

import pytest
import asyncio
import time
from datetime import datetime

from nanobot.interagent.retry import (
    BackoffStrategy,
    JitterType,
    RetryConfig,
    RetryContext,
    RetryResult,
    RetryExecutor,
    calculate_base_delay,
    apply_jitter,
    calculate_delay,
    sleep_async,
    sleep_sync,
    retry_async,
    retry_sync,
    retry_safe_async,
    retry_safe_sync,
    with_retry,
    is_retryable_error,
    format_retry_config,
    DEFAULT_RETRY_CONFIG,
    FAST_RETRY_CONFIG,
    STANDARD_RETRY_CONFIG,
    PERSISTENT_RETRY_CONFIG,
    NETWORK_RETRY_CONFIG,
)


class TestBackoffCalculations:
    """测试退避计算"""

    def test_exponential_backoff(self):
        """测试指数退避"""
        config = RetryConfig(
            initial_delay_ms=1000,
            max_delay_ms=100000,
            backoff_strategy=BackoffStrategy.EXPONENTIAL,
            multiplier=2,
        )

        assert calculate_base_delay(1, config) == 1000
        assert calculate_base_delay(2, config) == 2000
        assert calculate_base_delay(3, config) == 4000
        assert calculate_base_delay(4, config) == 8000

    def test_linear_backoff(self):
        """测试线性退避"""
        config = RetryConfig(
            initial_delay_ms=500,
            max_delay_ms=100000,
            backoff_strategy=BackoffStrategy.LINEAR,
        )

        assert calculate_base_delay(1, config) == 500
        assert calculate_base_delay(2, config) == 1000
        assert calculate_base_delay(3, config) == 1500

    def test_fixed_backoff(self):
        """测试固定退避"""
        config = RetryConfig(
            initial_delay_ms=1000,
            max_delay_ms=100000,
            backoff_strategy=BackoffStrategy.FIXED,
        )

        assert calculate_base_delay(1, config) == 1000
        assert calculate_base_delay(5, config) == 1000
        assert calculate_base_delay(10, config) == 1000

    def test_max_delay_limit(self):
        """测试最大延迟限制"""
        config = RetryConfig(
            initial_delay_ms=1000,
            max_delay_ms=5000,
            backoff_strategy=BackoffStrategy.EXPONENTIAL,
            multiplier=2,
        )

        assert calculate_base_delay(10, config) == 5000

    def test_no_jitter(self):
        """测试无抖动"""
        config = RetryConfig(
            jitter_type=JitterType.NONE,
            jitter_factor=0.5,
        )

        delay = apply_jitter(1000, config)
        assert delay == 1000

    def test_full_jitter(self):
        """测试完全抖动"""
        config = RetryConfig(
            jitter_type=JitterType.FULL,
            jitter_factor=0.5,
        )

        for _ in range(100):
            delay = apply_jitter(1000, config)
            assert 0 <= delay <= 1000

    def test_equal_jitter(self):
        """测试等差抖动"""
        config = RetryConfig(
            jitter_type=JitterType.EQUAL,
            jitter_factor=0.5,
        )

        for _ in range(100):
            delay = apply_jitter(1000, config)
            assert 500 <= delay <= 1000

    def test_decorrelated_jitter(self):
        """测试去相关抖动"""
        config = RetryConfig(
            jitter_type=JitterType.DECORRELATED,
            jitter_factor=0.5,
        )

        for _ in range(100):
            delay = apply_jitter(1000, config)
            assert 0 <= delay <= 3000

    def test_calculate_delay_combines_base_and_jitter(self):
        """测试延迟计算组合基础和抖动"""
        config = RetryConfig(
            initial_delay_ms=1000,
            max_delay_ms=100000,
            backoff_strategy=BackoffStrategy.FIXED,
            jitter_type=JitterType.NONE,
        )

        delay = calculate_delay(1, config)
        assert delay == 1000

    def test_calculate_delay_uses_default_config(self):
        """测试延迟计算使用默认配置"""
        delay = calculate_delay(1)
        assert delay >= 0


class TestRetryExecutor:
    """测试重试执行器"""

    @pytest.mark.asyncio
    async def test_success_on_first_attempt(self):
        """测试首次成功"""
        executor = RetryExecutor()
        result = await executor.execute_async(lambda: "success")

        assert result.success is True
        assert result.value == "success"
        assert result.total_attempts == 1
        assert result.exhausted is False

    @pytest.mark.asyncio
    async def test_retry_on_failure(self):
        """测试失败后重试"""
        attempts = 0

        async def failing_then_success():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise Exception("Temporary failure")
            return "success"

        executor = RetryExecutor(RetryConfig(
            max_retries=3,
            initial_delay_ms=10,
            jitter_type=JitterType.NONE,
        ))

        result = await executor.execute_async(failing_then_success)

        assert result.success is True
        assert result.total_attempts == 3

    @pytest.mark.asyncio
    async def test_exhaust_retries(self):
        """测试重试耗尽"""
        executor = RetryExecutor(RetryConfig(
            max_retries=2,
            initial_delay_ms=10,
            jitter_type=JitterType.NONE,
        ))

        result = await executor.execute_async(lambda: (_ for _ in ()).throw(Exception("Permanent failure")))

        assert result.success is False
        assert "Permanent failure" in result.error
        assert result.total_attempts == 3  # 1 initial + 2 retries
        assert result.exhausted is True

    @pytest.mark.asyncio
    async def test_retryable_errors(self):
        """测试可重试错误"""
        attempts = 0

        def raise_temp_error():
            nonlocal attempts
            attempts += 1
            raise TemporaryError("Temporary failure")

        executor = RetryExecutor(RetryConfig(
            max_retries=3,
            initial_delay_ms=10,
            jitter_type=JitterType.NONE,
            retryable_errors=["TemporaryError"],
        ))

        result = await executor.execute_async(raise_temp_error)

        assert result.success is False
        assert result.total_attempts == 4

    @pytest.mark.asyncio
    async def test_non_retryable_errors(self):
        """测试不可重试错误"""
        executor = RetryExecutor(RetryConfig(
            max_retries=3,
            initial_delay_ms=10,
            retryable_errors=["NetworkError"],
        ))

        result = await executor.execute_async(lambda: (_ for _ in ()).throw(ValidationError("Validation failed")))

        assert result.success is False
        assert result.total_attempts == 1
        assert result.exhausted is False

    @pytest.mark.asyncio
    async def test_custom_should_retry(self):
        """测试自定义重试判断"""
        attempts = 0

        def should_retry(error, context):
            return "retry" in str(error) and context.attempt < 3

        executor = RetryExecutor(RetryConfig(
            max_retries=5,
            initial_delay_ms=10,
        ))
        executor.set_should_retry(should_retry)

        def raise_retry_error():
            nonlocal attempts
            attempts += 1
            raise Exception("Please retry")

        result = await executor.execute_async(raise_retry_error)

        assert result.total_attempts == 3

    @pytest.mark.asyncio
    async def test_track_total_wait_time(self):
        """测试跟踪总等待时间"""
        attempts = 0

        def failing_twice():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise Exception("Retry")
            return "done"

        executor = RetryExecutor(RetryConfig(
            max_retries=2,
            initial_delay_ms=50,
            max_delay_ms=100,
            backoff_strategy=BackoffStrategy.FIXED,
            jitter_type=JitterType.NONE,
        ))

        result = await executor.execute_async(failing_twice)

        # 两次重试，每次约50ms
        assert result.total_wait_ms >= 80

    @pytest.mark.asyncio
    async def test_async_function(self):
        """测试异步函数"""
        executor = RetryExecutor(RetryConfig(max_retries=2, initial_delay_ms=10))

        async def async_operation():
            return await asyncio.sleep(0, result="async result")

        result = await executor.execute_async(async_operation)

        assert result.success is True
        assert result.value == "async result"

    def test_sync_success_on_first_attempt(self):
        """测试同步首次成功"""
        executor = RetryExecutor()
        result = executor.execute_sync(lambda: "success")

        assert result.success is True
        assert result.value == "success"

    def test_sync_retry_on_failure(self):
        """测试同步失败后重试"""
        attempts = 0

        def failing_then_success():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise Exception("Temporary failure")
            return "success"

        executor = RetryExecutor(RetryConfig(
            max_retries=3,
            initial_delay_ms=10,
            jitter_type=JitterType.NONE,
        ))

        result = executor.execute_sync(failing_then_success)

        assert result.success is True
        assert result.total_attempts == 3

    @pytest.mark.asyncio
    async def test_emit_events(self):
        """测试事件发射"""
        events = []

        executor = RetryExecutor(RetryConfig(max_retries=2, initial_delay_ms=10))
        executor.on(lambda e: events.append(e["type"]))

        await executor.execute_async(lambda: "success")

        assert "attempt" in events
        assert "success" in events

    @pytest.mark.asyncio
    async def test_emit_failure_and_exhausted_events(self):
        """测试失败和耗尽事件"""
        events = []

        executor = RetryExecutor(RetryConfig(max_retries=1, initial_delay_ms=10))
        executor.on(lambda e: events.append(e["type"]))

        await executor.execute_async(lambda: (_ for _ in ()).throw(Exception("fail")))

        assert "attempt" in events
        assert "failure" in events
        assert "exhausted" in events


class TestConvenienceFunctions:
    """测试便捷函数"""

    @pytest.mark.asyncio
    async def test_retry_async_success(self):
        """测试异步重试成功"""
        result = await retry_async(lambda: "success")
        assert result == "success"

    @pytest.mark.asyncio
    async def test_retry_async_exhaustion(self):
        """测试异步重试耗尽"""
        with pytest.raises(Exception) as exc_info:
            await retry_async(
                lambda: (_ for _ in ()).throw(Exception("fail")),
                RetryConfig(max_retries=1, initial_delay_ms=10)
            )

        assert "Retry exhausted" in str(exc_info.value)

    def test_retry_sync_success(self):
        """测试同步重试成功"""
        result = retry_sync(lambda: "success")
        assert result == "success"

    def test_retry_sync_exhaustion(self):
        """测试同步重试耗尽"""
        with pytest.raises(Exception) as exc_info:
            retry_sync(
                lambda: (_ for _ in ()).throw(Exception("fail")),
                RetryConfig(max_retries=1, initial_delay_ms=10)
            )

        assert "Retry exhausted" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_retry_safe_async_success(self):
        """测试安全异步重试成功"""
        result = await retry_safe_async(lambda: "success")
        assert result.success is True
        assert result.value == "success"

    @pytest.mark.asyncio
    async def test_retry_safe_async_no_throw(self):
        """测试安全异步重试不抛出异常"""
        result = await retry_safe_async(
            lambda: (_ for _ in ()).throw(Exception("fail")),
            RetryConfig(max_retries=1, initial_delay_ms=10)
        )

        assert result.success is False
        assert "fail" in result.error

    def test_retry_safe_sync_success(self):
        """测试安全同步重试成功"""
        result = retry_safe_sync(lambda: "success")
        assert result.success is True
        assert result.value == "success"

    def test_retry_safe_sync_no_throw(self):
        """测试安全同步重试不抛出异常"""
        result = retry_safe_sync(
            lambda: (_ for _ in ()).throw(Exception("fail")),
            RetryConfig(max_retries=1, initial_delay_ms=10)
        )

        assert result.success is False
        assert "fail" in result.error

    @pytest.mark.asyncio
    async def test_sleep_async(self):
        """测试异步延迟"""
        start = time.time()
        await sleep_async(50)
        elapsed = (time.time() - start) * 1000

        assert elapsed >= 40

    def test_sleep_sync(self):
        """测试同步延迟"""
        start = time.time()
        sleep_sync(50)
        elapsed = (time.time() - start) * 1000

        assert elapsed >= 40


class TestDecorator:
    """测试装饰器"""

    @pytest.mark.asyncio
    async def test_with_retry_async(self):
        """测试异步装饰器"""
        attempts = 0

        @with_retry(RetryConfig(max_retries=3, initial_delay_ms=10))
        async def async_operation():
            nonlocal attempts
            attempts += 1
            if attempts < 2:
                raise Exception("Temporary failure")
            return "success"

        result = await async_operation()
        assert result == "success"
        assert attempts == 2

    def test_with_retry_sync(self):
        """测试同步装饰器"""
        attempts = 0

        @with_retry(RetryConfig(max_retries=3, initial_delay_ms=10))
        def sync_operation():
            nonlocal attempts
            attempts += 1
            if attempts < 2:
                raise Exception("Temporary failure")
            return "success"

        result = sync_operation()
        assert result == "success"
        assert attempts == 2


class TestHelperFunctions:
    """测试辅助函数"""

    def test_is_retryable_error_by_name(self):
        """测试通过名称判断可重试错误"""
        error = TemporaryError("message")
        assert is_retryable_error(error, ["Temporary"]) is True

    def test_is_retryable_error_by_message(self):
        """测试通过消息判断可重试错误"""
        error = Exception("Connection timeout")
        assert is_retryable_error(error, ["timeout"]) is True

    def test_is_retryable_error_no_match(self):
        """测试不匹配的可重试错误"""
        error = ValidationError("Validation failed")
        assert is_retryable_error(error, ["network", "timeout"]) is False

    def test_format_retry_config(self):
        """测试格式化重试配置"""
        config = RetryConfig(
            max_retries=3,
            initial_delay_ms=1000,
            max_delay_ms=10000,
            backoff_strategy=BackoffStrategy.EXPONENTIAL,
            jitter_type=JitterType.FULL,
        )

        formatted = format_retry_config(config)

        assert "maxRetries: 3" in formatted
        assert "initialDelay: 1000ms" in formatted
        assert "maxDelay: 10000ms" in formatted
        assert "strategy: exponential" in formatted
        assert "jitter: full" in formatted


class TestPredefinedConfigs:
    """测试预定义配置"""

    def test_fast_retry_config(self):
        """测试快速重试配置"""
        assert FAST_RETRY_CONFIG.max_retries == 2
        assert FAST_RETRY_CONFIG.initial_delay_ms == 100

    def test_standard_retry_config(self):
        """测试标准重试配置"""
        assert STANDARD_RETRY_CONFIG.max_retries == 3
        assert STANDARD_RETRY_CONFIG.initial_delay_ms == 1000

    def test_persistent_retry_config(self):
        """测试持久重试配置"""
        assert PERSISTENT_RETRY_CONFIG.max_retries == 10
        assert PERSISTENT_RETRY_CONFIG.max_delay_ms == 60000

    def test_network_retry_config(self):
        """测试网络重试配置"""
        assert NETWORK_RETRY_CONFIG.retryable_errors is not None
        assert "ECONNRESET" in NETWORK_RETRY_CONFIG.retryable_errors

    def test_default_config(self):
        """测试默认配置"""
        assert DEFAULT_RETRY_CONFIG.max_retries == 3
        assert DEFAULT_RETRY_CONFIG.initial_delay_ms == 1000
        assert DEFAULT_RETRY_CONFIG.max_delay_ms == 30000
        assert DEFAULT_RETRY_CONFIG.backoff_strategy == BackoffStrategy.EXPONENTIAL
        assert DEFAULT_RETRY_CONFIG.jitter_type == JitterType.FULL


# 测试用异常类
class TemporaryError(Exception):
    """临时错误"""
    pass


class ValidationError(Exception):
    """验证错误"""
    pass
