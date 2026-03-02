# AutoJieDan 部署指南

> Automaton + Nanobot 双系统 AI 代理框架部署文档

**版本**: 1.0.0
**更新日期**: 2026-03-02

---

## 目录

1. [系统要求](#系统要求)
2. [环境变量配置](#环境变量配置)
3. [Docker 部署步骤](#docker-部署步骤)
4. [监控配置](#监控配置)
5. [故障排除指南](#故障排除指南)

---

## 系统要求

### 硬件要求

| 组件 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 2 核心 | 4+ 核心 |
| 内存 | 4 GB | 8+ GB |
| 磁盘 | 20 GB 可用空间 | 50+ GB SSD |
| 网络 | 稳定的互联网连接 | 低延迟网络 |

### 软件要求

| 软件 | 版本要求 | 说明 |
|------|----------|------|
| **Docker** | 24.0+ | 容器运行时 |
| **Docker Compose** | 2.x | 容器编排 |
| **Git** | 2.x | 代码克隆 |
| **Node.js** | 20+ | 本地开发 (可选) |
| **Python** | 3.11+ | 本地开发 (可选) |

### 操作系统支持

- Linux (Ubuntu 20.04+, Debian 11+, CentOS 8+)
- macOS (12+ Monterey)
- Windows 10/11 with WSL2

### 验证安装

```bash
# 检查 Docker 版本
docker --version
docker compose version

# 检查系统资源
docker info
```

---

## 环境变量配置

### 必需环境变量

| 变量名 | 说明 | 生成方法 |
|--------|------|----------|
| `INTERAGENT_SECRET` | HMAC 认证密钥 | `openssl rand -hex 32` |
| `OPENAI_API_KEY` | OpenAI API 密钥 | [OpenAI Platform](https://platform.openai.com/api-keys) |

### 可选环境变量

#### Automaton 配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `AUTOMATON_HTTP_PORT` | 10790 | Automaton HTTP 端口 |
| `AUTOMATON_WS_PORT` | 10791 | Automaton WebSocket 端口 |
| `AUTOMATON_VERSION` | latest | Docker 镜像版本 |

#### Nanobot 配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `NANOBOT_HTTP_PORT` | 10792 | Nanobot HTTP 端口 |
| `NANOBOT_WS_PORT` | 10793 | Nanobot WebSocket 端口 |
| `NANOBOT_LLM_PROVIDER` | openai | LLM 提供商 |
| `NANOBOT_API_KEY` | - | LLM API 密钥 |

#### 监控配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PROMETHEUS_PORT` | 9090 | Prometheus 端口 |
| `GRAFANA_PORT` | 3001 | Grafana 端口 |
| `GRAFANA_ADMIN_USER` | admin | Grafana 管理员用户名 |
| `GRAFANA_ADMIN_PASSWORD` | - | Grafana 管理员密码 (必需) |

#### 日志配置

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `LOG_LEVEL` | info | 日志级别 (debug/info/warn/error) |
| `ELASTICSEARCH_PORT` | 9200 | Elasticsearch 端口 |
| `LOGSTASH_TCP_PORT` | 5000 | Logstash 端口 |
| `KIBANA_PORT` | 5601 | Kibana 端口 |

#### 可选功能

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `FREELANCE_ENABLED` | false | 启用自由职业模块 |
| `UPWORK_CLIENT_ID` | - | Upwork 客户端 ID |
| `UPWORK_CLIENT_SECRET` | - | Upwork 客户端密钥 |
| `UPWORK_ACCESS_TOKEN` | - | Upwork 访问令牌 |
| `UPWORK_REFRESH_TOKEN` | - | Upwork 刷新令牌 |

#### 告警配置 (可选)

| 变量名 | 说明 |
|--------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人令牌 |
| `TELEGRAM_CHAT_ID` | Telegram 聊天 ID |
| `TELEGRAM_API_URL` | Telegram API URL |
| `SMTP_SERVER` | SMTP 服务器地址 |
| `SMTP_FROM` | 发件人邮箱 |
| `SMTP_USERNAME` | SMTP 用户名 |
| `SMTP_PASSWORD` | SMTP 密码 |
| `ALERT_EMAIL_TO` | 告警接收邮箱 |

### 环境变量文件

项目提供了环境变量模板：

```bash
# 复制开发环境模板
cp .env.example .env

# 或复制生产环境模板
cp .env.production .env
```

**重要**: 永远不要提交 `.env` 文件到版本控制系统！

---

## Docker 部署步骤

### 快速启动 (开发环境)

1. **克隆仓库**

```bash
git clone https://github.com/1123786563/autoJieDan.git
cd autoJieDan
```

2. **配置环境变量**

```bash
cp .env.example .env
nano .env  # 编辑配置

# 最少需要设置:
# INTERAGENT_SECRET=...
# OPENAI_API_KEY=...
```

3. **启动核心服务**

```bash
# 启动 Automaton + Nanobot
docker compose up -d

# 查看日志
docker compose logs -f

# 验证部署
curl http://localhost:10790/health  # Automaton
curl http://localhost:10792/health  # Nanobot
```

4. **启动监控服务 (可选)**

```bash
# 启动 Prometheus + Grafana
docker compose --profile monitoring up -d

# 访问 Grafana
open http://localhost:3001
# 默认账号: admin / (设置的密码)
```

5. **启动日志服务 (可选)**

```bash
# 启动 ELK 栈
docker compose --profile logging up -d

# 访问 Kibana
open http://localhost:5601
```

### 生产部署

1. **配置生产环境**

```bash
# 复制生产环境模板
cp .env.production .env.production.local

# 编辑生产配置
nano .env.production.local

# 必须设置的安全变量:
export INTERAGENT_SECRET=$(openssl rand -hex 32)
export GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)

# 设置 API 密钥
export OPENAI_API_KEY=your-production-key
```

2. **使用生产配置启动**

```bash
# 使用生产配置启动所有服务
docker compose -f docker-compose.prod.yml --env-file .env.production.local up -d

# 验证部署状态
docker compose -f docker-compose.prod.yml ps
```

3. **健康检查**

```bash
# 检查 Automaton
curl http://localhost:10790/health

# 检查 Nanobot
curl http://localhost:10792/health

# 检查 Prometheus
curl http://localhost:9090/-/healthy

# 检查 Grafana
curl http://localhost:3001/api/health
```

### 常用命令

```bash
# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f automaton
docker compose logs -f nanobot

# 重启服务
docker compose restart automaton

# 停止所有服务
docker compose down

# 停止并删除数据卷 (危险!)
docker compose down -v

# 更新并重启
docker compose pull
docker compose up -d
```

### 数据持久化

生产环境使用以下 Docker 卷：

| 卷名 | 用途 |
|------|------|
| `automaton-data` | Automaton 数据库和状态 |
| `automaton-keys` | Automaton 密钥和证书 |
| `nanobot-data` | Nanobot 数据和配置 |
| `prometheus-data` | Prometheus 指标数据 |
| `grafana-data` | Grafana 配置和仪表板 |

**备份命令**:

```bash
# 备份所有数据卷
docker run --rm \
  -v automaton-data:/data/automaton \
  -v automaton-keys:/data/keys \
  -v nanobot-data:/data/nanobot \
  -v prometheus-data:/data/prometheus \
  -v grafana-data:/data/grafana \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/autojiedan-backup-$(date +%Y%m%d).tar.gz /data
```

---

## 监控配置

### Prometheus 指标端点

系统暴露以下 Prometheus 指标：

| 指标名称 | 类型 | 说明 |
|----------|------|------|
| `interagent_ws_connections` | Gauge | 当前 WebSocket 连接数 |
| `interagent_tasks_pending` | Gauge | 待处理任务数 |
| `interagent_tasks_active` | Gauge | 正在执行的任务数 |
| `interagent_tasks_completed_total` | Counter | 已完成任务总数 |
| `interagent_tasks_failed_total` | Counter | 失败任务总数 |
| `interagent_request_latency_ms` | Histogram | 请求延迟分布 |
| `interagent_messages_sent_total` | Counter | 发送消息总数 |
| `interagent_messages_received_total` | Counter | 接收消息总数 |
| `interagent_dlq_size` | Gauge | 死信队列大小 |

### 访问监控服务

#### Prometheus

- **URL**: http://localhost:9090
- **功能**: 指标查询、告警规则管理、目标状态

#### Grafana

- **URL**: http://localhost:3001
- **默认账号**: admin / (设置的密码)
- **功能**: 可视化仪表板、告警通知

### 预配置告警规则

系统包含以下告警规则：

#### 成本告警

| 告警名称 | 触发条件 | 级别 |
|----------|----------|------|
| `ProjectCostWarning` | 成本超过预算 50% | warning |
| `ProjectCostCritical` | 成本超过预算 80% | critical |

#### 业务告警

| 告警名称 | 触发条件 | 级别 |
|----------|----------|------|
| `NoProjectsDiscovered` | 2 小时无新项目 | warning |
| `LowBidAcceptanceRate` | 投标接受率 < 10% | warning |

#### 技术告警

| 告警名称 | 触发条件 | 级别 |
|----------|----------|------|
| `LLMCallLatency` | P95 延迟 > 30s | warning |
| `LLMCallLatencyCritical` | P95 延迟 > 60s | critical |
| `WebSocketDisconnect` | 无 WebSocket 连接 | critical |
| `HighWebSocketReconnectRate` | 重连率 > 0.1/s | warning |

#### 系统告警

| 告警名称 | 触发条件 | 级别 |
|----------|----------|------|
| `HighErrorRate` | 错误率 > 5% | warning |
| `DatabaseConnectionFailure` | 无数据库连接 | critical |

### 配置告警通知

编辑 `.env` 添加告警通知配置：

```bash
# Telegram 通知
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id

# Email 通知
SMTP_SERVER=smtp.gmail.com:587
SMTP_FROM=alerts@yourdomain.com
SMTP_USERNAME=your_email@gmail.com
SMTP_PASSWORD=your_app_password
ALERT_EMAIL_TO=admin@yourdomain.com
```

### Grafana 仪表板

预配置的 Grafana 仪表板位于 `config/grafana/dashboards/`：

- **系统概览**: 系统健康状态、资源使用
- **业务指标**: 项目发现、投标状态、成本追踪
- **性能监控**: 请求延迟、错误率、吞吐量

---

## 故障排除指南

### 常见问题

#### 1. 容器启动失败

**症状**: `docker compose up` 报错

**排查步骤**:

```bash
# 检查 Docker 状态
docker info

# 查看详细日志
docker compose logs automaton
docker compose logs nanobot

# 检查端口占用
lsof -i :10790
lsof -i :10792
```

**解决方案**:

- 确保端口未被占用
- 检查环境变量是否正确设置
- 验证 Docker 镜像是否成功拉取

#### 2. 健康检查失败

**症状**: `/health` 端点返回错误

**排查步骤**:

```bash
# 检查容器状态
docker compose ps

# 进入容器检查
docker compose exec automaton /bin/sh
docker compose exec nanobot /bin/sh

# 手动运行健康检查
docker compose exec automaton curl http://localhost:10790/health
```

**解决方案**:

- 检查 `INTERAGENT_SECRET` 是否匹配
- 验证 `OPENAI_API_KEY` 是否有效
- 确认服务间网络连接正常

#### 3. WebSocket 连接断开

**症状**: Automaton 和 Nanobot 无法通信

**排查步骤**:

```bash
# 检查 WebSocket 端口
curl http://localhost:10791/status

# 查看 WebSocket 日志
docker compose logs automaton | grep -i websocket
docker compose logs nanobot | grep -i websocket
```

**解决方案**:

- 确认防火墙允许 WebSocket 端口
- 检查 `INTERAGENT_AUTOMATON_URL` 配置
- 验证 HMAC 签名配置

#### 4. Prometheus 无法采集指标

**症状**: Grafana 仪表板无数据

**排查步骤**:

```bash
# 检查 Prometheus 目标状态
curl http://localhost:9090/api/v1/targets

# 手动查询指标
curl http://localhost:10790/metrics

# 检查 Prometheus 配置
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml
```

**解决方案**:

- 确保 `/metrics` 端点可访问
- 检查 Prometheus 配置文件语法
- 验证网络连接

#### 5. 内存不足

**症状**: 容器被 OOM Killer 终止

**排查步骤**:

```bash
# 检查容器资源使用
docker stats

# 查看系统内存
free -h
```

**解决方案**:

- 增加 Docker 内存限制
- 调整 `docker-compose.prod.yml` 中的资源限制
- 重启高内存消耗的服务

### 日志位置

| 服务 | 日志位置 | 说明 |
|------|----------|------|
| **Automaton** | `./logs/automaton.log` | 应用日志 |
| **Nanobot** | `./logs/nanobot.log` | 应用日志 |
| **Docker** | `docker compose logs` | 容器日志 |
| **Prometheus** | Docker 卷 | 指标数据 |
| **Grafana** | Docker 卷 | 配置和面板 |

### 查看日志

```bash
# 实时查看所有日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f automaton
docker compose logs -f nanobot

# 查看最近 100 行
docker compose logs --tail=100 automaton

# 查看带时间戳的日志
docker compose logs -t automaton
```

### 健康检查端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 基本健康状态 |
| `/healthz` | GET | Kubernetes 风格健康检查 |
| `/status` | GET | 详细状态信息 |
| `/statusz` | GET | Kubernetes 风格状态检查 |
| `/ready` | GET | 就绪探针 |
| `/readyz` | GET | Kubernetes 风格就绪检查 |
| `/live` | GET | 存活探针 |
| `/livez` | GET | Kubernetes 风格存活检查 |
| `/metrics` | GET | Prometheus 指标 |

### 紧急恢复

```bash
# 完全重启系统
docker compose down
docker compose up -d

# 恢复备份数据
docker run --rm \
  -v automaton-data:/data \
  -v $(pwd)/backups:/backup \
  alpine tar xzf /backup/autojiedan-backup-YYYYMMDD.tar.gz -C /

# 重置数据库 (危险!)
docker compose down -v
docker compose up -d
```

### 获取支持

如果问题仍未解决：

1. 检查 [GitHub Issues](https://github.com/1123786563/autoJieDan/issues)
2. 查看项目文档:
   - [README.md](../README.md) - 项目概览
   - [Automaton 开发指南](../automaton/CLAUDE.md) - Automaton 详情
   - [Nanobot 开发指南](../nanobot/CLAUDE.md) - Nanobot 详情

---

## 附录

### A. 端口映射

| 服务 | 内部端口 | 外部端口 | 协议 |
|------|----------|----------|------|
| Automaton HTTP | 10790 | 10790 | HTTP |
| Automaton WebSocket | 10791 | 10791 | WebSocket |
| Nanobot HTTP | 10792 | 10792 | HTTP |
| Nanobot WebSocket | 10793 | 10793 | WebSocket |
| Prometheus | 9090 | 9090 | HTTP |
| Grafana | 3000 | 3001 | HTTP |
| Elasticsearch | 9200 | 9200 | HTTP |
| Logstash | 5000 | 5000 | TCP |
| Kibana | 5601 | 5601 | HTTP |

### B. 资源限制

生产环境默认资源限制：

| 服务 | CPU 限制 | 内存限制 | CPU 预留 | 内存预留 |
|------|----------|----------|----------|----------|
| automaton-nanobot | 2 核心 | 4 GB | 1 核心 | 2 GB |
| prometheus | 1 核心 | 2 GB | 0.5 核心 | 1 GB |
| grafana | 0.5 核心 | 1 GB | 0.25 核心 | 512 MB |

### C. 安全建议

1. **密钥管理**
   - 使用密钥管理服务 (如 AWS Secrets Manager、HashiCorp Vault)
   - 定期轮换 API 密钥 (建议每 30 天)
   - 永远不要在代码中硬编码密钥

2. **网络安全**
   - 在生产环境启用 TLS/HTTPS
   - 限制管理端口的网络访问
   - 使用防火墙规则限制入站连接

3. **访问控制**
   - 为 Grafana 设置强密码
   - 限制 Prometheus 的访问范围
   - 使用基于角色的访问控制 (RBAC)

4. **数据保护**
   - 定期备份数据卷
   - 加密敏感数据
   - 实施日志审计策略

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-02
**维护者**: AutoJieDan Team
