"""
Day 39: 性能基准测试

测试系统性能基准：
- 任务吞吐量测试
- 响应时间测试
- 并发处理测试
- 安全组件性能
"""

import os
import shutil
import time
import pytest
import asyncio
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

from nanobot.interagent.key_manager import (
    KeyManager,
    MemoryKeyStorage,
    KeyManagerConfig,
    create_key_manager,
)
from nanobot.interagent.tls_manager import (
    TLSManager,
    TLSManagerConfig,
    CertificateType,
    KeyType,
    CertificateSubject,
    create_tls_manager,
)
from nanobot.interagent.access_control import (
    AccessControlManager,
    AccessControlConfig,
    Subject,
    SubjectType,
    ResourceType,
    PermissionAction,
    AccessRequest,
    create_access_control_manager,
)


class TestTaskThroughputBenchmarks:
    """任务吞吐量基准测试"""

    def test_task_creation_throughput(self):
        """测试任务创建吞吐量"""
        task_count = 100
        tasks = []

        start_time = time.time()
        for i in range(task_count):
            task = {
                "id": f"task-{i}",
                "type": "throughput_test",
                "priority": "normal",
                "status": "pending",
                "payload": {"index": i},
                "target_agent": "test-agent",
            }
            tasks.append(task)

        duration = time.time() - start_time
        throughput = task_count / duration

        print(f"Task creation throughput: {throughput:.2f} tasks/sec")
        print(f"Total time for {task_count} tasks: {duration * 1000:.2f}ms")

        # 基准：应该能处理至少 1000 tasks/sec
        assert throughput > 1000
        assert len(tasks) == task_count

    def test_task_status_update_throughput(self):
        """测试任务状态更新吞吐量"""
        task = {
            "id": "task-update",
            "type": "update_test",
            "status": "pending",
        }

        update_count = 100
        start_time = time.time()

        for i in range(update_count):
            if i % 2 == 0:
                task["status"] = "running"
            else:
                task["status"] = "pending"

        duration = time.time() - start_time
        throughput = update_count / duration

        print(f"Status update throughput: {throughput:.2f} updates/sec")
        print(f"Total time for {update_count} updates: {duration * 1000:.2f}ms")

        # 基准：应该能处理至少 50000 updates/sec
        assert throughput > 50000

    def test_task_query_throughput(self):
        """测试任务查询吞吐量"""
        tasks = {
            f"task-{i}": {
                "id": f"task-{i}",
                "type": "query_test",
                "status": "pending" if i % 2 == 0 else "running",
            }
            for i in range(50)
        }

        def get_pending_tasks():
            return [t for t in tasks.values() if t["status"] == "pending"]

        query_count = 100
        start_time = time.time()

        for _ in range(query_count):
            get_pending_tasks()

        duration = time.time() - start_time
        throughput = query_count / duration

        print(f"Query throughput: {throughput:.2f} queries/sec")
        print(f"Total time for {query_count} queries: {duration * 1000:.2f}ms")

        # 基准：应该能处理至少 10000 queries/sec
        assert throughput > 10000


class TestResponseTimeBenchmarks:
    """响应时间基准测试"""

    def test_task_creation_latency(self):
        """测试任务创建延迟"""
        latencies = []

        for i in range(50):
            start_time = time.time()
            task = {
                "id": f"task-latency-{i}",
                "type": "latency_test",
                "priority": "normal",
                "status": "pending",
                "payload": {"index": i},
            }
            latencies.append((time.time() - start_time) * 1000)  # ms

        avg_latency = sum(latencies) / len(latencies)
        max_latency = max(latencies)
        min_latency = min(latencies)

        print(f"Task creation latency - Avg: {avg_latency:.2f}ms, Max: {max_latency:.2f}ms, Min: {min_latency:.2f}ms")

        # 基准：平均延迟应小于 1ms
        assert avg_latency < 1

    def test_access_control_check_latency(self):
        """测试访问控制检查延迟"""
        ac_manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )

        user = Subject(
            id="perf-user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(user)

        latencies = []

        for i in range(100):
            start_time = time.time()
            ac_manager.check_access(
                AccessRequest(
                    subject_id="perf-user",
                    resource=ResourceType.TASK,
                    resource_id=f"task-{i}",
                    action=PermissionAction.READ,
                )
            )
            latencies.append((time.time() - start_time) * 1000)  # ms

        avg_latency = sum(latencies) / len(latencies)
        max_latency = max(latencies)

        print(f"Access control latency - Avg: {avg_latency:.2f}ms, Max: {max_latency:.2f}ms")

        # 基准：平均延迟应小于 1ms
        assert avg_latency < 1

        ac_manager.close()


class TestConcurrencyBenchmarks:
    """并发处理基准测试"""

    def test_concurrent_task_creation(self):
        """测试并发任务创建"""
        concurrency = 10
        tasks_per_batch = 10

        def create_tasks(batch_id):
            tasks = []
            for i in range(tasks_per_batch):
                task = {
                    "id": f"task-concurrent-{batch_id}-{i}",
                    "type": "concurrent_test",
                    "status": "pending",
                    "payload": {"batch": batch_id, "index": i},
                }
                tasks.append(task)
            return tasks

        start_time = time.time()

        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(create_tasks, i) for i in range(concurrency)]
            all_tasks = []
            for future in futures:
                all_tasks.extend(future.result())

        duration = time.time() - start_time
        total_tasks = concurrency * tasks_per_batch
        throughput = total_tasks / duration

        print(f"Concurrent creation throughput: {throughput:.2f} tasks/sec")
        print(f"Created {total_tasks} tasks in {duration * 1000:.2f}ms with {concurrency} concurrent writers")

        # 基准：并发创建应该能处理至少 500 tasks/sec
        assert throughput > 500
        assert len(all_tasks) == total_tasks

    def test_concurrent_read_write_operations(self):
        """测试并发读写操作"""
        tasks = {f"task-{i}": {"id": f"task-{i}", "status": "pending"} for i in range(20)}
        results = []

        def read_task(task_id):
            return tasks.get(task_id)

        def write_task(task_id):
            tasks[task_id]["status"] = "running"
            return tasks[task_id]

        operations = 100
        start_time = time.time()

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = []
            for i in range(operations):
                task_id = f"task-{i % 20}"
                if i % 2 == 0:
                    futures.append(executor.submit(read_task, task_id))
                else:
                    futures.append(executor.submit(write_task, task_id))

            for future in futures:
                results.append(future.result())

        duration = time.time() - start_time
        throughput = operations / duration

        print(f"Concurrent R/W throughput: {throughput:.2f} ops/sec")
        print(f"Completed {operations} operations in {duration * 1000:.2f}ms")

        # 基准：应该能处理至少 1000 ops/sec
        assert throughput > 1000


class TestSecurityComponentBenchmarks:
    """安全组件性能基准测试"""

    @pytest.fixture
    def managers(self):
        """创建管理器实例"""
        test_cert_store = "./test-perf-certs"

        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

        storage = MemoryKeyStorage()
        key_manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
            )
        )

        tls_manager = create_tls_manager(
            TLSManagerConfig(
                cert_store_path=test_cert_store,
                auto_renew=False,
            )
        )

        yield key_manager, tls_manager

        key_manager.close()
        tls_manager.close()

        if os.path.exists(test_cert_store):
            shutil.rmtree(test_cert_store)

    def test_key_generation_performance(self, managers):
        """测试密钥生成性能"""
        key_manager, _ = managers
        key_count = 20

        start_time = time.time()
        for i in range(key_count):
            key_manager.generate_key(
                purpose="encryption",
                name=f"perf-key-{i}",
            )

        duration = time.time() - start_time
        throughput = key_count / duration

        print(f"Key generation throughput: {throughput:.2f} keys/sec")
        print(f"Generated {key_count} keys in {duration * 1000:.2f}ms")

        # 基准：应该能生成至少 5 keys/sec
        assert throughput > 5

    def test_certificate_generation_performance(self, managers):
        """测试证书生成性能"""
        _, tls_manager = managers
        cert_count = 10

        start_time = time.time()
        for i in range(cert_count):
            subject = CertificateSubject(common_name=f"perf-cert-{i}.example.com")
            tls_manager.generate_self_signed_certificate(
                cert_type=CertificateType.SERVER,
                subject=subject,
                days=365,
                key_type=KeyType.RSA,
            )

        duration = time.time() - start_time
        throughput = cert_count / duration

        print(f"Certificate generation throughput: {throughput:.2f} certs/sec")
        print(f"Generated {cert_count} certificates in {duration * 1000:.2f}ms")

        # 基准：应该能生成至少 2 certs/sec
        assert throughput > 2

    def test_certificate_validation_performance(self, managers):
        """测试证书验证性能"""
        _, tls_manager = managers

        # 生成测试证书
        subject = CertificateSubject(common_name="validation-test.example.com")
        _, _, cert_info = tls_manager.generate_self_signed_certificate(
            cert_type=CertificateType.SERVER,
            subject=subject,
            days=365,
            key_type=KeyType.RSA,
        )

        validation_count = 100
        start_time = time.time()

        for _ in range(validation_count):
            tls_manager.validate_certificate(cert_info.id)

        duration = time.time() - start_time
        throughput = validation_count / duration

        print(f"Certificate validation throughput: {throughput:.2f} validations/sec")
        print(f"Validated {validation_count} times in {duration * 1000:.2f}ms")

        # 基准：应该能验证至少 500 certs/sec
        assert throughput > 500


class TestPerformanceSummary:
    """性能摘要"""

    def test_generate_performance_summary(self):
        """生成性能摘要"""
        results = []

        # 任务创建
        start_time = time.time()
        tasks = []
        for i in range(50):
            task = {
                "id": f"task-summary-{i}",
                "type": "summary_test",
                "status": "pending",
            }
            tasks.append(task)
        results.append({
            "operation": "Task Creation (50)",
            "duration": (time.time() - start_time) * 1000,
            "count": 50,
        })

        # 访问控制检查
        ac_manager = create_access_control_manager(
            AccessControlConfig(
                default_policy="deny",
                enable_inheritance=True,
                enable_conditions=True,
            )
        )

        user = Subject(
            id="summary-user",
            type=SubjectType.USER,
            roles=["user"],
            attributes={},
            created_at=datetime.now(),
        )
        ac_manager.register_subject(user)

        start_time = time.time()
        for i in range(100):
            ac_manager.check_access(
                AccessRequest(
                    subject_id="summary-user",
                    resource=ResourceType.TASK,
                    resource_id=f"task-{i}",
                    action=PermissionAction.READ,
                )
            )
        results.append({
            "operation": "Access Check (100)",
            "duration": (time.time() - start_time) * 1000,
            "count": 100,
        })

        ac_manager.close()

        # 密钥生成
        storage = MemoryKeyStorage()
        key_manager = create_key_manager(
            KeyManagerConfig(
                storage=storage,
                auto_rotate=False,
            )
        )

        start_time = time.time()
        for i in range(10):
            key_manager.generate_key(
                purpose="encryption",
                name=f"summary-key-{i}",
            )
        results.append({
            "operation": "Key Generation (10)",
            "duration": (time.time() - start_time) * 1000,
            "count": 10,
        })

        key_manager.close()

        # 输出摘要
        print("\n=== Performance Summary ===")
        for result in results:
            throughput = result["count"] / (result["duration"] / 1000)
            print(f"{result['operation']}: {result['duration']:.2f}ms ({throughput:.2f} ops/sec)")
        print("===========================\n")

        assert len(results) == 3
