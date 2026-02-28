# 首个真实项目试运行计划 (T044)

## 目标
执行首个真实 Upwork 项目试运行，验证自动投标系统的端到端功能。

## 前提条件
- [x] Upwork 频道集成已完成
- [x] RSS 监控器已实现
- [x] 投标生成器已实现
- [x] 技能匹配器已实现
- [ ] Upwork API 凭证已配置
- [ ] Nanobot 服务运行中
- [ ] Automaton 服务运行中

## 试运行配置

### 1. 项目选择标准

**项目类型**: 小型固定价格项目
- 预算范围: $100 - $500
- 项目时长: < 1 周
- 技能要求: TypeScript, Python, API 开发

**客户筛选**:
- 客户评分: ≥ 4.5 ⭐
- 雇佣率: ≥ 50%
- 已支付金额: ≥ $1,000
- 项目历史: ≥ 5 个项目

**排除标准**:
- 包含 "test" 或 "sample" 的项目
- 需要特定地理位置的项目
- 预算过低 (< $100) 或过高 (> $1000)
- 需要非技术技能的项目

### 2. RSS Feed 配置

```python
# 推荐的 RSS feeds
FEED_URLS = [
    # Web Development
    "https://www.upwork.com/ab/feed/jobs/rss?sort=recency&fixedPrice=yes&budget=100-500&skills[]=typescript",
    "https://www.upwork.com/ab/feed/jobs/rss?sort=recency&fixedPrice=yes&budget=100-500&skills[]=python",

    # API Development
    "https://www.upwork.com/ab/feed/jobs/rss?sort=recency&fixedPrice=yes&budget=100-500&category2=web,scraping",

    # IT & Programming (filtered)
    "https://www.upwork.com/ab/feed/jobs/rss?sort=recency&fixedPrice=yes&budget=100-500&verifications=payment_verified",
]
```

### 3. 投标策略

**保守策略** (首次运行):
- 每日最大投标数: 3
- 投标时间窗口: UTC 09:00 - 17:00
- 投标间隔: 最少 2 小时
- 匹配阈值: ≥ 0.7

**定价策略**:
- 固定价格项目: 预算下限 + 10%
- 小型项目 (< $200): 预算中位数
- 快速交付: +15% 溢价

### 4. 投标内容模板

```typescript
// 投标模板结构
interface BidTemplate {
  greeting: string;          // 个性化问候
  understanding: string;     // 项目理解
  approach: string;          // 解决方案
  timeline: string;          // 交付时间
  deliverables: string[];    // 交付物
  call_to_action: string;    // 行动号召
}
```

## 实施步骤

### 步骤 1: 环境准备 (预计 30 分钟)

1. **配置 Upwork API 凭证**
   ```bash
   # 编辑 Nanobot 配置
   vim nanobot/config.yml

   # 添加 Upwork 配置
   upwork:
     api:
       consumer_key: "your-key"
       consumer_secret: "your-secret"
       access_token: "your-token"
       access_token_secret: "your-token-secret"
   ```

2. **启动服务**
   ```bash
   # 启动 Automaton
   cd /Users/yongjunwu/trea/autoJieDan/automaton
   pnpm start &

   # 启动 Nanobot
   cd /Users/yongjunwu/trea/autoJieDan/nanobot
   nanobot start &
   ```

3. **验证连接**
   ```bash
   # 检查 Automaton
   curl http://localhost:10790/health

   # 检查 Nanobot
   curl http://localhost:10792/health

   # 检查 Upwork 频道
   nanobot channels status upwork
   ```

### 步骤 2: 配置试运行参数 (预计 15 分钟)

1. **创建试运行配置文件**
   ```yaml
   # config/pilot-run.yml
   pilot_run:
     enabled: true
     mode: "dry_run"  # dry_run -> production

     feeds:
       - "https://www.upwork.com/ab/feed/jobs/rss?..."

     project_filters:
       min_budget: 100
       max_budget: 500
       required_skills: ["typescript", "python"]
       excluded_keywords: ["test", "sample", "contest"]

     bidding:
       max_bids_per_day: 3
       min_match_score: 0.7
       bid_approval_required: true  # 首次运行需要人工审核

     monitoring:
       check_interval_seconds: 300
       alert_on_failure: true
   ```

2. **加载配置**
   ```bash
   nanobot config load config/pilot-run.yml
   ```

### 步骤 3: 启动监控 (预计 5 分钟)

```bash
# 启动 Upwork RSS 监控
nanobot channels upwork monitor start --config=config/pilot-run.yml

# 查看监控状态
nanobot channels upwork monitor status

# 查看日志
tail -f /var/log/nanobot/upwork.log
```

### 步骤 4: 项目发现与评估 (持续)

**自动化流程**:
1. RSS 监控器发现新项目
2. 技能匹配器评估匹配度
3. 如果匹配度 ≥ 0.7，创建投标候选
4. 投标生成器创建投标草稿
5. 等待人工审核

**监控指标**:
- 发现的项目数量
- 匹配的项目数量
- 生成的投标数量
- 投标批准率
- 客户响应率

### 步骤 5: 投标审核与提交 (人工参与)

**审核清单**:
- [ ] 项目描述理解正确
- [ ] 投标金额合理
- [ ] 时间线可实现
- [ ] 技能匹配准确
- [ ] 无语法错误
- [ ] 语气专业友好

**提交流程**:
1. 查看投标草稿
   ```bash
   nanobot channels upwork bids list --pending
   nanobot channels upwork bids show <bid-id>
   ```

2. 编辑投标（如需要）
   ```bash
   nanobot channels upwork bids edit <bid-id>
   ```

3. 提交投标
   ```bash
   nanobot channels upwork bids submit <bid-id>
   ```

### 步骤 6: 监控与反馈 (持续)

**实时监控**:
```bash
# 监控仪表板
watch -n 10 'nanobot channels upwork stats'

# 查看活动投标
nanobot channels upwork bids list --active

# 查看客户响应
nanobot channels upwork messages list
```

**关键指标**:
| 指标 | 目标值 | 当前值 |
|------|--------|--------|
| 投标提交数 | ≥ 5 | 0 |
| 客户响应数 | ≥ 1 | 0 |
| 面试邀请数 | ≥ 1 | 0 |
| 项目雇佣数 | ≥ 1 | 0 |
| 平均响应时间 | < 24h | N/A |

## 成功标准

### M5 验收标准

1. **功能完整性** ✅
   - [x] Upwork 频道集成
   - [x] RSS 监控功能
   - [x] 投标生成功能
   - [x] 技能匹配功能

2. **端到端流程** ✅
   - [ ] 发现项目 → 评估 → 生成投标 → 提交投标
   - [ ] 接收客户响应 → 分析 → 制定后续策略

3. **质量指标**
   - [ ] 投标质量评分 ≥ 8/10
   - [ ] 客户响应率 ≥ 20%
   - [ ] 无技术错误或异常

4. **性能指标**
   - [ ] RSS 响应时间 < 5s
   - [ ] 投标生成时间 < 30s
   - [ ] 系统稳定性 > 99%

## 风险与缓解

### 风险 1: Upwork API 限制
- **影响**: 无法提交投标
- **概率**: 中
- **缓解**: 使用官方 API，监控速率限制，实现重试逻辑

### 风险 2: 投标质量不达标
- **影响**: 客户不响应，声誉受损
- **概率**: 中
- **缓解**: 人工审核首批投标，迭代改进模板

### 风险 3: 项目匹配错误
- **影响**: 投标不相关项目
- **概率**: 低
- **缓解**: 提高匹配阈值，增加人工审核

### 风险 4: 账户被封禁
- **影响**: 无法继续投标
- **概率**: 低
- **缓解**: 遵守 Upwork 服务条款，限制投标频率

## 时间表

| 阶段 | 开始时间 | 预计时长 | 完成标准 |
|------|----------|----------|----------|
| 环境准备 | T+0h | 0.5h | 服务运行，凭证配置 |
| 参数配置 | T+0.5h | 0.25h | 配置文件加载 |
| 监控启动 | T+0.75h | 0.1h | RSS 监控运行 |
| 项目发现 | T+0.85h | 24-48h | 发现 ≥10 个候选 |
| 投标提交 | T+1-48h | 持续 | 提交 ≥3 个投标 |
| 客户响应 | T+24-72h | 持续 | 收到 ≥1 个响应 |
| 项目雇佣 | T+72-168h | 持续 | 获得 ≥1 个项目 |

## 后续改进

基于试运行结果，计划以下改进：

1. **投标模板优化**
   - A/B 测试不同模板
   - 根据响应率调整内容

2. **匹配算法改进**
   - 基于实际雇佣数据调整权重
   - 增加更多特征维度

3. **自动化程度提升**
   - 减少人工审核依赖
   - 自动化跟进消息

4. **性能优化**
   - 减少响应时间
   - 提高并发处理能力

## 联系信息

- **项目负责人**: worker-1
- **技术支持**: Automaton + Nanobot 团队
- **紧急联系**: team-lead

---

**文档版本**: 1.0
**创建日期**: 2026-02-28
**最后更新**: 2026-02-28
