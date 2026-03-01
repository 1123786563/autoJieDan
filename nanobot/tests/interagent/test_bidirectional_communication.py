"""
T011: 双向通信测试

测试 Automaton 和 Nanobot 之间的双向通信：
- WebSocket 连接池基本功能
- 消息发送和接收（使用回调模式）
- 并发消息处理
- 连接池统计

验收标准: 双向消息延迟<5s
"""

import asyncio
import pytest
import json
from datetime import datetime
from typing import List, Dict, Any, Optional
from unittest.mock import Mock, AsyncMock

import websockets
from websockets.server import serve

from nanobot.interagent.websocket import (
    WebSocketConnectionPool,
    PoolConfig as ConnectionPoolConfig,
    PoolStats,
    WebSocketConfig,
)
from ulid import ULID


class TestBidirectionalCommunication:
    """双向通信测试"""

    @pytest.fixture
    async def echo_server(self):
        """创建测试用的 WebSocket echo 服务器"""

        port = 18765
        clients = []

        async def handler(websocket):
            clients.append(websocket)
            async for message in websocket:
                # Echo message back
                await websocket.send(message)

        server = await serve(handler, "127.0.0.1", port)

        yield {
            "port": port,
            "clients": clients,
        }

        # 清理
        for client in clients:
            try:
                await client.close()
            except Exception:
                pass

        server.close()
        await server.wait_closed()

    @pytest.fixture
    async def pool(self, echo_server):
        """创建测试用的连接池"""
        port = echo_server["port"]

        ws_config = WebSocketConfig(url=f"ws://127.0.0.1:{port}")
        pool_config = ConnectionPoolConfig(
            min_size=1,
            max_size=5,
            acquire_timeout=5.0,
            idle_timeout=60.0,
        )

        connection_pool = WebSocketConnectionPool(ws_config, pool_config)
        await connection_pool.start()

        yield connection_pool

        await connection_pool.stop()

    class TestBasicMessaging:
        """测试基本消息发送和接收"""

        @pytest.mark.asyncio
        async def test_pool_send_and_receive(self, pool):
            """应该能通过连接池发送和接收消息（使用回调）"""
            message = {
                "type": "task.progress",
                "source": "did:anp:automaton:main",
                "target": "did:anp:nanobot:main",
                "timestamp": datetime.utcnow().isoformat(),
                "correlationId": str(ULID()),
                "payload": {
                    "taskId": str(ULID()),
                    "progress": 50,
                    "currentPhase": "testing",
                    "completedSteps": ["step1"],
                    "nextSteps": ["step2"],
                },
            }

            start_time = datetime.utcnow()
            received_future: asyncio.Future = asyncio.Future()

            def on_message(response: dict):
                if not received_future.done():
                    received_future.set_result(response)

            # 发送消息并等待 echo 响应
            async with await pool.acquire(on_message=on_message) as conn:
                send_success = await conn.send(message)
                assert send_success is True

                # 等待回调接收响应
                try:
                    response = await asyncio.wait_for(received_future, timeout=5.0)
                except asyncio.TimeoutError:
                    response = None

            latency = (datetime.utcnow() - start_time).total_seconds()

            assert response is not None
            assert response["type"] == message["type"]
            assert response["payload"]["progress"] == 50
            assert latency < 5.0  # 验收标准: 延迟<5s

        @pytest.mark.asyncio
        async def test_message_routing_to_target_did(self, pool):
            """应该能正确设置消息的目标 DID"""
            target_did = "did:anp:test:specific"

            message = {
                "type": "task.progress",
                "source": "did:anp:automaton:main",
                "target": target_did,
                "timestamp": datetime.utcnow().isoformat(),
                "payload": {
                    "taskId": str(ULID()),
                    "progress": 75,
                },
            }

            received_future: asyncio.Future = asyncio.Future()

            def on_message(response: dict):
                if not received_future.done():
                    received_future.set_result(response)

            async with await pool.acquire(on_message=on_message) as conn:
                await conn.send(message)

                try:
                    response = await asyncio.wait_for(received_future, timeout=5.0)
                except asyncio.TimeoutError:
                    response = None

            assert response is not None
            assert response["target"] == target_did

    class TestConcurrentMessaging:
        """测试并发消息处理"""

        @pytest.mark.asyncio
        async def test_sequential_messages(self, pool):
            """应该能按顺序发送多条消息"""
            message_count = 10
            responses: List[dict] = []
            response_events: List[asyncio.Event] = []

            for _ in range(message_count):
                response_events.append(asyncio.Event())

            response_index = 0

            def on_message(response: dict):
                nonlocal response_index
                responses.append(response)
                if response_index < len(response_events):
                    response_events[response_index].set()
                    response_index += 1

            async with await pool.acquire(on_message=on_message) as conn:
                for i in range(message_count):
                    message = {
                        "type": "task.progress",
                        "source": "did:anp:automaton:main",
                        "target": "did:anp:test:sequential",
                        "timestamp": datetime.utcnow().isoformat(),
                        "payload": {
                            "taskId": str(ULID()),
                            "progress": i,
                        },
                    }

                    await conn.send(message)

                    # 等待响应
                    try:
                        await asyncio.wait_for(response_events[i].wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        pass

            assert len(responses) >= message_count * 0.9  # 允许10%丢失

        @pytest.mark.asyncio
        async def test_concurrent_connections(self, echo_server):
            """应该能处理多个并发连接"""
            port = echo_server["port"]

            ws_config = WebSocketConfig(url=f"ws://127.0.0.1:{port}")
            pool_config = ConnectionPoolConfig(
                min_size=2,
                max_size=10,
                acquire_timeout=5.0,
                idle_timeout=60.0,
            )

            test_pool = WebSocketConnectionPool(ws_config, pool_config)
            await test_pool.start()

            try:
                concurrent_count = 5
                results: List[Optional[dict]] = [None] * concurrent_count

                async def send_and_receive(idx: int):
                    received_future: asyncio.Future = asyncio.Future()

                    def on_message(response: dict):
                        if not received_future.done():
                            received_future.set_result(response)

                    async with await test_pool.acquire(on_message=on_message) as conn:
                        message = {
                            "type": "test",
                            "idx": idx,
                            "timestamp": datetime.utcnow().isoformat(),
                        }
                        await conn.send(message)

                        try:
                            response = await asyncio.wait_for(received_future, timeout=5.0)
                            results[idx] = response
                        except asyncio.TimeoutError:
                            pass

                # 并发发送
                tasks = [send_and_receive(i) for i in range(concurrent_count)]
                await asyncio.gather(*tasks)

                # 验证至少收到大部分响应
                successful = sum(1 for r in results if r is not None)
                assert successful >= concurrent_count * 0.8  # 80%成功率

            finally:
                await test_pool.stop()

    class TestConnectionPoolStats:
        """测试连接池统计功能"""

        @pytest.mark.asyncio
        async def test_pool_stats_tracking(self, pool):
            """应该正确追踪连接池统计"""
            initial_stats = pool.get_stats()

            received_future: asyncio.Future = asyncio.Future()

            def on_message(response: dict):
                if not received_future.done():
                    received_future.set_result(response)

            async with await pool.acquire(on_message=on_message) as conn:
                message = {
                    "type": "test",
                    "timestamp": datetime.utcnow().isoformat(),
                }
                await conn.send(message)

                try:
                    await asyncio.wait_for(received_future, timeout=5.0)
                except asyncio.TimeoutError:
                    pass

            final_stats = pool.get_stats()

            # 验证统计被更新
            assert final_stats.total_acquisitions >= initial_stats.total_acquisitions + 1
            assert final_stats.total_messages_sent >= initial_stats.total_messages_sent + 1

    class TestErrorHandling:
        """测试错误处理"""

        @pytest.mark.asyncio
        async def test_connection_failure_error(self):
            """应该在连接失败时抛出异常"""
            # 创建一个连接到无效端口的连接池
            invalid_config = WebSocketConfig(url="ws://127.0.0.1:19999")
            pool_config = ConnectionPoolConfig(
                min_size=1,
                max_size=5,
                acquire_timeout=2.0,  # 短超时
                idle_timeout=60.0,
            )
            invalid_pool = WebSocketConnectionPool(invalid_config, pool_config)

            await invalid_pool.start()

            try:
                # 应该在获取连接时抛出异常
                with pytest.raises((asyncio.TimeoutError, RuntimeError, Exception)):
                    async with await invalid_pool.acquire() as conn:
                        await conn.send({"test": "data"})
            finally:
                await invalid_pool.stop()

        @pytest.mark.asyncio
        async def test_send_on_disconnected_connection(self, pool):
            """应该在断开连接上发送消息时返回 False"""
            async with await pool.acquire() as conn:
                # 模拟连接已断开
                if conn._conn:
                    conn._conn.state.connected = False

                message = {
                    "type": "test",
                    "timestamp": datetime.utcnow().isoformat(),
                }

                # 发送应该返回 False（连接断开）
                result = await conn.send(message)
                assert result is False

    class TestPerformanceLatency:
        """测试性能和延迟"""

        @pytest.mark.asyncio
        async def test_message_latency(self, pool):
            """应该满足消息延迟<5s的验收标准"""
            iterations = 20
            latencies = []

            for i in range(iterations):
                received_future: asyncio.Future = asyncio.Future()

                def on_message(response: dict):
                    if not received_future.done():
                        received_future.set_result(response)

                async with await pool.acquire(on_message=on_message) as conn:
                    message = {
                        "type": "task.progress",
                        "source": "did:anp:automaton:main",
                        "target": "did:anp:test:latency",
                        "timestamp": datetime.utcnow().isoformat(),
                        "payload": {
                            "taskId": str(ULID()),
                            "progress": i,
                        },
                    }

                    start_time = datetime.utcnow()
                    await conn.send(message)

                    try:
                        await asyncio.wait_for(received_future, timeout=5.0)
                        latency = (datetime.utcnow() - start_time).total_seconds()
                        latencies.append(latency)
                    except asyncio.TimeoutError:
                        pass

            assert len(latencies) >= iterations * 0.9  # 90%成功率
            avg_latency = sum(latencies) / len(latencies) if latencies else 0
            max_latency = max(latencies) if latencies else 0

            assert avg_latency < 1.0  # 平均延迟应小于 1s
            assert max_latency < 5.0  # 最大延迟应小于 5s

        @pytest.mark.asyncio
        async def test_throughput(self, pool):
            """应该达到足够的吞吐量"""
            message_count = 50
            received_count = 0
            received_events: List[asyncio.Event] = []

            for _ in range(message_count):
                received_events.append(asyncio.Event())

            event_index = 0

            def on_message(response: dict):
                nonlocal event_index
                nonlocal received_count
                received_count += 1
                if event_index < len(received_events):
                    received_events[event_index].set()
                    event_index += 1

            start_time = datetime.utcnow()

            async with await pool.acquire(on_message=on_message) as conn:
                for i in range(message_count):
                    message = {
                        "type": "task.progress",
                        "idx": i,
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    await conn.send(message)

                # 等待所有响应
                for event in received_events:
                    try:
                        await asyncio.wait_for(event.wait(), timeout=10.0)
                    except asyncio.TimeoutError:
                        pass

            total_time = (datetime.utcnow() - start_time).total_seconds()
            throughput = received_count / total_time if total_time > 0 else 0

            # 验证吞吐量（至少 5 消息/秒，考虑到等待响应）
            assert throughput > 5

    class TestConnectionLifecycle:
        """测试连接生命周期"""

        @pytest.mark.asyncio
        async def test_connection_reuse(self, pool):
            """应该能重用连接"""
            # 第一次使用
            async with await pool.acquire() as conn1:
                conn1_id = conn1.id
                received_future: asyncio.Future = asyncio.Future()

                def on_message(response: dict):
                    if not received_future.done():
                        received_future.set_result(response)

                conn1._conn.message_handler = on_message
                await conn1.send({"test": 1})

                try:
                    await asyncio.wait_for(received_future, timeout=5.0)
                except asyncio.TimeoutError:
                    pass

            # 第二次使用 - 应该重用同一个连接
            async with await pool.acquire() as conn2:
                conn2_id = conn2.id
                received_future2: asyncio.Future = asyncio.Future()

                def on_message2(response: dict):
                    if not received_future2.done():
                        received_future2.set_result(response)

                conn2._conn.message_handler = on_message2
                await conn2.send({"test": 2})

                try:
                    await asyncio.wait_for(received_future2, timeout=5.0)
                except asyncio.TimeoutError:
                    pass

            # 连接应该被重用
            stats = pool.get_stats()
            assert stats.reused_connections >= 1

        @pytest.mark.asyncio
        async def test_pool_start_stop(self, echo_server):
            """应该能正确启动和停止连接池"""
            port = echo_server["port"]

            ws_config = WebSocketConfig(url=f"ws://127.0.0.1:{port}")
            pool_config = ConnectionPoolConfig(
                min_size=1,
                max_size=5,
            )

            test_pool = WebSocketConnectionPool(ws_config, pool_config)

            # 启动
            await test_pool.start()
            assert test_pool.is_running() is True

            # 使用
            received_future: asyncio.Future = asyncio.Future()

            def on_message(response: dict):
                if not received_future.done():
                    received_future.set_result(response)

            async with await test_pool.acquire(on_message=on_message) as conn:
                await conn.send({"test": "data"})

                try:
                    response = await asyncio.wait_for(received_future, timeout=5.0)
                    assert response["test"] == "data"
                except asyncio.TimeoutError:
                    pass  # 消息可能未到达，但不影响启动/停止测试

            # 停止
            await test_pool.stop()
            assert test_pool.is_running() is False
