"""
conftest.py for interagent tests
"""

import pytest
import asyncio

# 配置 pytest-asyncio
pytest_plugins = ('pytest_asyncio',)


@pytest.fixture
def event_loop():
    """创建事件循环"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
async def aiohttp_client():
    """aiohttp 测试客户端 fixture"""
    from aiohttp import test_utils

    async def _create_client(app):
        return test_utils.TestClient(test_utils.TestServer(app))

    return _create_client
