# 部署指南 | autoJieDan

> Conway Automaton + Nanobot 双系统部署指南

## 目录

- [系统要求](#系统要求)
- [环境准备](#环境准备)
- [快速部署](#快速部署)
- [详细部署步骤](#详细部署步骤)
- [生产环境配置](#生产环境配置)
- [监控系统](#监控系统)
- [故障排查](#故障排查)

---

## 系统要求

### 最低配置

| 资源 | 最低要求 | 推荐配置 |
|------|---------|---------|
| CPU | 2 核 | 4 核+ |
| 内存 | 4 GB | 8 GB+ |
| 磁盘 | 20 GB | 50 GB+ SSD |
| 系统 | Linux/macOS | Ubuntu 22.04 LTS |
| Docker | 24.0+ | 24.0+ |
| Docker Compose | 2.20+ | 2.20+ |

### 软件依赖

```bash
# 必需
Docker 24.0+
Docker Compose 2.20+
Git 2.x

# 可选（本地开发）
Node.js 20+
Python 3.11+
pnpm 10.x
```

---

## 环境准备

### 1. 安装 Docker

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**macOS:**
```bash
brew install --cask docker
```

### 2. 安装 Docker Compose

```bash
# Linux
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# 验证安装
docker compose version
```

### 3. 克隆仓库

```bash
git clone https://github.com/1123786563/autoJieDan.git
cd autoJieDan
```

---

## 快速部署

### 一键启动

```bash
# 1. 配置环境变量
cp .env.example .env
nano .env  # 编辑配置

# 2. 启动核心服务
docker compose up -d

# 3. 验证部署
curl http://localhost:18790/health
curl http://localhost:18792/health

# 4. 查看日志
docker compose logs -f
```

### 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Automaton HTTP | 18790 | Automaton REST API |
| Automaton WebSocket | 18791 | Automaton WebSocket 服务 |
| Nanobot HTTP | 18792 | Nanobot REST API |
| Prometheus | 9090 | 监控指标 |
| Grafana | 3000 | 监控面板 |
| Elasticsearch | 9200 | 日志存储 |
| Kibana | 5601 | 日志面板 |

---

## 详细部署步骤

### 步骤 1: 环境变量配置

复制并编辑环境变量文件：

```bash
cp .env.example .env
```

**必需配置:**

```bash
# Interagent 通信密钥（必须配置相同值）
INTERAGENT_SECRET=your-secret-key-here

# OpenAI API 密钥
OPENAI_API_KEY=sk-your-openai-key

# 服务端口配置
AUTOMATON_HTTP_PORT=18790
AUTOMATON_WS_PORT=18791
NANOBOT_HTTP_PORT=18792

# 日志级别
LOG_LEVEL=info
```

**可选配置:**

```bash
# Automaton 钱包配置（生产环境）
AUTOMATON_PRIVATE_KEY=0x...
AUTOMATON_CONWAY_API_KEY=...

# Nanobot 通道配置
TELEGRAM_BOT_TOKEN=your-telegram-token
DISCORD_BOT_TOKEN=your-discord-token
SLACK_BOT_TOKEN=xoxb-your-slack-token
```

### 步骤 2: 构建镜像

```bash
# 构建所有镜像
docker compose build

# 单独构建
docker compose build automaton
docker compose build nanobot
```

### 步骤 3: 启动服务

**核心服务（最小配置）:**
```bash
docker compose up -d automaton nanobot
```

**完整服务（含监控）:**
```bash
docker compose --profile monitoring up -d
```

**完整服务（含日志）:**
```bash
docker compose --profile logging up -d
```

**所有服务:**
```bash
docker compose --profile monitoring --profile logging up -d
```

### 步骤 4: 健康检查

```bash
# 检查服务状态
docker compose ps

# 检查健康状态
curl http://localhost:18790/health
curl http://localhost:18792/health

# 查看 Automaton 日志
docker compose logs -f automaton

# 查看 Nanobot 日志
docker compose logs -f nanobot
```

---

## 生产环境配置

### TLS/SSL 配置

使用 Nginx 反向代理启用 HTTPS：

```nginx
# /etc/nginx/sites-available/autojiedan
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location /automaton/ {
        proxy_pass http://localhost:18790/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /nanobot/ {
        proxy_pass http://localhost:18792/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 环境隔离

**开发环境:**
```bash
cp .env.example .env.development
# 编辑开发配置
docker compose --env-file .env.development up -d
```

**生产环境:**
```bash
cp .env.example .env.production
# 编辑生产配置
docker compose --env-file .env.production up -d
```

### 资源限制

在 `docker-compose.yml` 中配置资源限制：

```yaml
services:
  automaton:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G

  nanobot:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
```

### 数据持久化

```yaml
volumes:
  automaton-data:
    driver: local
  nanobot-data:
    driver: local
  prometheus-data:
    driver: local
  grafana-data:
    driver: local
```

---

## 监控系统

### Prometheus 配置

Prometheus 自动采集以下指标：

**Interagent 指标:**
- `interagent_ws_connections` - WebSocket 连接数
- `interagent_tasks_pending` - 待处理任务数
- `interagent_request_latency_ms` - 请求延迟
- `interagent_tasks_completed_total` - 完成任务数
- `interagent_tasks_failed_total` - 失败任务数
- `interagent_dlq_size` - 死信队列大小

**访问 Prometheus:**
```bash
# 启动监控栈
docker compose --profile monitoring up -d

# 访问 Prometheus
open http://localhost:9090
```

### Grafana 仪表板

**访问 Grafana:**
```bash
# 默认账号
Username: admin
Password: admin

# 首次登录后修改密码
open http://localhost:3000
```

**配置数据源:**
1. 添加 Prometheus 数据源
2. 导入仪表板（ID: 待补充）

### 日志聚合 (ELK)

**启动日志栈:**
```bash
docker compose --profile logging up -d

# 访问 Kibana
open http://localhost:5601
```

---

## 故障排查

### 常见问题

**1. 服务启动失败**

```bash
# 查看详细日志
docker compose logs automaton
docker compose logs nanobot

# 检查端口占用
lsof -i :18790
lsof -i :18792

# 重新构建镜像
docker compose build --no-cache
```

**2. Interagent 通信失败**

```bash
# 检查 INTERAGENT_SECRET 是否一致
docker compose exec automaton env | grep INTERAGENT
docker compose exec nanobot env | grep INTERAGENT

# 检查 WebSocket 连接
docker compose exec nanobot curl http://automaton:18791/health
```

**3. 内存不足**

```bash
# 检查资源使用
docker stats

# 增加内存限制
# 编辑 docker-compose.yml 中的 memory 限制
```

**4. 数据库错误**

```bash
# 检查数据卷
docker volume ls

# 备份数据
docker run --rm -v autojiedan_automaton-data:/data -v $(pwd):/backup \
  ubuntu tar czf /backup/automaton-backup.tar.gz /data
```

### 日志级别调整

```bash
# 临时调整日志级别
docker compose exec automaton sh -c 'export LOG_LEVEL=debug'

# 永久调整
# 编辑 .env 文件
LOG_LEVEL=debug
docker compose up -d
```

### 性能调优

```bash
# 增加 Node.js 内存
NODE_OPTIONS=--max-old-space-size=4096

# 增加 Worker 数量
WORKER_COUNT=4

# 启用缓存
ENABLE_CACHE=true
```

---

## 备份与恢复

### 备份

```bash
# 使用备份脚本
BACKUP_PASSWORD=secret ./scripts/backup.sh

# 手动备份
docker run --rm -v autojiedan_automaton-data:/data -v $(pwd)/backups:/backup \
  ubuntu tar czf /backup/automaton-$(date +%Y%m%d).tar.gz /data
```

### 恢复

```bash
# 使用恢复脚本
BACKUP_PASSWORD=secret ./scripts/restore.sh /backups/latest

# 手动恢复
docker run --rm -v autojiedan_automaton-data:/data -v $(pwd)/backups:/backup \
  ubuntu tar xzf /backup/automaton-20240228.tar.gz -C /
```

---

## 升级指南

```bash
# 1. 备份数据
./scripts/backup.sh

# 2. 拉取最新代码
git pull origin main

# 3. 更新镜像
docker compose pull

# 4. 重新构建
docker compose build

# 5. 重启服务
docker compose up -d

# 6. 验证
curl http://localhost:18790/health
```

---

## 安全建议

1. **密钥管理**
   - 使用强密钥生成 `INTERAGENT_SECRET`
   - 定期轮换 API 密钥（建议 30 天）
   - 使用密钥管理服务（如 HashiCorp Vault）

2. **网络安全**
   - 生产环境启用 TLS/SSL
   - 限制管理端口访问范围
   - 使用防火墙规则

3. **访问控制**
   - 配置 `allowFrom` 白名单
   - 启用认证机制
   - 定期审计访问日志

4. **更新维护**
   - 及时更新依赖包
   - 关注安全公告
   - 定期安全扫描

---

## 支持

- **Issues**: https://github.com/1123786563/autoJieDan/issues
- **文档**: [docs/](./)
- **架构**: [ARCHITECTURE.md](../automaton/ARCHITECTURE.md)

---

*最后更新: 2026-02-28*
