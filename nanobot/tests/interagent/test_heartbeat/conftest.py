"""
心跳机制测试配置
"""

import pytest
import asyncio


@pytest.fixture
def event_loop():
    """创建事件循环"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
