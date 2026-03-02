# Smoke Tests - AutoJieDan Production

Phase 1F-04: 快速冒烟测试套件

## 概述

冒烟测试用于快速验证生产部署的核心功能是否正常工作。这些测试旨在在30秒内完成，可以在CI/CD管道中快速运行。

## 测试场景

### 1. 健康检查 (Health Check)
- ✓ 响应 `/health` 端点
- ✓ 响应 `/ready` 端点
- ✓ 响应 `/live` 端点

### 2. 数据库连接 (Database Connection)
- ✓ 创建和连接SQLite数据库
- ✓ 支持基本CRUD操作
- ✓ 支持事务操作

### 3. WebSocket连接 (WebSocket Connection)
- ✓ 建立WebSocket连接
- ✓ 优雅处理连接失败

### 4. 环境变量 (Environment Variables)
- ✓ 所有必需的环境变量已设置
- ✓ 推荐的环境变量检查
- ✓ INTERAGENT_SECRET格式验证
- ✓ OPENAI_API_KEY格式验证

### 5. HTTP状态端点 (HTTP Status Endpoint)
- ✓ 返回完整的状态信息

### 6. CORS和Headers
- ✓ 包含CORS头
- ✓ 返回正确的Content-Type

## 运行测试

### 从automaton目录运行

```bash
cd automaton
pnpm test:smoke
```

### 直接使用vitest运行

```bash
cd automaton
npx vitest run ../tests/smoke/smoke.test.ts --reporter=verbose
```

### 在CI/CD中运行

```bash
# 设置环境变量
export AUTOMATON_HTTP_PORT=18790
export AUTOMATON_WS_PORT=18791
export INTERAGENT_SECRET=your-secret
export OPENAI_API_KEY=your-api-key

# 运行冒烟测试
cd automaton
pnpm test:smoke
```

## 环境变量

| 变量 | 说明 | 默认值 | 必需 |
|------|------|--------|------|
| `AUTOMATON_HTTP_PORT` | HTTP端点端口 | 18790 | 否 |
| `AUTOMATON_WS_PORT` | WebSocket端口 | 18791 | 否 |
| `AUTOMATON_HOST` | 服务主机地址 | 127.0.0.1 | 否 |
| `INTERAGENT_SECRET` | HMAC认证密钥 | - | **是** |
| `OPENAI_API_KEY` | OpenAI API密钥 | - | **是** |

## 超时设置

- 单个测试超时: 25秒
- 总执行时间目标: < 30秒

## 故障排除

### 测试失败: 连接被拒绝

确保Automaton服务正在运行：

```bash
cd automaton
pnpm dev
```

### 测试失败: 缺少环境变量

设置必需的环境变量：

```bash
export INTERAGENT_SECRET=your-secret
export OPENAI_API_KEY=sk-...
```

### WebSocket连接失败

检查WebSocket端口是否正确配置且未被占用。

## 下一步

- 运行完整的集成测试套件
- 运行负载测试
- 运行安全测试
