# 运维手册 - Automaton + Nanobot 双系统

> 版本: 1.0.0 | 更新日期: 2026-02-26

---

## 目录

1. [日常运维](#日常运维)
2. [监控告警](#监控告警)
3. [故障处理](#故障处理)
4. [性能优化](#性能优化)
5. [安全运维](#安全运维)
6. [备份恢复](#备份恢复)

---

## 日常运维

### 健康检查

```bash
# 检查所有服务状态
docker compose ps

# 快速健康检查
curl -s http://localhost:18790/health | jq .
curl -s http://localhost:18792/health | jq .

# 检查 WebSocket 连接
curl -s http://localhost:18790/status | jq '.websocket.clientCount'
```

### 日志管理

```bash
# 查看实时日志
docker compose logs -f --tail=100

# 查看特定服务日志
docker compose logs -f automaton
docker compose logs -f nanobot

# 搜索错误日志
docker compose logs automaton 2>&1 | grep -i error

# 导出日志到文件
docker compose logs --since 1h > logs-$(date +%Y%m%d-%H%M).txt
```

### 资源监控

```bash
# 容器资源使用
docker stats --no-stream

# 磁盘使用
df -h
du -sh ~/.automaton
du -sh ~/.nanobot

# 内存使用
free -h
```

### 定时任务

建议设置以下定时任务:

```cron
# /etc/cron.d/interagent

# 每小时健康检查
0 * * * * root curl -sf http://localhost:18790/health || systemctl restart automaton

# 每天凌晨 2 点备份
0 2 * * * root /opt/autoJieDan/scripts/backup.sh >> /var/log/backup.log 2>&1

# 每周清理旧日志
0 3 * * 0 root docker compose logs --tail=1000 > /var/log/interagent.log && docker compose logs --tail=0
```

---

## 监控告警

### Prometheus 指标

关键指标列表:

| 指标名称 | 类型 | 说明 | 告警阈值 |
|----------|------|------|----------|
| `up{job="automaton"}` | Gauge | Automaton 存活 | == 0 |
| `up{job="nanobot"}` | Gauge | Nanobot 存活 | == 0 |
| `interagent_ws_connections` | Gauge | WebSocket 连接数 | == 0 (>5min) |
| `interagent_tasks_pending` | Gauge | 待处理任务数 | > 100 |
| `interagent_request_latency_ms` | Histogram | 请求延迟 | P99 > 500ms |
| `interagent_dlq_size` | Gauge | 死信队列大小 | > 10 |
| `interagent_tasks_failed_total` | Counter | 失败任务数 | rate > 0.1/s |

### 查询示例

```promql
# WebSocket 连接数
interagent_ws_connections

# P99 延迟
histogram_quantile(0.99, rate(interagent_request_latency_ms_bucket[5m]))

# 任务完成率
rate(interagent_tasks_completed_total{status="success"}[5m])

# 错误率
rate(interagent_tasks_failed_total[5m]) / rate(interagent_tasks_completed_total[5m])
```

### 告警规则

告警规则已配置在 `deploy/prometheus/alerts.yml`:

- **AutomatonDown**: Automaton 服务不可用
- **NanobotDown**: Nanobot 服务不可用
- **NoWebSocketConnections**: 无 WebSocket 连接
- **HighPendingTasks**: 待处理任务过多
- **HighTaskFailureRate**: 任务失败率高
- **HighLatency**: 请求延迟过高
- **DeadLetterQueueGrowing**: 死信队列增长

### Grafana Dashboard

访问 Grafana (http://localhost:3000) 查看:

1. **Interagent Overview**: 系统总览
2. **Connection Metrics**: 连接指标
3. **Task Metrics**: 任务指标
4. **Latency Metrics**: 延迟指标

---

## 故障处理

### 故障排查流程

```
1. 确认故障现象
   ↓
2. 检查服务状态 (docker compose ps)
   ↓
3. 查看日志 (docker compose logs)
   ↓
4. 检查资源使用 (docker stats)
   ↓
5. 检查网络连通性
   ↓
6. 尝试重启服务
   ↓
7. 如无法解决，回滚或恢复备份
```

### 常见故障处理

#### 服务无响应

```bash
# 1. 检查服务状态
docker compose ps

# 2. 检查健康状态
curl http://localhost:18790/health

# 3. 查看日志
docker compose logs --tail=100 automaton

# 4. 重启服务
docker compose restart automaton

# 5. 如重启失败，重建容器
docker compose up -d --force-recreate automaton
```

#### WebSocket 连接断开

```bash
# 1. 检查 WebSocket 服务状态
curl http://localhost:18790/status | jq '.websocket'

# 2. 检查端口监听
netstat -tlnp | grep 18791

# 3. 检查连接数
curl http://localhost:18790/status | jq '.websocket.clientCount'

# 4. 重启 WebSocket 服务
docker compose restart automaton
```

#### 任务处理失败

```bash
# 1. 查看失败任务
curl http://localhost:18790/status | jq '.tasks.failed'

# 2. 检查死信队列
curl http://localhost:18790/metrics | grep dlq_size

# 3. 查看错误日志
docker compose logs automaton | grep -i "task.*failed"

# 4. 手动重试任务 (如果支持)
# curl -X POST http://localhost:18790/api/v1/task/{id}/retry
```

#### 数据库错误

```bash
# 1. 检查数据库文件
ls -la ~/.automaton/*.db

# 2. 检查数据库完整性
sqlite3 ~/.automaton/interagent.db "PRAGMA integrity_check;"

# 3. 如果损坏，从备份恢复
./scripts/restore.sh /backups/latest
```

---

## 性能优化

### 容器资源优化

```yaml
# docker-compose.yml
services:
  automaton:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

### WebSocket 优化

```yaml
# ~/.automaton/interagent.yml
websocket:
  max_connections: 100
  ping_interval_ms: 30000
  connection_timeout_ms: 60000
```

### 数据库优化

```sql
-- 启用 WAL 模式
PRAGMA journal_mode=WAL;

-- 设置缓存大小
PRAGMA cache_size=10000;

-- 定期清理
VACUUM;
```

### 日志优化

```bash
# 限制日志大小
docker compose config --set services.automaton.logging.options.max-size=50m
docker compose config --set services.automaton.logging.options.max-file=5
```

---

## 安全运维

### 密钥管理

```bash
# 检查密钥文件权限
ls -la ~/.automaton/keys/
# 应该是 600

# 修复权限
chmod 600 ~/.automaton/keys/*
chmod 700 ~/.automaton/keys/
```

### 定期密钥轮换

```bash
# 建议每 30 天轮换一次
# 1. 生成新密钥
# 2. 更新配置
# 3. 重启服务
# 4. 验证新密钥
```

### 安全审计

```bash
# 检查开放端口
netstat -tlnp

# 检查 Docker 网络
docker network inspect interagent-network

# 运行安全扫描
trivy image automaton:latest
```

### 访问控制

```yaml
# 限制外部访问
# 只允许特定 IP 访问管理端口
services:
  automaton:
    ports:
      - "127.0.0.1:18790:18790"
```

---

## 备份恢复

### 自动备份

```bash
# 设置每日自动备份
cat > /etc/cron.d/interagent-backup << 'EOF'
0 2 * * * root /opt/autoJieDan/scripts/backup.sh >> /var/log/backup.log 2>&1
EOF
```

### 手动备份

```bash
# 执行备份
BACKUP_PASSWORD=secret BACKUP_DIR=/backups ./scripts/backup.sh

# 验证备份
ls -la /backups/latest/
cat /backups/latest/manifest.json
```

### 恢复操作

```bash
# 1. 停止服务
docker compose down

# 2. 恢复数据
BACKUP_PASSWORD=secret ./scripts/restore.sh /backups/20260226_020000

# 3. 验证恢复
ls -la ~/.automaton/

# 4. 重启服务
docker compose up -d

# 5. 验证服务
curl http://localhost:18790/health
```

### 灾难恢复

完整灾难恢复步骤:

```bash
# 1. 准备新服务器
# 2. 安装 Docker 和 Docker Compose
# 3. 克隆仓库
git clone https://github.com/1123786563/autoJieDan.git
cd autoJieDan

# 4. 复制最新备份到新服务器
scp -r /backups/latest user@new-server:/backups/

# 5. 恢复数据
BACKUP_PASSWORD=secret ./scripts/restore.sh /backups/latest

# 6. 配置环境变量
cp .env.example .env
# 编辑 .env

# 7. 启动服务
docker compose up -d

# 8. 验证
curl http://localhost:18790/health
```

---

## 运维检查清单

### 每日检查

- [ ] 服务健康状态正常
- [ ] 无异常错误日志
- [ ] WebSocket 连接数正常
- [ ] 磁盘空间充足 (>20%)

### 每周检查

- [ ] 备份完整可用
- [ ] 监控告警正常
- [ ] 资源使用率正常
- [ ] 无安全告警

### 每月检查

- [ ] 密钥轮换
- [ ] 日志归档清理
- [ ] 性能报告审查
- [ ] 安全扫描

---

## 联系方式

- **紧急联系**: ops@example.com
- **Issue 追踪**: https://github.com/1123786563/autoJieDan/issues
- **文档更新**: docs/
