# 部署指南 - Automaton + Nanobot 双系统

> 版本: 1.0.0 | 更新日期: 2026-02-26

---

## 目录

1. [前置条件](#前置条件)
2. [快速启动](#快速启动)
3. [生产部署](#生产部署)
4. [配置说明](#配置说明)
5. [监控部署](#监控部署)
6. [故障排除](#故障排除)

---

## 前置条件

### 系统要求

| 组件 | 最低要求 | 推荐配置 |
|------|----------|----------|
| CPU | 2 核 | 4 核 |
| 内存 | 4 GB | 8 GB |
| 磁盘 | 20 GB | 50 GB SSD |
| 操作系统 | Linux (Ubuntu 22.04+) | Linux (Ubuntu 22.04+) |

### 软件要求

| 软件 | 版本 | 用途 |
|------|------|------|
| Docker | 24+ | 容器运行时 |
| Docker Compose | 2.x | 服务编排 |
| Git | 2.x | 代码获取 |

### 网络要求

| 端口 | 服务 | 说明 |
|------|------|------|
| 18790 | Automaton HTTP | HTTP API |
| 18791 | Automaton WS | WebSocket |
| 18792 | Nanobot HTTP | HTTP API |
| 9090 | Prometheus | 指标采集 (可选) |
| 3000 | Grafana | 可视化 (可选) |
| 5601 | Kibana | 日志查看 (可选) |

---

## 快速启动

### 1. 克隆仓库

```bash
git clone https://github.com/1123786563/autoJieDan.git
cd autoJieDan
```

### 2. 配置环境变量

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑配置
nano .env
```

**必需配置**:
```bash
# 共享密钥 (必需)
INTERAGENT_SECRET=$(openssl rand -hex 32)

# LLM API 密钥 (至少配置一个)
OPENAI_API_KEY=sk-your-api-key
```

### 3. 启动服务

```bash
# 启动核心服务
docker compose up -d

# 查看服务状态
docker compose ps
```

### 4. 验证部署

```bash
# 检查 Automaton 健康状态
curl http://localhost:18790/health

# 检查 Nanobot 健康状态
curl http://localhost:18792/health

# 预期响应
{"status":"healthy","timestamp":"2026-02-26T10:00:00.000Z","uptime":60,"version":"1.0.0"}
```

---

## 生产部署

### 1. 使用预构建镜像

```bash
# 拉取最新镜像
docker pull ghcr.io/1123786563/autojiedan/automaton:latest
docker pull ghcr.io/1123786563/autojiedan/nanobot:latest

# 使用镜像启动
AUTOMATON_VERSION=latest NANOBOT_VERSION=latest docker compose up -d
```

### 2. 配置持久化存储

```yaml
# docker-compose.prod.yml
volumes:
  automaton-data:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/automaton
  automaton-keys:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/automaton-keys
```

### 3. 配置自动重启

```yaml
services:
  automaton:
    restart: always
  nanobot:
    restart: always
```

### 4. 配置资源限制

```yaml
services:
  automaton:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

---

## 配置说明

### 环境变量

#### 核心配置

| 变量 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `INTERAGENT_SECRET` | ✅ | - | HMAC 认证密钥 |
| `INTERAGENT_ENABLED` | | `true` | 启用双系统通信 |
| `LOG_LEVEL` | | `info` | 日志级别 |

#### Automaton 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AUTOMATON_HTTP_PORT` | `18790` | HTTP 端口 |
| `AUTOMATON_WS_PORT` | `18791` | WebSocket 端口 |
| `OPENAI_API_KEY` | - | OpenAI API 密钥 |

#### Nanobot 配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NANOBOT_HTTP_PORT` | `18792` | HTTP 端口 |
| `NANOBOT_LLM_PROVIDER` | `openai` | LLM 提供商 |
| `NANOBOT_API_KEY` | - | API 密钥 |

### 配置文件

配置文件位于 `~/.automaton/interagent.yml`:

```yaml
interagent:
  enabled: true

  protocol:
    primary: anp
    fallback: http

  anp:
    enabled: true
    did:
      method: anp
      identifier: automaton:main

  websocket:
    enabled: true
    ping_interval_ms: 30000
    max_connections: 50

  reliability:
    circuit_breaker_threshold: 5
    circuit_breaker_reset_ms: 60000
    lease_duration_seconds: 30
```

---

## 监控部署

### 启动监控栈

```bash
# 启动 Prometheus + Grafana
docker compose --profile monitoring up -d

# 访问 Grafana
open http://localhost:3000
# 默认账号: admin / admin
```

### 启动日志栈

```bash
# 启动 ELK 栈
docker compose --profile logging up -d

# 访问 Kibana
open http://localhost:5601
```

### 查看指标

```bash
# Automaton 指标
curl http://localhost:18790/metrics

# Prometheus 状态
curl http://localhost:9090/api/v1/targets
```

---

## 故障排除

### 常见问题

#### 1. 容器启动失败

```bash
# 查看日志
docker compose logs automaton
docker compose logs nanobot

# 常见原因
# - 端口被占用: 检查端口占用 lsof -i :18790
# - 权限问题: 检查数据目录权限
# - 内存不足: 检查系统内存 docker stats
```

#### 2. 服务间通信失败

```bash
# 检查网络
docker network ls
docker network inspect interagent-network

# 检查 DNS 解析
docker exec automaton ping nanobot
```

#### 3. 健康检查失败

```bash
# 手动测试健康检查
docker exec automaton wget -q -O- http://localhost:18790/health

# 检查进程状态
docker exec automaton ps aux
```

### 日志查看

```bash
# 实时日志
docker compose logs -f

# 特定服务日志
docker compose logs -f automaton --tail=100

# 导出日志
docker compose logs > logs.txt
```

### 重启服务

```bash
# 重启所有服务
docker compose restart

# 重启特定服务
docker compose restart automaton

# 完全重建
docker compose down && docker compose up -d
```

---

## 备份与恢复

### 备份

```bash
# 运行备份脚本
BACKUP_PASSWORD=your-secret ./scripts/backup.sh

# 备份位置
ls /backups/
```

### 恢复

```bash
# 查看可用备份
ls -lt /backups/

# 恢复指定备份
BACKUP_PASSWORD=your-secret ./scripts/restore.sh /backups/20260226_100000
```

---

## 升级指南

### 1. 备份数据

```bash
./scripts/backup.sh
```

### 2. 拉取最新代码

```bash
git pull origin main
```

### 3. 重建镜像

```bash
docker compose build --no-cache
```

### 4. 重启服务

```bash
docker compose down
docker compose up -d
```

### 5. 验证升级

```bash
curl http://localhost:18790/health
curl http://localhost:18792/health
```

---

## 联系支持

- **Issues**: https://github.com/1123786563/autoJieDan/issues
- **文档**: /docs
- **日志**: /deploy/logstash
