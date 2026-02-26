"""
HTTP 连接池管理器
实现 Keep-Alive 连接复用，提升网络请求性能

@module interagent.http.pool
@version 1.0.0
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Union
import aiohttp


@dataclass
class ConnectionPoolConfig:
    """连接池配置"""
    pool_size: int = 50
    """最大连接数"""

    pool_size_per_host: int = 10
    """每个主机的最大连接数"""

    keepalive_timeout: float = 30.0
    """Keep-Alive 超时 (秒)"""

    connect_timeout: float = 10.0
    """连接超时 (秒)"""

    total_timeout: float = 30.0
    """总请求超时 (秒)"""

    force_close: bool = False
    """是否强制关闭连接"""


@dataclass
class PoolStats:
    """连接池统计"""
    total_requests: int = 0
    """总请求数"""

    reused_connections: int = 0
    """复用连接数"""

    active_connections: int = 0
    """活跃连接数"""

    failed_requests: int = 0
    """失败请求数"""


@dataclass
class PoolResponse:
    """响应结果"""
    status: int
    """状态码"""

    status_text: str = ""
    """状态文本"""

    headers: Dict[str, str] = field(default_factory=dict)
    """响应头"""

    body: str = ""
    """响应体"""

    reused: bool = False
    """是否从连接池复用"""


class ConnectionPool:
    """
    HTTP 连接池管理器

    使用 aiohttp 实现 Keep-Alive 连接复用

    Example:
        pool = ConnectionPool(ConnectionPoolConfig(pool_size=50))
        async with pool:
            response = await pool.get('https://example.com/api')
            print(response.status, response.body)

        # 获取统计信息
        stats = pool.get_stats()
        print(f"Reused connections: {stats.reused_connections}")
    """

    _instance: Optional["ConnectionPool"] = None

    def __new__(cls, *args, **kwargs):
        # 单例模式
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, config: Optional[ConnectionPoolConfig] = None):
        if self._initialized:
            return

        self._config = config or ConnectionPoolConfig()
        self._connector: Optional[aiohttp.TCPConnector] = None
        self._session: Optional[aiohttp.ClientSession] = None
        self._stats = PoolStats()
        self._closed = False
        self._initialized = True

    async def __aenter__(self) -> "ConnectionPool":
        """异步上下文管理器入口"""
        await self._ensure_session()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """异步上下文管理器出口"""
        await self.close()

    async def _ensure_session(self) -> aiohttp.ClientSession:
        """确保会话已创建"""
        if self._session is None or self._session.closed:
            self._connector = aiohttp.TCPConnector(
                limit=self._config.pool_size,
                limit_per_host=self._config.pool_size_per_host,
                keepalive_timeout=self._config.keepalive_timeout,
                force_close=self._config.force_close,
            )

            timeout = aiohttp.ClientTimeout(
                connect=self._config.connect_timeout,
                total=self._config.total_timeout,
            )

            self._session = aiohttp.ClientSession(
                connector=self._connector,
                timeout=timeout,
            )

        return self._session

    async def request(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Union[str, bytes, Dict[str, Any]]] = None,
        **kwargs
    ) -> PoolResponse:
        """
        发送 HTTP 请求

        Args:
            method: 请求方法
            url: 请求 URL
            headers: 请求头
            body: 请求体
            **kwargs: 其他 aiohttp 参数

        Returns:
            PoolResponse: 响应结果
        """
        if self._closed:
            raise RuntimeError("Connection pool is closed")

        session = await self._ensure_session()
        self._stats.total_requests += 1

        # 处理请求体
        json_data = None
        data = None
        if isinstance(body, dict):
            json_data = body
            headers = headers or {}
            headers.setdefault("Content-Type", "application/json")
        elif body is not None:
            data = body

        try:
            async with session.request(
                method,
                url,
                headers=headers,
                data=data,
                json=json_data,
                **kwargs
            ) as response:
                response_body = await response.text()

                # 检查是否复用了连接
                reused = response.connection is not None

                if reused:
                    self._stats.reused_connections += 1

                return PoolResponse(
                    status=response.status,
                    status_text=response.reason or "",
                    headers=dict(response.headers),
                    body=response_body,
                    reused=reused,
                )

        except Exception as e:
            self._stats.failed_requests += 1
            raise

    async def get(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> PoolResponse:
        """发送 GET 请求"""
        return await self.request("GET", url, headers=headers, **kwargs)

    async def post(
        self,
        url: str,
        body: Optional[Union[str, bytes, Dict[str, Any]]] = None,
        headers: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> PoolResponse:
        """发送 POST 请求"""
        return await self.request("POST", url, headers=headers, body=body, **kwargs)

    async def put(
        self,
        url: str,
        body: Optional[Union[str, bytes, Dict[str, Any]]] = None,
        headers: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> PoolResponse:
        """发送 PUT 请求"""
        return await self.request("PUT", url, headers=headers, body=body, **kwargs)

    async def delete(
        self,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        **kwargs
    ) -> PoolResponse:
        """发送 DELETE 请求"""
        return await self.request("DELETE", url, headers=headers, **kwargs)

    async def json(
        self,
        method: str,
        url: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Union[str, bytes, Dict[str, Any]]] = None,
        **kwargs
    ) -> Any:
        """
        发送请求并解析 JSON 响应

        Args:
            method: 请求方法
            url: 请求 URL
            headers: 请求头
            body: 请求体

        Returns:
            解析后的 JSON 数据
        """
        headers = headers or {}
        headers.setdefault("Accept", "application/json")

        response = await self.request(method, url, headers=headers, body=body, **kwargs)

        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"HTTP {response.status}: {response.status_text}")

        import json
        return json.loads(response.body)

    def get_stats(self) -> PoolStats:
        """获取连接池统计"""
        stats = PoolStats(
            total_requests=self._stats.total_requests,
            reused_connections=self._stats.reused_connections,
            failed_requests=self._stats.failed_requests,
        )

        if self._connector:
            stats.active_connections = len(self._connector._conns)

        return stats

    async def close(self) -> None:
        """关闭连接池"""
        if self._session and not self._session.closed:
            await self._session.close()
            self._session = None

        if self._connector:
            await self._connector.close()
            self._connector = None

        self._closed = True

    def is_closed(self) -> bool:
        """检查连接池是否已关闭"""
        return self._closed

    def reset_stats(self) -> None:
        """重置统计"""
        self._stats = PoolStats()

    @classmethod
    def _reset_instance(cls) -> None:
        """重置单例实例（仅用于测试）"""
        cls._instance = None


# ============================================================================
# 全局连接池实例
# ============================================================================

_global_pool: Optional[ConnectionPool] = None


def get_global_pool() -> ConnectionPool:
    """获取全局连接池"""
    global _global_pool
    if _global_pool is None:
        _global_pool = ConnectionPool()
    return _global_pool


def set_global_pool(pool: ConnectionPool) -> None:
    """设置全局连接池"""
    global _global_pool
    _global_pool = pool


async def pool_request(
    method: str,
    url: str,
    headers: Optional[Dict[str, str]] = None,
    body: Optional[Union[str, bytes, Dict[str, Any]]] = None,
    **kwargs
) -> PoolResponse:
    """使用全局连接池发送请求"""
    return await get_global_pool().request(method, url, headers=headers, body=body, **kwargs)


async def pool_get(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    **kwargs
) -> PoolResponse:
    """使用全局连接池发送 GET 请求"""
    return await get_global_pool().get(url, headers=headers, **kwargs)


async def pool_post(
    url: str,
    body: Optional[Union[str, bytes, Dict[str, Any]]] = None,
    headers: Optional[Dict[str, str]] = None,
    **kwargs
) -> PoolResponse:
    """使用全局连接池发送 POST 请求"""
    return await get_global_pool().post(url, body=body, headers=headers, **kwargs)
