# 事件监控系统设计文档

> 本文档详细描述 richer-js 项目中事件监控系统（`/monitor` 页面）的完整实现方案，供其他系统参考复用。

---

## 1. 系统概览

### 1.1 目标

将交易引擎产生的买卖信号实时展示在 Web 监控页面上，包含：

- 信号基本信息（买入/卖出、执行状态、代币、市值、涨幅）
- 叙事分析数据（评级、评分、阶段详情、语料来源、推文内容）
- 实时更新（新事件推送、叙事数据自动刷新）
- 筛选与排序（按动作、评级、代币筛选）

### 1.2 架构总览

```
交易引擎产生信号
    │
    ▼
TradeSignal 保存到 strategy_signals 表
    │
    ▼
通知过滤（第1/3次买入、所有卖出）
    │
    ▼
ExperimentEventService.createEvent()
    │  构建 summary/details（不含叙事数据）
    │  写入 experiment_events 表
    │
    ├──► Supabase Realtime 推送 INSERT 事件到前端
    │
    ▼
前端请求 GET /api/events
    │
    ▼
服务端动态查询 token_narrative 表
    │  buildLLMAnalysis() 构建叙事展示数据
    │  批量查询 external_resource_cache 获取推文内容
    │  合并到事件的 summary/details
    │
    ▼
前端渲染事件卡片
```

### 1.3 关键设计决策

| 决策 | 说明 |
|------|------|
| **叙事数据不快照** | 事件创建时不嵌入叙事数据，API 查询时动态从 `token_narrative` 表获取。避免叙事分析完成后数据过时 |
| **双模式实时推送** | Supabase Realtime（主）+ HTTP 轮询（备），保证可靠性 |
| **summary / details 分层** | `summary` 放结构化数字（筛选/卡片展示），`details` 放文本/结构化信息（展开查看） |
| **通知过滤** | 买入信号只通知第 1 次和第 3 次，卖出信号每次通知，避免刷屏 |

---

## 2. 数据库设计

### 2.1 事件表 `experiment_events`

```sql
create table public.experiment_events (
  id uuid not null default gen_random_uuid(),
  experiment_id text not null,
  experiment_name text,
  experiment_mode text,              -- 'virtual' / 'live'
  token_address text not null,
  token_symbol text,
  action text not null,              -- 'buy' / 'sell'
  executed boolean not null default false,
  chain text default 'bsc',          -- 区块链标识
  created_at timestamp with time zone not null default now(),
  summary jsonb default '{}',        -- 结构化数字，用于筛选和展示
  details jsonb default '{}',        -- 文本/结构化信息，用于展开详情
  constraint experiment_events_pkey primary key (id)
);

-- 按创建时间倒序查询（监控页面主查询）
create index idx_experiment_events_created_at on public.experiment_events (created_at desc);
-- 按实验ID筛选
create index idx_experiment_events_experiment_id on public.experiment_events (experiment_id);
-- GIN 索引支持 JSONB 内字段查询
create index idx_experiment_events_summary on public.experiment_events using gin (summary);
```

### 2.2 Supabase Realtime 配置

```sql
-- 开启 RLS（Postgres Changes 要求）
alter table public.experiment_events enable row level security;
-- 允许 anon 角色读取和写入
create policy "Allow anonymous read" on public.experiment_events for select to anon using (true);
create policy "Allow anonymous insert" on public.experiment_events for insert to anon with check (true);
-- 将表加入 Realtime 发布
alter publication supabase_realtime add table public.experiment_events;
```

### 2.3 JSONB 字段结构

#### summary（筛选 + 卡片展示）

```jsonc
// 买入信号
{
  "signalIndex": 3,           // 第几次买入信号（1-based）
  "marketCap": 1500000,       // FDV 市值（美元）
  "earlyReturn": 95.5,        // 早期涨幅百分比
  // ↓ 以下字段由 API 动态填充，不存储在数据库中
  "narrativeRating": "high",  // 叙事评级: high/mid/low/unrated
  "narrativeScore": 7.8,      // 叙事总分
  "narrativeNumericRating": 3,// 数字评级 1-3
  "narrativeIncomplete": true // 叙事分析是否未完成
}

// 卖出信号
{
  "marketCap": 2000000,
  "earlyReturn": 120.5,
  "profitPercent": 32.1,      // 利润百分比
  "holdDuration": 3600000,    // 持仓时长（毫秒）
  "cards": "all"              // 卖出的卡数
}
```

#### details（展开详情）

```jsonc
{
  // 链接
  "gmgnUrl": "https://gmgn.ai/bsc/token/0x...",
  "signalsUrl": "http://localhost:3010/experiment/xxx/signals#token=0x...",

  // 执行信息
  "executionReason": "Pre-buy check rejected: ...",  // 仅被拒绝时

  // ↓ 以下字段由 API 动态填充
  "narrativeReason": "高质量叙事：...",
  "narrativeIncompleteReason": "叙事分析进行到 stage2 后中断",
  "stageSummaries": {
    "preCheck": { "pass": false, "score": 0, "reason": "同名代币重复", "details": {...} },
    "prestage": { "pass": true, "score": 5, "category": "A" },
    "stage1": { "pass": true, "score": 7, "category": "visual_ip" },
    "stage2": { "pass": true, "score": 8, "reason": "..." },
    "stage3": { "pass": true, "score": 7.5, "reason": "..." }
  },
  "sourceUrls": {
    "twitter": [{ "url": "https://x.com/...", "type": "tweet" }],
    "websites": [{ "url": "https://...", "type": "article" }]
  },
  "tweetContents": [
    { "url": "https://x.com/...", "text": "推文内容...", "author": "elonmusk", "authorFollowers": 190000000 }
  ],

  // 卖出事件额外字段
  "buyPrice": "0.001234",
  "sellPrice": "0.001634",
  "highestPrice": "0.002100",
  "drawdownFromHighest": 22.1
}
```

---

## 3. 后端实现

### 3.1 事件创建服务

**文件**：`src/web/services/ExperimentEventService.js`

#### 核心方法

```javascript
class ExperimentEventService {
  constructor() {
    this._supabase = null;
    this._webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:3010';
    this._gmgnBaseUrl = 'https://gmgn.ai';
  }

  /**
   * 创建事件
   * @param {Object} signal - 完整信号数据（来自 strategy_signals 表）
   * @param {Object} experimentInfo - { id, mode, name }
   */
  async createEvent(signal, experimentInfo) {
    const metadata = signal.metadata || {};
    const tf = metadata.trendFactors || {};
    const rf = metadata.regularFactors || {};
    const action = signal.action || 'unknown';
    const executed = signal.executed === true;

    let summary = {};
    let details = {};

    if (action === 'buy') {
      const buySignalIndex = await this._getBuySignalIndex(signal);
      const result = this._buildBuyEventData(signal, metadata, tf, rf, buySignalIndex, experimentInfo);
      summary = result.summary;
      details = result.details;
    } else {
      const result = this._buildSellEventData(signal, metadata, tf, rf, experimentInfo);
      summary = result.summary;
      details = result.details;
    }

    // 写入数据库
    await supabase.from('experiment_events').insert({
      experiment_id: experimentInfo.id,
      experiment_name: experimentInfo.name || null,
      experiment_mode: experimentInfo.mode || null,
      token_address: signal.token_address,
      token_symbol: signal.token_symbol || null,
      action,
      executed,
      chain: signal.chain || 'bsc',
      summary,
      details
    });
  }
}
```

#### 买入事件数据构建

```javascript
_buildBuyEventData(signal, metadata, tf, rf, buySignalIndex, experimentInfo) {
  const fdv = rf.fdv ?? tf.fdv ?? null;
  const summary = {};
  if (buySignalIndex != null) summary.signalIndex = buySignalIndex;
  if (fdv != null) summary.marketCap = fdv;
  if (tf.earlyReturn != null) summary.earlyReturn = tf.earlyReturn;

  const details = {};
  // 拒绝原因（仅未执行时）
  if (!signal.executed) {
    const pr = metadata.preBuyCheckResult || {};
    details.executionReason = metadata.execution_reason || pr.reason || null;
  }
  // 外部链接
  details.gmgnUrl = this._buildGMGNUrl(signal.token_address, signal.chain);
  details.signalsUrl = `${this._webBaseUrl}/experiment/${expId}/signals#token=${signal.token_address}`;

  return { summary, details };
}
```

#### 卖出事件数据构建

```javascript
_buildSellEventData(signal, metadata, tf, rf, experimentInfo) {
  const fdv = rf.fdv ?? tf.fdv ?? null;
  const summary = {};
  if (fdv != null) summary.marketCap = fdv;
  if (tf.profitPercent != null) summary.profitPercent = tf.profitPercent;
  if (tf.earlyReturn != null) summary.earlyReturn = tf.earlyReturn;
  if (tf.holdDuration != null) summary.holdDuration = tf.holdDuration;
  if (metadata.cards) summary.cards = metadata.cards;

  const details = {};
  if (tf.buyPrice != null) details.buyPrice = tf.buyPrice;
  if (tf.currentPrice != null) details.sellPrice = tf.currentPrice;
  if (tf.highestPrice != null) details.highestPrice = tf.highestPrice;
  if (tf.drawdownFromHighest != null) details.drawdownFromHighest = tf.drawdownFromHighest;
  // ... gmgnUrl, signalsUrl 同买入
  return { summary, details };
}
```

#### GMGN 链接构建

```javascript
_buildGMGNUrl(token, chain) {
  const chainMapping = {
    'bsc': 'bsc', 'binance-smart-chain': 'bsc',
    'eth': 'eth', 'ethereum': 'eth',
    'solana': 'sol', 'sol': 'sol',
    'base': 'base'
  };
  const chainName = chainMapping[(chain || 'bsc').toLowerCase()] || 'bsc';
  return `https://gmgn.ai/${chainName}/token/${token}`;
}
```

#### 买入信号序号查询

```javascript
async _getBuySignalIndex(signal) {
  const { count } = await supabase
    .from('strategy_signals')
    .select('*', { count: 'exact', head: true })
    .eq('token_address', signal.token_address)
    .eq('experiment_id', signal.experiment_id)
    .eq('action', 'buy')
    .lte('created_at', signal.created_at);
  return count;
}
```

### 3.2 通知过滤逻辑

**文件**：`src/trading-engine/core/AbstractTradingEngine.js`

交易引擎处理信号后，通过 `_shouldSendBuyNotification()` 判断是否创建事件：

```javascript
async _shouldSendBuyNotification(signal, isExecuted) {
  const tokenAddress = signal.token_address.toLowerCase();
  if (!tokenAddress) return false;

  // 从内存获取通知状态（引擎重启后重新初始化）
  let state = this._tokenBuyNotificationState.get(tokenAddress);
  if (!state) {
    state = { buySignalCount: 0 };
    this._tokenBuyNotificationState.set(tokenAddress, state);
  }

  // 第3个信号之后不再发送
  if (state.buySignalCount >= 3) return false;

  state.buySignalCount += 1;

  // 只有第1和第3个买入信号触发事件
  if (state.buySignalCount === 1 || state.buySignalCount === 3) {
    return true;
  }
  return false;
}
```

**调用链**：

```
processSignal()                        // 处理交易信号
  → new TradeSignal({...})             // 创建信号实体
  → signal.save()                      // 保存到 strategy_signals 表
  → executeBuy() / executeSell()       // 执行交易
  → _sendSignalNotificationWithFilter()
      → _shouldSendBuyNotification()   // 过滤：第1/3次买入、所有卖出
      → eventService.createEvent()     // 写入 experiment_events
```

### 3.3 API 接口

#### GET /api/events — 获取事件列表

**文件**：`src/web-server.js`

```javascript
this.app.get('/api/events', async (req, res) => {
  const { experiment_id, action, limit = 50, offset = 0 } = req.query;

  let query = supabase
    .from('experiment_events')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (experiment_id) query = query.eq('experiment_id', experiment_id);
  if (action) query = query.eq('action', action);
  query = query.range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  const { data, error, count } = await query;
  if (error) throw error;

  const events = data || [];

  // 动态填充叙事数据（关键步骤）
  await this._enrichEventsWithNarrative(events);

  res.json({
    success: true,
    data: events,
    pagination: { total: count, limit: parseInt(limit), offset: parseInt(offset) }
  });
});
```

#### DELETE /api/events/purge — 清空历史事件

```javascript
this.app.delete('/api/events/purge', async (req, res) => {
  const { keepHours } = req.body;  // 保留最近 N 小时
  const cutoff = new Date(Date.now() - keepHours * 3600000).toISOString();
  const { count } = await supabase
    .from('experiment_events')
    .delete()
    .lt('created_at', cutoff)
    .select('id');
  res.json({ success: true, deleted: count });
});
```

### 3.4 叙事数据动态填充

**这是系统的核心设计**：事件创建时不存储叙事数据，API 查询时实时从 `token_narrative` 表获取。

**文件**：`src/web-server.js` — `_enrichEventsWithNarrative(events)`

```javascript
async _enrichEventsWithNarrative(events) {
  if (!events || events.length === 0) return;

  // 1. 只为买入事件填充叙事（卖出事件不需要）
  const buyEvents = events.filter(e => e.action === 'buy');
  if (buyEvents.length === 0) return;

  // 2. 收集唯一 token_address
  const tokenAddresses = [...new Set(buyEvents.map(e => e.token_address).filter(Boolean))];

  // 3. 批量查询 token_narrative（取每个 token 最新记录）
  const { data: narratives } = await supabase
    .from('token_narrative')
    .select('*')
    .in('token_address', tokenAddresses)
    .order('analyzed_at', { ascending: false });

  // 4. 构建 token_address → 最新叙事记录映射
  const narrativeMap = {};
  for (const n of narratives) {
    if (!narrativeMap[n.token_address]) narrativeMap[n.token_address] = n;
  }

  // 5. 批量查询推文内容（从 external_resource_cache）
  const allTweetUrls = [];
  for (const n of Object.values(narrativeMap)) {
    if (n.classified_urls?.twitter) {
      for (const u of n.classified_urls.twitter) {
        if (u.type === 'tweet' && u.url) allTweetUrls.push(u.url);
      }
    }
  }
  let tweetContentMap = {};
  if (allTweetUrls.length > 0) {
    const { data: tweetData } = await supabase
      .from('external_resource_cache')
      .select('url, content')
      .in('url', allTweetUrls);
    for (const d of tweetData) {
      tweetContentMap[d.url] = {
        url: d.url,
        text: d.content.text.substring(0, 500),
        author: d.content.author_name,
        authorFollowers: d.content.author_followers_count
      };
    }
  }

  // 6. 为每个买入事件填充叙事数据
  const buildLLMAnalysis = await getBuildLLMAnalysis();  // ESM 动态导入，首次缓存

  for (const event of buyEvents) {
    const narrative = narrativeMap[event.token_address];
    if (!narrative) continue;

    const analysis = buildLLMAnalysis(narrative);  // 将 DB 记录转为前端格式
    if (!analysis) continue;

    // 填充评级
    event.summary.narrativeRating = analysis.summary.rating;
    event.summary.narrativeScore = analysis.summary.score;
    event.summary.narrativeNumericRating = analysis.summary.numericRating;

    // 填充叙事原因
    event.details.narrativeReason = analysis.summary.reason;

    // 填充阶段摘要
    event.details.stageSummaries = {
      preCheck: { pass, score, reason, details },
      prestage: { pass, score, category },
      stage1: { pass, score, category, reason },
      stage2: { pass, score, reason },
      stage3: { pass, score, reason }
    };

    // 填充语料来源
    event.details.sourceUrls = narrative.classified_urls;

    // 填充推文内容
    event.details.tweetContents = [tweetContentMap...];
  }
}
```

**ESM 动态导入（CJS 环境中导入 ESM 模块）**：

```javascript
let _buildLLMAnalysis = null;
async function getBuildLLMAnalysis() {
  if (!_buildLLMAnalysis) {
    const mod = await import('./narrative/analyzer/parsers/response-parser.mjs');
    _buildLLMAnalysis = mod.buildLLMAnalysis;
  }
  return _buildLLMAnalysis;
}
```

---

## 4. 前端实现

### 4.1 文件结构

| 文件 | 说明 |
|------|------|
| `src/web/templates/monitor.html` | HTML 模板 + CSS 样式 |
| `src/web/static/js/monitor.js` | JavaScript 逻辑（`type="module"`） |

### 4.2 双模式实时更新

前端支持两种模式，优先使用 Supabase Realtime，失败时降级到 HTTP 轮询。

#### 模式一：Supabase Realtime（实时）

```javascript
async function initRealtime() {
  // 1. 获取 Supabase 配置
  const config = await (await fetch('/api/supabase-config')).json();

  // 2. 动态加载 Supabase JS 客户端
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  supabaseClient = createClient(config.supabaseUrl, config.supabaseAnonKey);

  // 3. 订阅 experiment_events 的 INSERT 事件
  channel = supabaseClient
    .channel('experiment-events-monitor')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'experiment_events' },
      (payload) => onNewEvent(payload.new)       // ← 实时回调
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        startNarrativeRefresh();  // 启动叙事数据定期刷新
      } else {
        startPolling();           // 降级到轮询
      }
    });
}
```

#### 模式二：HTTP 轮询（降级）

```javascript
function startPolling() {
  stopNarrativeRefresh();  // 停止叙事刷新（避免双重刷新）
  pollingTimer = setInterval(pollNewEvents, 5000);  // 5 秒间隔
}
```

### 4.3 事件数据更新策略

**问题**：事件创建时叙事分析可能未完成，需要定期刷新已有事件的叙事数据。

**解决方案**：

#### 轮询模式：pollNewEvents()

每 5 秒调用 `/api/events`，同时处理两件事：

```javascript
async function pollNewEvents() {
  const resp = await fetch('/api/events?limit=20&offset=0');
  const result = await resp.json();
  const apiEvents = result.data;
  let hasUpdates = false;

  // 1. 更新已有事件的叙事数据
  for (const apiEvent of apiEvents) {
    const existing = allEvents.find(e => e.id === apiEvent.id);
    if (existing) {
      if (JSON.stringify(existing.summary) !== JSON.stringify(apiEvent.summary) ||
          JSON.stringify(existing.details) !== JSON.stringify(apiEvent.details)) {
        existing.summary = apiEvent.summary;
        existing.details = apiEvent.details;
        hasUpdates = true;
      }
    }
  }

  // 2. 添加新事件
  const newEvents = apiEvents.filter(e =>
    !allEvents.some(existing => existing.id === e.id)
  );
  if (newEvents.length > 0) {
    allEvents = [...newEvents, ...allEvents];
    hasUpdates = true;
    playNotificationSound();  // 声音提示
  }

  if (hasUpdates) {
    renderEvents();           // 重新渲染
  }
}
```

#### Realtime 模式：叙事数据定期刷新

Realtime 只推送 INSERT 事件，不推送已有事件的数据变化。因此增加独立的叙事数据刷新：

```javascript
// 15 秒刷新一次叙事数据
function startNarrativeRefresh() {
  if (pollingTimer || narrativeRefreshTimer) return;  // 轮询模式不重复
  narrativeRefreshTimer = setInterval(refreshExistingEvents, 15000);
}

async function refreshExistingEvents() {
  const resp = await fetch('/api/events?limit=50&offset=0');
  const result = await resp.json();

  let hasUpdates = false;
  for (const apiEvent of result.data) {
    const existing = allEvents.find(e => e.id === apiEvent.id);
    if (existing && (summary或details有变化)) {
      existing.summary = apiEvent.summary;
      existing.details = apiEvent.details;
      hasUpdates = true;
    }
  }
  if (hasUpdates) renderEvents();
}
```

**两种模式的刷新对比**：

| | 轮询模式 | Realtime 模式 |
|---|---|---|
| 新事件检测 | `pollNewEvents()` 每 5 秒 | Supabase Realtime 即时推送 |
| 叙事数据更新 | `pollNewEvents()` 每 5 秒 | `refreshExistingEvents()` 每 15 秒 |
| 声音提示 | 有 | 有 |
| 启动/停止 | `startPolling()` / `stopPolling()` | `startNarrativeRefresh()` / `stopNarrativeRefresh()` |

### 4.4 声音提示

使用 Web Audio API，无需外部音频文件：

```javascript
function playNotificationSound() {
  if (!soundEnabled) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime);    // 880Hz
  osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1); // 升到 1100Hz
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.3);
}
```

### 4.5 事件卡片渲染

每个事件渲染为一张卡片，包含三层信息：

```
┌─────────────────────────────────────────────────────────┐
│ 头部行：动作标签 | 执行状态 | 代币名 | 地址 | 链 | GMGN │ 时间
│ ─────────────────────────────────────────────────────── │
│ 摘要行：💰 市值 | 📈 涨幅 | 评级徽章 | 利润 | 持仓时长   │
│ ─────────────────────────────────────────────────────── │
│ 操作行：信号 | 策略 | 时序 | 早期 | 持有者 | 详情          │
│ ─────────────────────────────────────────────────────── │
│ 展开区域（可折叠）：                                      │
│   叙事原因 | 阶段详情 | 拒绝原因 | 语料来源 | 推文内容     │
│   价格详情（卖出事件）                                    │
└─────────────────────────────────────────────────────────┘
```

**关键渲染逻辑**：

```javascript
function renderEventCard(event) {
  const s = event.summary || {};
  const d = event.details || {};

  // 第三次买入事件特殊样式（左侧黄色边框）
  const isThirdBuy = event.action === 'buy' && s.signalIndex === 3;

  // GMGN 图标放在头部行（最醒目位置）
  // 操作链接行包含其他快捷链接

  // 展开区域包含：
  // - 叙事原因 (d.narrativeReason)
  // - 阶段详情 (d.stageSummaries) — 每阶段 pass/fail、分数、原因
  //   - 预检查详情：同名代币、语料复用、重复叙事（附带 GMGN 链接）
  // - 拒绝原因 (d.executionReason)
  // - 语料来源 (d.sourceUrls)
  // - 推文内容 (d.tweetContents)
  // - 价格详情（卖出事件）
}
```

### 4.6 筛选功能

三维度筛选 + 代币导航：

```javascript
// 筛选状态
let filterAction = '';   // '' | 'buy' | 'sell'
let filterRating = '';   // '' | 'high' | 'mid' | 'low' | 'unrated'
let filterToken = '';    // 代币符号

function getFilteredEvents() {
  return allEvents.filter(event => {
    if (filterAction && event.action !== filterAction) return false;
    if (filterRating && (event.summary.narrativeRating || '') !== filterRating) return false;
    if (filterToken && event.token_symbol !== filterToken) return false;
    return true;
  });
}
```

代币导航栏聚合所有事件的代币统计，点击可快速筛选：

```
[全部 (42)] [PEPE (买3 卖1)] [DOGE (买2)] [SHIB (买1 卖1)]
```

---

## 5. 数据流完整时序

### 5.1 新事件到达（Realtime 模式）

```
t=0s   交易引擎产生信号 → createEvent() → INSERT into experiment_events
       ↓
t=0s   Supabase Realtime 推送 → onNewEvent() → 卡片出现在页面顶部 + 声音提示
       此时叙事数据为空（分析未开始）
       ↓
t=30s  叙事分析引擎开始处理 → 写入 token_narrative（部分阶段数据）
       ↓
t=45s  refreshExistingEvents() 调用 /api/events → 检测到 summary/details 变化
       → 卡片更新：显示部分阶段信息 + "叙事分析未完成" 标记
       ↓
t=120s 叙事分析完成 → token_narrative 写入 stage_final_result
       ↓
t=135s refreshExistingEvents() → 检测到完整叙事数据
       → 卡片更新：显示完整评级、阶段详情、语料来源、推文内容
```

### 5.2 新事件到达（轮询模式）

```
t=0s   交易引擎产生信号 → createEvent() → INSERT into experiment_events
       ↓
t≤5s   pollNewEvents() → 检测到新 id → 卡片出现在页面顶部 + 声音提示
       （叙事数据已通过 API 动态填充，如已有）
       ↓
t≤10s  下次轮询 → 叙事数据可能已有部分更新 → 卡片刷新
       ↓
t≤120s 叙事分析完成 → 下次轮询 → 完整叙事数据展示
```

---

## 6. 多链支持

### 6.1 链信息传递链路

```
AbstractTradingEngine._blockchain
  → TradeSignal({ chain: this._blockchain })
    → strategy_signals.chain
      → ExperimentEventService.createEvent()
        → experiment_events.chain
          → 前端 formatChain() 显示
          → GMGN URL 动态构建
```

### 6.2 链映射表

```javascript
const chainMap = {
  bsc: 'bsc', eth: 'eth', ethereum: 'eth',
  solana: 'sol', sol: 'sol', base: 'base'
};

// GMGN URL
`https://gmgn.ai/${chainMap[chain]}/token/${address}`

// 前端显示
const displayMap = { bsc: 'BSC', eth: 'ETH', solana: 'SOL', base: 'BASE' };
```

---

## 7. 性能考虑

| 场景 | 数据量 | 耗时 |
|------|--------|------|
| 加载 50 条事件 | 50 events | ~100ms |
| 叙事数据填充（25 个 token） | 25 token_narrative + ~50 tweet | ~100ms |
| 轮询检测新事件 | 20 events | ~50ms |
| 叙事数据刷新（对比更新） | 50 events | ~50ms |

**优化点**：

- `JSON.stringify()` 对比 summary/details，无变化不触发渲染
- 叙事数据批量查询（`.in()`），非逐条查询
- 推文内容只在有 tweet URL 时才查询
- Realtime 模式下叙事刷新间隔 15 秒，避免频繁请求
- `buildLLMAnalysis()` 首次动态导入后缓存

---

## 8. 部署清单

### 8.1 数据库

1. 创建 `experiment_events` 表（见第 2.1 节 DDL）
2. 配置 Supabase Realtime（见第 2.2 节）
3. 确保 `token_narrative` 和 `external_resource_cache` 表已存在

### 8.2 后端

| 依赖 | 说明 |
|------|------|
| `ExperimentEventService` | 事件创建服务 |
| `_enrichEventsWithNarrative()` | API 层叙事数据填充 |
| `getBuildLLMAnalysis()` | ESM 动态导入辅助函数 |
| `processSignal()` | 交易引擎信号处理入口 |

### 8.3 前端

| 文件 | 说明 |
|------|------|
| `monitor.html` | 页面模板 |
| `monitor.js` | 全部前端逻辑 |

### 8.4 环境变量

```
SUPABASE_URL=xxx
SUPABASE_ANON_KEY=xxx
WEB_BASE_URL=http://localhost:3010
```
