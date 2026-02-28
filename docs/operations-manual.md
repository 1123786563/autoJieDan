# 运维手册 | autoJieDan

> Conway Automaton + Nanobot 双系统运维指南

## 目录

- [日常运维](#日常运维)
- [监控告警](#监控告警)
- [日志管理](#日志管理)
- [故障处理](#故障处理)
- [性能优化](#性能优化)
- [安全管理](#安全管理)
- [备份策略](#备份策略)

---

## 日常运维

### 服务管理

**启动服务:**
```bash
# 启动所有服务
docker compose up -d

# 启动指定服务
docker compose up -d automaton nanobot

# 启动监控栈
docker compose --profile monitoring up -d
```

**停止服务:**
```bash
# 停止所有服务
docker compose down

# 停止并删除数据卷（谨慎）
docker compose down -v

# 停止指定服务
docker compose stop automaton
```

**重启服务:**
```bash
# 重启所有服务
docker compose restart

# 重启指定服务
docker compose restart automaton

# 优雅重启（等待现有连接完成）
docker compose restart -t 30 automaton
```

**查看状态:**
```bash
# 查看所有服务状态
docker compose ps

# 查看服务资源使用
docker stats

# 查看服务详情
docker inspect autojiedan-automaton-1
```

### 日志查看

**实时日志:**
```bash
# 查看所有服务日志
docker compose logs -f

# 查看指定服务日志
docker compose logs -f automaton
docker compose logs -f nanobot

# 查看最近 100 行
docker compose logs --tail=100 automaton
```

**日志过滤:**
```bash
# 只看错误日志
docker compose logs automaton | grep -i error

# 只看警告日志
docker compose logs automaton | grep -i warn

# 按时间过滤
docker compose logs --since=2024-02-27T00:00:00 automaton
```

### 健康检查

**自动化健康检查:**
```bash
# 执行健康检查脚本
./scripts/health-check.sh

# 手动检查
curl http://localhost:18790/health
curl http://localhost:18792/health

# 检查 WebSocket 连接
curl --include \
  --no-buffer \
  --header "Connection: Upgrade" \
  --header "Upgrade: websocket" \
  --header "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  --header "Sec-WebSocket-Version: 13" \
  http://localhost:18791/
```

### 配置管理

**查看配置:**
```bash
# 查看环境变量
docker compose exec automaton env
docker compose exec nanobot env

# 查看配置文件
docker compose exec automaton cat /app/config.json
```

**更新配置:**
```bash
# 1. 编辑 .env 文件
nano .env

# 2. 重启服务应用配置
docker compose restart

# 3. 验证配置生效
docker compose logs --tail=50 automaton
```

---

## 监控告警

### Prometheus 指标

**关键指标:**

| 指标名称 | 类型 | 描述 | 告警阈值 |
|---------|------|------|---------|
| `interagent_ws_connections` | Gauge | WebSocket 连接数 | < 1 |
| `interagent_tasks_pending` | Gauge | 待处理任务数 | > 1000 |
| `interagent_request_latency_ms` | Histogram | 请求延迟 (p95) | > 5000ms |
| `interagent_tasks_completed_total` | Counter | 完成任务总数 | - |
| `interagent_tasks_failed_total` | Counter | 失败任务总数 | 增长率 > 10% |
| `interagent_dlq_size` | Gauge | 死信队列大小 | > 100 |

**查询示例:**
```promql
# WebSocket 连接数
interagent_ws_connections

# 请求延迟 (p95)
histogram_quantile(0.95, interagent_request_latency_ms_bucket)

# 任务失败率
rate(interagent_tasks_failed_total[5m]) / rate(interagent_tasks_completed_total[5m])

# 死信队列大小趋势
interagent_dlq_size[1h]
```

### Grafana 仪表板

**预配置仪表板:**

1. **系统概览**
   - 服务状态
   - 资源使用
   - 请求吞吐量

2. **Interagent 通信**
   - WebSocket 连接
   - 任务队列
   - 消息延迟

3. **错误追踪**
   - 错误率
   - 超时统计
   - 死信队列

**访问 Grafana:**
```bash
# 启动监控栈
docker compose --profile monitoring up -d

# 访问面板
open http://localhost:3000

# 默认账号
admin / admin (首次登录需修改)
```

### 告警规则

**Prometheus 告警配置:**

```yaml
# alerting/interagent-rules.yml
groups:
  - name: interagent_alerts
    interval: 30s
    rules:
      - alert: HighTaskQueue
        expr: interagent_tasks_pending > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "任务队列积压"
          description: "待处理任务数超过 1000"

      - alert: HighFailureRate
        expr: rate(interagent_tasks_failed_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "任务失败率过高"
          description: "任务失败率超过 10%"

      - alert: WebSocketDisconnected
        expr: interagent_ws_connections < 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "WebSocket 连接断开"
          description: "Automaton 和 Nanobot 之间的 WebSocket 连接断开"

      - alert: HighLatency
        expr: histogram_quantile(0.95, interagent_request_latency_ms_bucket) > 5000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "请求延迟过高"
          description: "P95 延迟超过 5 秒"
```

### 告警通知

**配置 AlertManager:**

```yaml
# alerting/alertmanager.yml
global:
  resolve_timeout: 5m

route:
  group_by: ['alertname', 'cluster']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'default'

receivers:
  - name: 'default'
    email_configs:
      - to: 'ops@example.com'
        from: 'alertmanager@example.com'
        smarthost: 'smtp.example.com:587'
        auth_username: 'alertmanager@example.com'
        auth_password: 'password'

    slack_configs:
      - api_url: 'https://hooks.slack.com/services/...'
        channel: '#alerts'
```

---

## 日志管理

### 日志级别

| 级别 | 用途 | 示例场景 |
|-----|------|---------|
| `error` | 错误 | 服务不可用、操作失败 |
| `warn` | 警告 | 重试操作、降级服务 |
| `info` | 信息 | 服务启动、正常操作 |
| `debug` | 调试 | 详细执行信息 |

**调整日志级别:**
```bash
# 编辑 .env
LOG_LEVEL=debug

# 重启服务
docker compose restart
```

### ELK 日志聚合

**启动日志栈:**
```bash
docker compose --profile logging up -d

# 访问 Kibana
open http://localhost:5601
```

**Kibana 配置:**

1. 创建索引模式：`autojiedan-*`
2. 配置时间字段：`@timestamp`
3. 创建日志仪表板

**常用查询:**
```json
// 错误日志
{
  "query": {
    "match": {
      "level": "error"
    }
  }
}

// 特定服务
{
  "query": {
    "match": {
      "service": "automaton"
    }
  }
}

// 时间范围
{
  "query": {
    "range": {
      "@timestamp": {
        "gte": "now-1h"
      }
    }
  }
}
```

### 日志轮转

**Docker 日志配置:**

```yaml
# docker-compose.yml
services:
  automaton:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

**日志清理:**
```bash
# 清理旧日志
docker compose logs --tail=0 -f

# 清理 Docker 日志
docker system prune -a
```

---

## 故障处理

### 常见故障

**1. 服务启动失败**

**症状:**
```bash
docker compose up -d
# Error: port is already allocated
```

**解决方案:**
```bash
# 检查端口占用
lsof -i :18790
lsof -i :18792

# 杀死占用进程
kill -9 <PID>

# 或修改端口
nano .env
AUTOMATON_HTTP_PORT=18791
```

**2. Interagent 通信失败**

**症状:**
```bash
# WebSocket 连接失败
Error: WebSocket connection refused
```

**诊断:**
```bash
# 检查网络连接
docker compose exec nanobot ping automaton

# 检查端口监听
docker compose exec automaton netstat -tlnp

# 检查密钥一致性
docker compose exec automaton env | grep INTERAGENT_SECRET
docker compose exec nanobot env | grep INTERAGENT_SECRET
```

**解决方案:**
```bash
# 确保 INTERAGENT_SECRET 一致
nano .env
# INTERAGENT_SECRET=相同的值

# 重启服务
docker compose restart automaton nanobot
```

**3. 内存泄漏**

**症状:**
```bash
docker stats
# 内存持续增长
```

**诊断:**
```bash
# 查看内存使用
docker stats --no-stream

# 查看进程详情
docker compose exec automaton ps aux
```

**解决方案:**
```bash
# 增加内存限制
# 编辑 docker-compose.yml
services:
  automaton:
    deploy:
      resources:
        limits:
          memory: 8G

# 定期重启
docker compose restart automaton
```

**4. 数据库锁定**

**症状:**
```bash
Error: database is locked
```

**解决方案:**
```bash
# 检查锁定进程
docker compose exec automaton lsof /app/data/*.db

# 杀死锁定进程
kill -9 <PID>

# 或使用 WAL 模式
# 编辑配置
PRAGMA journal_mode=WAL;
```

### 故障排查流程

**1. 信息收集**
```bash
# 服务状态
docker compose ps

# 最近日志
docker compose logs --tail=100

# 资源使用
docker stats

# 网络连接
docker network inspect autojiedan_default
```

**2. 隔离问题**
```bash
# 测试单个服务
docker compose up automaton

# 检查依赖
docker compose exec automaton curl http://nanobot:18792/health
```

**3. 解决问题**
```bash
# 重启服务
docker compose restart <service>

# 重建服务
docker compose up -d --build <service>

# 回滚版本
git checkout <previous-tag>
docker compose up -d --build
```

---

## 性能优化

### 资源调优

**1. CPU 限制**

```yaml
# docker-compose.yml
services:
  automaton:
    deploy:
      resources:
        limits:
          cpus: '2.0'
        reservations:
          cpus: '1.0'
```

**2. 内存优化**

```yaml
services:
  automaton:
    environment:
      - NODE_OPTIONS=--max-old-space-size=4096
```

**3. Worker 线程**

```bash
# 增加工作线程
WORKER_COUNT=4

# 启用并发处理
ENABLE_PARALLEL_PROCESSING=true
```

### 缓存策略

**1. 启用 Redis 缓存**

```yaml
# docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  automaton:
    environment:
      - REDIS_URL=redis://redis:6379
      - ENABLE_CACHE=true
```

**2. 配置缓存 TTL**

```bash
# 短期缓存（5分钟）
CACHE_TTL=300

# 长期缓存（1小时）
LONG_CACHE_TTL=3600
```

### 数据库优化

**1. SQLite 优化**

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;  -- 64MB
PRAGMA temp_store = MEMORY;
```

**2. 索引优化**

```sql
CREATE INDEX IF NOT EXISTS idx_tasks_created
ON tasks(created_at);

CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks(status);
```

### 网络优化

**1. 启用压缩**

```bash
# 启用 gzip 压缩
ENABLE_COMPRESSION=true

# 压缩级别
COMPRESSION_LEVEL=6
```

**2. 连接池**

```bash
# 连接池大小
CONNECTION_POOL_SIZE=10

# 连接超时
CONNECTION_TIMEOUT=30000
```

---

## 安全管理

### 密钥管理

**1. 生成强密钥**

```bash
# 生成 INTERAGENT_SECRET
openssl rand -hex 32

# 生成 JWT 密钥
openssl rand -base64 32
```

**2. 密钥轮换**

```bash
# 1. 生成新密钥
NEW_SECRET=$(openssl rand -hex 32)

# 2. 更新配置
nano .env
# INTERAGENT_SECRET=$NEW_SECRET

# 3. 重启服务
docker compose restart

# 4. 验证
curl http://localhost:18790/health
```

**3. 密钥存储**

```bash
# 使用 Docker Secrets
echo "your-secret" | docker secret create interagent_secret -

# 在 docker-compose.yml 中使用
services:
  automaton:
    secrets:
      - interagent_secret

secrets:
  interagent_secret:
    external: true
```

### 访问控制

**1. IP 白名单**

```bash
# 配置防火墙
sudo ufw allow from 192.168.1.0/24 to any port 18790
sudo ufw enable
```

**2. 认证配置**

```bash
# 启用 JWT 认证
ENABLE_AUTH=true
JWT_SECRET=your-jwt-secret
JWT_EXPIRY=86400
```

### 安全扫描

**1. 漏洞扫描**

```bash
# 使用 Trivy
trivy image autojiedan-automaton:latest

# 使用 Docker Bench
docker run --rm --net host --pid host --userns host --cap-add SYS_ADMIN \
  --volume /var/lib/docker:/var/lib/docker \
  docker-bench-security
```

**2. 依赖检查**

```bash
# 检查过期依赖
npm outdated

# 审计安全漏洞
npm audit
pip-audit
```

### 安全加固

**1. 最小权限原则**

```yaml
# docker-compose.yml
services:
  automaton:
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
```

**2. 网络隔离**

```yaml
# 创建内部网络
networks:
  internal:
    internal: true

services:
  automaton:
    networks:
      - internal
      - external

  nanobot:
    networks:
      - internal
```

---

## 备份策略

### 自动备份

**配置定时任务:**

```bash
# 添加 crontab
crontab -e

# 每天凌晨 2 点备份
0 2 * * * cd /path/to/autoJieDan && BACKUP_PASSWORD=secret ./scripts/backup.sh

# 每周日凌晨 3 点完整备份
0 3 * * 0 cd /path/to/autoJieDan && BACKUP_PASSWORD=secret ./scripts/backup.sh --full
```

### 备份验证

**定期验证备份:**

```bash
# 1. 列出备份
ls -lh /backups/

# 2. 测试恢复
./scripts/restore.sh --test /backups/latest

# 3. 验证数据完整性
docker compose exec automaton sqlite3 /app/data/automaton.db "PRAGMA integrity_check;"
```

### 异地备份

**配置远程备份:**

```bash
# 同步到远程服务器
rsync -avz --delete \
  /backups/ \
  user@remote-server:/backups/autojiedan/

# 或使用云存储
./scripts/backup.sh --s3 s3://my-bucket/backups/
```

### 灾难恢复

**恢复流程:**

```bash
# 1. 停止服务
docker compose down

# 2. 恢复数据
BACKUP_PASSWORD=secret ./scripts/restore.sh /backups/latest

# 3. 启动服务
docker compose up -d

# 4. 验证
curl http://localhost:18790/health
```

---

## 运维最佳实践

### 日常检查清单

**每日:**
- [ ] 检查服务状态
- [ ] 查看错误日志
- [ ] 验证健康检查
- [ ] 监控资源使用

**每周:**
- [ ] 审查安全日志
- [ ] 检查备份完整性
- [ ] 性能趋势分析
- [ ] 依赖更新检查

**每月:**
- [ ] 密钥轮换
- [ ] 安全扫描
- [ ] 容量规划
- [ ] 灾难恢复演练

### 监控仪表板

**推荐 Grafana 面板:**

1. **系统概览** - 整体健康状态
2. **性能指标** - 响应时间、吞吐量
3. **错误追踪** - 错误率、异常统计
4. **资源使用** - CPU、内存、磁盘
5. **业务指标** - 任务完成率、用户活跃度

### 告警通知策略

| 严重级别 | 响应时间 | 通知方式 |
|---------|---------|---------|
| P0 - 关键 | 15 分钟 | 电话 + 短信 + 邮件 |
| P1 - 高 | 1 小时 | 短信 + 邮件 |
| P2 - 中 | 4 小时 | 邮件 |
| P3 - 低 | 1 天 | 邮件 |

### 文档维护

保持文档更新：
- 记录所有配置变更
- 文档化故障处理过程
- 更新架构图
- 维护运维手册

---

## 支持

- **Issues**: https://github.com/1123786563/autoJieDan/issues
- **部署指南**: [deployment-guide.md](./deployment-guide.md)
- **架构文档**: [ARCHITECTURE.md](../automaton/ARCHITECTURE.md)

---

*最后更新: 2026-02-28*
