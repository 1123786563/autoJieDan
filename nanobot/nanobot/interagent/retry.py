"""
重试与指数退避机制
提供可配置的重试策略和抖动算法

@module nanobot.interagent.retry
@version 1.0.0
"""

import asyncio
import random
import math
from typing import Optional, List, Dict, Any, Callable, TypeVar, Generic
from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
from functools import wraps


# ============================================================================
# 类型定义
# ============================================================================

class BackoffStrategy(str, Enum):
    """退避策略类型"""
    EXPONENTIAL = "exponential"    # 指数退避
    LINEAR = "linear"              # 线性退避
    FIXED = "fixed"                # 固定间隔
    DECORRELATED = "decorrelated"  # 去相关抖动


class JitterType(str, Enum):
    """抖动类型"""
    NONE = "none"           # 无抖动
    FULL = "full"           # 完全抖动
    EQUAL = "equal"         # 等差抖动
    DECORRELATED = "decorrelated"  # 去相关抖动


@dataclass
class RetryConfig:
    """重试配置"""
    max_retries: int = 3
    initial_delay_ms: int = 1000
    max_delay_ms: int = 30000
    backoff_strategy: BackoffStrategy = BackoffStrategy.EXPONENTIAL
    jitter_type: JitterType = JitterType.FULL
    jitter_factor: float = 0.5
    multiplier: float = 2.0
    retryable_errors: Optional[List[str]] = None
    timeout_ms: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "maxRetries": self.max_retries,
            "initialDelayMs": self.initial_delay_ms,
            "maxDelayMs": self.max_delay_ms,
            "backoffStrategy": self.backoff_strategy.value,
            "jitterType": self.jitter_type.value,
            "jitterFactor": self.jitter_factor,
            "multiplier": self.multiplier,
            "retryableErrors": self.retryable_errors,
            "timeoutMs": self.timeout_ms,
        }


@dataclass
class RetryContext:
    """重试上下文"""
    attempt: int
    max_attempts: int
    last_error: Optional[Exception] = None
    last_delay_ms: int = 0
    total_wait_ms: int = 0
    start_time: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "attempt": self.attempt,
            "maxAttempts": self.max_attempts,
            "lastError": str(self.last_error) if self.last_error else None,
            "lastDelayMs": self.last_delay_ms,
            "totalWaitMs": self.total_wait_ms,
            "startTime": self.start_time.isoformat(),
        }


@dataclass
class RetryResult(Generic[TypeVar('T')]):
    """重试结果"""
    success: bool
    value: Optional[Any] = None
    error: Optional[str] = None
    total_attempts: int = 0
    total_wait_ms: int = 0
    exhausted: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "value": self.value,
            "error": self.error,
            "totalAttempts": self.total_attempts,
            "totalWaitMs": self.total_wait_ms,
            "exhausted": self.exhausted,
        }


# ============================================================================
# 默认配置
# ============================================================================

DEFAULT_RETRY_CONFIG = RetryConfig()


# ============================================================================
# 退避计算
# ============================================================================

def calculate_base_delay(attempt: int, config: RetryConfig) -> int:
    """
    计算基础退避时间

    Args:
        attempt: 当前尝试次数
        config: 重试配置

    Returns:
        基础延迟时间（毫秒）
    """
    initial_delay = config.initial_delay_ms
    max_delay = config.max_delay_ms
    multiplier = config.multiplier

    if config.backoff_strategy == BackoffStrategy.EXPONENTIAL:
        delay = initial_delay * (multiplier ** (attempt - 1))
    elif config.backoff_strategy == BackoffStrategy.LINEAR:
        delay = initial_delay * attempt
    elif config.backoff_strategy == BackoffStrategy.FIXED:
        delay = initial_delay
    elif config.backoff_strategy == BackoffStrategy.DECORRELATED:
        delay = min(initial_delay * multiplier, max_delay)
    else:
        delay = initial_delay

    return int(min(delay, max_delay))


def apply_jitter(delay: int, config: RetryConfig) -> int:
    """
    应用抖动

    Args:
        delay: 基础延迟时间
        config: 重试配置

    Returns:
        应用抖动后的延迟时间
    """
    if config.jitter_type == JitterType.NONE or config.jitter_factor <= 0:
        return delay

    if config.jitter_type == JitterType.FULL:
        # 完全抖动：[0, delay]
        return int(random.random() * delay)
    elif config.jitter_type == JitterType.EQUAL:
        # 等差抖动：[delay/2, delay]
        return int(delay / 2 + random.random() * (delay / 2))
    elif config.jitter_type == JitterType.DECORRELATED:
        # 去相关抖动：[0, delay * 3]
        return int(random.random() * delay * 3)

    return delay


def calculate_delay(attempt: int, config: Optional[RetryConfig] = None) -> int:
    """
    计算下一次重试的延迟时间

    Args:
        attempt: 当前尝试次数
        config: 重试配置（可选）

    Returns:
        延迟时间（毫秒）
    """
    config = config or DEFAULT_RETRY_CONFIG
    base_delay = calculate_base_delay(attempt, config)
    delay_with_jitter = apply_jitter(base_delay, config)

    return min(int(delay_with_jitter), config.max_delay_ms)


# ============================================================================
# 延迟工具
# ============================================================================

async def sleep_async(ms: int) -> None:
    """
    异步延迟

    Args:
        ms: 延迟时间（毫秒）
    """
    await asyncio.sleep(ms / 1000)


def sleep_sync(ms: int) -> None:
    """
    同步延迟

    Args:
        ms: 延迟时间（毫秒）
    """
    import time
    time.sleep(ms / 1000)


# ============================================================================
# 重试执行器
# ============================================================================

# 类型变量
T = TypeVar('T')


class RetryExecutor(Generic[T]):
    """
    重试执行器
    提供灵活的重试机制
    """

    def __init__(self, config: Optional[RetryConfig] = None):
        """
        初始化执行器

        Args:
            config: 重试配置
        """
        self.config = config or DEFAULT_RETRY_CONFIG
        self._listeners: List[Callable] = []
        self._should_retry_fn: Optional[Callable[[Exception, RetryContext], bool]] = None

    def set_should_retry(
        self,
        fn: Callable[[Exception, RetryContext], bool]
    ) -> "RetryExecutor[T]":
        """
        设置可重试判断函数

        Args:
            fn: 判断函数

        Returns:
            self
        """
        self._should_retry_fn = fn
        return self

    def on(self, listener: Callable) -> "RetryExecutor[T]":
        """
        添加事件监听器

        Args:
            listener: 监听函数

        Returns:
            self
        """
        self._listeners.append(listener)
        return self

    def off(self, listener: Callable) -> "RetryExecutor[T]":
        """
        移除事件监听器

        Args:
            listener: 监听函数

        Returns:
            self
        """
        if listener in self._listeners:
            self._listeners.remove(listener)
        return self

    async def execute_async(
        self,
        fn: Callable[[], T]
    ) -> RetryResult:
        """
        执行带重试的异步函数

        Args:
            fn: 要执行的函数

        Returns:
            重试结果
        """
        start_time = datetime.now()
        max_attempts = self.config.max_retries + 1
        last_error: Optional[Exception] = None
        total_wait_ms = 0
        last_delay_ms = 0

        for attempt in range(1, max_attempts + 1):
            context = RetryContext(
                attempt=attempt,
                max_attempts=max_attempts,
                last_error=last_error,
                last_delay_ms=last_delay_ms,
                total_wait_ms=total_wait_ms,
                start_time=start_time,
            )

            try:
                # 发射尝试事件
                self._emit("attempt", context)

                # 执行函数
                result = fn()
                if asyncio.iscoroutine(result):
                    result = await result

                # 成功
                retry_result = RetryResult(
                    success=True,
                    value=result,
                    total_attempts=attempt,
                    total_wait_ms=total_wait_ms,
                    exhausted=False,
                )

                self._emit("success", context)
                return retry_result

            except Exception as e:
                last_error = e

                # 检查是否应该重试
                should_retry = self._should_retry(attempt, e, context)

                if not should_retry or attempt >= max_attempts:
                    exhausted = attempt >= max_attempts
                    retry_result = RetryResult(
                        success=False,
                        error=str(e),
                        total_attempts=attempt,
                        total_wait_ms=total_wait_ms,
                        exhausted=exhausted,
                    )

                    self._emit("exhausted" if exhausted else "failure", context, e)
                    return retry_result

                # 计算延迟
                last_delay_ms = calculate_delay(attempt, self.config)

                # 发射失败事件
                self._emit("failure", context, e)

                # 等待
                await sleep_async(last_delay_ms)
                total_wait_ms += last_delay_ms

        # 理论上不会到达这里
        return RetryResult(
            success=False,
            error=str(last_error) or "Unknown error",
            total_attempts=max_attempts,
            total_wait_ms=total_wait_ms,
            exhausted=True,
        )

    def execute_sync(self, fn: Callable[[], T]) -> RetryResult:
        """
        执行带重试的同步函数

        Args:
            fn: 要执行的函数

        Returns:
            重试结果
        """
        start_time = datetime.now()
        max_attempts = self.config.max_retries + 1
        last_error: Optional[Exception] = None
        total_wait_ms = 0
        last_delay_ms = 0

        for attempt in range(1, max_attempts + 1):
            context = RetryContext(
                attempt=attempt,
                max_attempts=max_attempts,
                last_error=last_error,
                last_delay_ms=last_delay_ms,
                total_wait_ms=total_wait_ms,
                start_time=start_time,
            )

            try:
                # 发射尝试事件
                self._emit("attempt", context)

                # 执行函数
                result = fn()

                # 成功
                retry_result = RetryResult(
                    success=True,
                    value=result,
                    total_attempts=attempt,
                    total_wait_ms=total_wait_ms,
                    exhausted=False,
                )

                self._emit("success", context)
                return retry_result

            except Exception as e:
                last_error = e

                # 检查是否应该重试
                should_retry = self._should_retry(attempt, e, context)

                if not should_retry or attempt >= max_attempts:
                    exhausted = attempt >= max_attempts
                    retry_result = RetryResult(
                        success=False,
                        error=str(e),
                        total_attempts=attempt,
                        total_wait_ms=total_wait_ms,
                        exhausted=exhausted,
                    )

                    self._emit("exhausted" if exhausted else "failure", context, e)
                    return retry_result

                # 计算延迟
                last_delay_ms = calculate_delay(attempt, self.config)

                # 发射失败事件
                self._emit("failure", context, e)

                # 等待
                sleep_sync(last_delay_ms)
                total_wait_ms += last_delay_ms

        # 理论上不会到达这里
        return RetryResult(
            success=False,
            error=str(last_error) or "Unknown error",
            total_attempts=max_attempts,
            total_wait_ms=total_wait_ms,
            exhausted=True,
        )

    def _should_retry(
        self,
        attempt: int,
        error: Exception,
        context: RetryContext
    ) -> bool:
        """
        判断是否应该重试

        Args:
            attempt: 当前尝试次数
            error: 错误
            context: 重试上下文

        Returns:
            是否应该重试
        """
        # 使用自定义判断函数
        if self._should_retry_fn:
            return self._should_retry_fn(error, context)

        # 检查可重试错误类型
        if self.config.retryable_errors:
            error_name = type(error).__name__
            error_message = str(error)
            return any(
                pattern in error_name or pattern in error_message
                for pattern in self.config.retryable_errors
            )

        # 默认重试
        return True

    def _emit(
        self,
        event_type: str,
        context: RetryContext,
        error: Optional[Exception] = None
    ) -> None:
        """
        发射事件

        Args:
            event_type: 事件类型
            context: 重试上下文
            error: 错误（可选）
        """
        event = {
            "type": event_type,
            "context": context,
            "timestamp": datetime.now(),
            "error": error,
        }

        for listener in self._listeners:
            try:
                listener(event)
            except Exception:
                pass  # 忽略监听器错误


# ============================================================================
# 便捷函数
# ============================================================================

async def retry_async(
    fn: Callable[[], T],
    config: Optional[RetryConfig] = None
) -> T:
    """
    带重试执行异步函数

    Args:
        fn: 要执行的函数
        config: 重试配置

    Returns:
        函数结果

    Raises:
        Exception: 重试耗尽后抛出异常
    """
    executor = RetryExecutor[T](config)
    result = await executor.execute_async(fn)

    if result.success:
        return result.value

    raise Exception(
        f"Retry exhausted after {result.total_attempts} attempts: {result.error}"
    )


def retry_sync(
    fn: Callable[[], T],
    config: Optional[RetryConfig] = None
) -> T:
    """
    带重试执行同步函数

    Args:
        fn: 要执行的函数
        config: 重试配置

    Returns:
        函数结果

    Raises:
        Exception: 重试耗尽后抛出异常
    """
    executor = RetryExecutor[T](config)
    result = executor.execute_sync(fn)

    if result.success:
        return result.value

    raise Exception(
        f"Retry exhausted after {result.total_attempts} attempts: {result.error}"
    )


async def retry_safe_async(
    fn: Callable[[], T],
    config: Optional[RetryConfig] = None
) -> RetryResult:
    """
    带重试执行异步函数（返回结果而非抛出异常）

    Args:
        fn: 要执行的函数
        config: 重试配置

    Returns:
        重试结果
    """
    executor = RetryExecutor[T](config)
    return await executor.execute_async(fn)


def retry_safe_sync(
    fn: Callable[[], T],
    config: Optional[RetryConfig] = None
) -> RetryResult:
    """
    带重试执行同步函数（返回结果而非抛出异常）

    Args:
        fn: 要执行的函数
        config: 重试配置

    Returns:
        重试结果
    """
    executor = RetryExecutor[T](config)
    return executor.execute_sync(fn)


# ============================================================================
# 装饰器
# ============================================================================

def with_retry(config: Optional[RetryConfig] = None):
    """
    重试装饰器

    Args:
        config: 重试配置

    Returns:
        装饰器函数
    """
    def decorator(fn: Callable[..., T]) -> Callable[..., T]:
        @wraps(fn)
        async def async_wrapper(*args, **kwargs):
            async def execute():
                result = fn(*args, **kwargs)
                if asyncio.iscoroutine(result):
                    return await result
                return result
            return await retry_async(execute, config)

        @wraps(fn)
        def sync_wrapper(*args, **kwargs):
            return retry_sync(lambda: fn(*args, **kwargs), config)

        if asyncio.iscoroutinefunction(fn):
            return async_wrapper
        return sync_wrapper

    return decorator


# ============================================================================
# 预定义配置
# ============================================================================

# 快速重试配置（短间隔，少次数）
FAST_RETRY_CONFIG = RetryConfig(
    max_retries=2,
    initial_delay_ms=100,
    max_delay_ms=1000,
    backoff_strategy=BackoffStrategy.EXPONENTIAL,
    jitter_type=JitterType.FULL,
)

# 标准重试配置
STANDARD_RETRY_CONFIG = RetryConfig(
    max_retries=3,
    initial_delay_ms=1000,
    max_delay_ms=10000,
    backoff_strategy=BackoffStrategy.EXPONENTIAL,
    jitter_type=JitterType.EQUAL,
)

# 持久重试配置（长间隔，多次数）
PERSISTENT_RETRY_CONFIG = RetryConfig(
    max_retries=10,
    initial_delay_ms=1000,
    max_delay_ms=60000,
    backoff_strategy=BackoffStrategy.EXPONENTIAL,
    jitter_type=JitterType.DECORRELATED,
)

# 网络请求重试配置
NETWORK_RETRY_CONFIG = RetryConfig(
    max_retries=5,
    initial_delay_ms=500,
    max_delay_ms=30000,
    backoff_strategy=BackoffStrategy.EXPONENTIAL,
    jitter_type=JitterType.FULL,
    retryable_errors=["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "network"],
)


# ============================================================================
# 工具函数
# ============================================================================

def is_retryable_error(error: Exception, retryable_patterns: List[str]) -> bool:
    """
    检查错误是否可重试

    Args:
        error: 错误
        retryable_patterns: 可重试的模式列表

    Returns:
        是否可重试
    """
    error_string = f"{type(error).__name__} {str(error)}".lower()
    return any(
        pattern.lower() in error_string
        for pattern in retryable_patterns
    )


def create_timed_executor(
    config: Optional[RetryConfig],
    timeout_ms: int
) -> RetryExecutor:
    """
    创建带超时的重试执行器

    Args:
        config: 重试配置
        timeout_ms: 超时时间

    Returns:
        重试执行器
    """
    final_config = config or DEFAULT_RETRY_CONFIG
    final_config.timeout_ms = timeout_ms
    return RetryExecutor(final_config)


def format_retry_config(config: RetryConfig) -> str:
    """
    格式化重试配置

    Args:
        config: 重试配置

    Returns:
        格式化字符串
    """
    return ", ".join([
        f"maxRetries: {config.max_retries}",
        f"initialDelay: {config.initial_delay_ms}ms",
        f"maxDelay: {config.max_delay_ms}ms",
        f"strategy: {config.backoff_strategy.value}",
        f"jitter: {config.jitter_type.value}",
    ])
