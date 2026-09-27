# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Richer-js is an automated trading engine for **BSC four.meme + flap tokens** (BSC-only). Token discovery and prices come from a **常驻 WSS watcher**（ankr WSS event subscription on four.meme TokenManager + flap Portal, fully event-driven, no polling）: watcher 落库 `wss_price_ticks`/`wss_events`，实验进程（virtual / live / backtest，任意数量各自策略）从 DB 增量消费同一份数据流. It supports virtual trading (simulation), backtesting (tick replay), and live trading modes. It also includes a **narrative analysis engine** (Jev structured decision model) that evaluates meme coin events.

## Common Commands

```bash
# Experiment runner (interactive CLI; start/stop experiments)
npm start

# Dev mode
npm run dev

# Web server (port 3010)
npm run web

# Run engine for one experiment directly (virtual mode)
node src/run-engine.js <experiment_id>

# Narrative analysis engine (standalone worker)
npm run narrative-engine

# WSS watcher daemon (常驻双平台采集，182 screen 部署；本地不跑——ANKR key 在 182)
node src/watcher/index.js

# Watcher 架构本地零 DB 单测（打桩 dbManager）
node scripts/_test_watcher_architecture.cjs

# TPA 离线画像构建（step4；只在 182 跑，须在 build-token-profiles 之后——依赖 flash_crash_period）
NODE_OPTIONS=--max-old-space-size=12288 node scripts/build-wallet-profiles.cjs --threshold 3 --days 14

# TPA 本地零 DB 单测（builder/scorer/TPA 三件）
node scripts/_test_wallet_profile_builder.cjs && node scripts/_test_wallet_scorer.cjs && node scripts/_test_tpa.cjs

# live 加固层零 DB 单测（assertMinOut/_awaitReceipt/FlapPortalTrader 打桩）
node scripts/_test_live_hardening.cjs
```

No test framework or CI is configured.

## Architecture Overview

### Main Entry Points

- **`main.js`** - Experiment runner (interactive CLI)
- **`src/run-engine.js`** - Run a single experiment's engine directly (virtual mode)
- **`src/web-server.js`** - Web interface (Express.js, port 3010)
- **`src/narrative/engine/start.mjs`** - Narrative analysis engine
- **`src/watcher/index.js`** - WSS watcher daemon（常驻采集进程）

### Trading Engine Flow (watcher 架构：订阅与消费剥离)

WSS 订阅由**常驻 watcher**（`src/watcher/`，单进程双平台，182 screen + pid 单实例锁）长期持有，不随实验起停；实验进程（任意数量、各自策略）从 DB 增量消费同一份数据流：

```
┌ watcher 进程（src/watcher/WssWatcherService.js，常驻）─────────────────┐
│ FourMemeAnkrWsCollector + FlapAnkrWsCollector（FA/tokenPool=null）      │
│   tick(500ms flush)      → wss_price_ticks (experiment_id=NULL)        │
│   token_create/graduation → wss_events (kind 行；重试队列保证不丢)       │
│   60s heartbeat 行 → 实验侧断供判据 + 人工查活（7 天清理）               │
│   60s 断流自愈（消息静默≥5min → forceReconnect；自引擎迁入）             │
└─────────────────────────────────────────────────────────────────────────┘
     │ wss_price_ticks (exp_id=NULL)        │ wss_events
     ▼                                      ▼
┌ 实验进程 ×N（FourMemeWssTradingEngine / FlapWssTradingEngine）─────────┐
│ SharedTickConsumer（src/trading-engine/core/，1s 轮询 id watermark）：  │
│   events: registerToken → pool.addToken → 引擎._handleNewToken/_handle │
│           Graduation（heartbeat 只推水位不派发）                        │
│   ticks:  pool.updatePrice → minTickBnb 门 → FA.processTick            │
│           (emitFactors:true) → priceOutlier 命中行批量回写              │
│ 引擎既有 factorsUpdated → OPB/卖腿实时/买腿 debounce 管线零改动         │
└─────────────────────────────────────────────────────────────────────────┘
```

**SharedTickConsumer 关键机制**：首拉 `select max(id)` 对齐（只消费启动后新行，等价旧订阅行为）；水位延迟一周期提交 + `(tx_hash,log_index)` 去重集（对抗 bigserial 分配序≠提交序的双写者竞态）；**禁止服务端 platform 过滤**（异平台行须进结果集推水位，本地过滤）；先 events 后 ticks 串行（同周期 create 先应用）。乱序自愈：FA.processTick 对未注册 token 自动建 state，registerToken 幂等回填更早 createdAtMs。

Two engines via `src/trading-engine/implementations/`:
- **FourMemeWssTradingEngine** - virtual (simulated accounting) and live (`FourMemeDirectTrader` on-chain trades) modes in one engine; platform via `_wsConfigSectionName()`/`_wsPlatforms()`（flap 子类覆盖）
- **BacktestEngine** - replays `wss_price_ticks` through the same factor-strategy pipeline（**token 集合 + platform 口径**：`_tokenMeta` 全集 100 地址/批 `.in` + platform 按单值 `.eq` 循环（`.in` 多值等价无过滤，planner 弃索引致 statement timeout），分块后全局 id 归并排序；不再按 experiment_id——watcher 新行 exp_id=NULL）
- **FlapWssTradingEngine** - extends FourMemeWssTradingEngine（virtual + live：`FlapPortalTrader` Portal `swapExactInput`，见 Live Trading 节）

### 双平台实验（config.platform='both'，2026-09-27 上线）

一个实验同时交易 fourmeme+flap 两平台代币：**单引擎实例 per-token 分派**（基类 `_handleNewToken(info, platform)` 按 consumer 传入的行平台分派 `_buildFourMemeTokenRecord`/`_buildFlapTokenRecord`），共用同一套买/卖策略与单一资金池（PM 单组合）；FlapWssTradingEngine 改薄（`_handleNewToken` 逻辑入基类，保留 constructor/`flapWs` 段/`_buildTokenInfo` 无 name 版/live throw）。

- **归一化唯一入口** `resolvePlatforms(platform)`（`src/trading-engine/core/platforms.js`）：`'both'`→`['fourmeme','flap']`、`'flap'`→`['flap']`、其余→`['fourmeme']`
- **范围 virtual + backtest + 单平台 live（fourmeme/flap 各自）**；双平台 live 三重防线禁止：web-server POST 400（live && platform='both'）/ main.js `_createEngine` throw / 前端提交拦截
- **引擎级配置恒读 fourmemeWs 段**（`_wsConfigSectionName()` 基类返回值，flap 子类才覆盖 flapWs）；FA 构造键名固定 fourmemeWs；corpusEnrich per-token 分派
- **创建页平台选择 = 多选 checkbox**（结构保证至少一勾；双勾 POST 标量 `'both'`；live 模式 flap 禁用联动；复制链路 both→双勾回填）
- 存量单平台实验零行为变化（182 重启回归验证：引擎身份/配置段/水位对齐保持）
### Watcher 架构口径变化（2026-09-24 切换）

1. **`wss_price_ticks` 新行 `experiment_id=NULL`**：watcher 写的行免疫删实验级联；删历史实验仍级联删其名下旧行（FK 仍在，混合保留语义）
2. **tvl 因子恒 0**：DB 行无 offers/funds_bnb（four.meme 虚拟对齐回测口径；flap 一直如此）
3. **price_outlier 消费侧回写**：新行落库 false，consumer 判离群后批量 UPDATE（延迟 ~1s）
4. **实验级 collector 配置失效**：实验 config 的 `fourmemeWs/flapWs` 段 contracts/tickBuffer/reconnect/endpoint 覆盖无效（watcher 只读 default.json）；debounce/FA 参数/conpusEnrich 仍实验侧生效
5. **端到端延迟 +~1.5s**：flush(≤0.5s) + 轮询(1s)；卖腿止损同此
6. **wss-down-guard 改判据**：consumer `lastIngestAt` 15min 停滞（watcher 60s 心跳行保证市场安静时不误报）→ status='wss_down'；自愈 forceReconnect 已迁 watcher，实验侧只告警

### Narrative Analyzer (Jev Structured Decision Engine)

**Location**: `src/narrative/`

The narrative analyzer evaluates whether a meme coin's underlying event has narrative value. All LLM decisions run through **Jev** (TypeSafe System One, `api.typesafe.ai`): a structured decision model with three primitives (Choice/Score/Noul), no text generation, one speculative fan-out call per token (~seconds). The former 3-stage generative pipeline (Stage 1 preprocessing → Stage 2 category scoring → Stage 3 token analysis) was fully replaced.

```
Token URL → URL Classification (incl. IPFS metadata unpack) → Data Fetching → Pre-Check (rules, no LLM)
                                                        ↓
                              account/community token? ── yes → prestage Jev (4 questions, P1.2)
                                                        │       rules validation first (account-community-rules.mjs)
                                                        │       → account_based_meme / web3_native_ip_early / project
                                                        │         (rating math in jev-prestage-mapper.mjs)
                              issuer self-launch? ────── yes → prestage Jev (same flow)
                              (brand identity + announcement fingerprint, code-only)
                                                        ↓ no
                              super-IP account? ── yes → super-IP fast track (standard question set + code pre-scores)
                                                        ↓ no
                              standard path: single Jev call (13 questions, J1.10)
                              classification/magnitude/timing/block/W-class/relevance/quality asked atomically;
                              aggregation/thresholds/truncation in jev-result-mapper.mjs (code-side)
```

**Two-path model (user decision 2026-09-24)**: rider coins (issued by a third party riding an influential product) stay on the standard path where W-class math requires the *ridden product* to have extreme influence; issuer self-launched coins (announced by the brand owner's own account) must NOT be gated on current influence — `detectIssuerSelfLaunch` (narrative-utils.mjs, code-only: token symbol/name bidirectionally contains the tweet author's handle/nickname + the author's own text mentions the brand) reroutes them to prestage account judgment. Word-extraction rider coins (C3/CONVICTION class: word from a tweet but unrelated to the author's identity) fail brand identity and stay on W-math.

**Jev layer** (`analyzer/llm/`):
- `JevClient.mjs` - HTTP client; `ask(state, questions, {label})` → answers (throws on missing answer ids — no error swallowing); 429/5xx backoff
- `jev-questions.mjs` - Standard 13-question set `J1.10` (`buildStandardQuestions({includeBrandHijack})`)
- `jev-prestage-questions.mjs` - Prestage 4-question set `P1.2` (token type / abm name link / abm web3 traffic / community activity)
- `jev-state-builder.mjs` - `buildJevState` (60k budget) + `buildPrestageState` (20k budget): state assembly with section quotas
- `jev-result-mapper.mjs` - Standard/super-IP answer mapping: stage1/2/3 result construction, scale calibration constants (MAGNITUDE_TIER_SCORES, DIM2_BANDS)
- `jev-prestage-mapper.mjs` - Prestage mapping: project rating table (followers/members floors), abm two-condition verdict, all deterministic math code-side

**Version rule**: editing any question's instructions/criteria requires bumping its version constant (`JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`); prompt_type/prompt_version columns identify them (`jev(J1.10/…)`, `prestage-jev(P1.2/…)`).

**Super IP** (`prompts/super-ip/super-ip-registry.mjs`): Known high-influence accounts (CZ, Elon Musk, Binance official, etc.) reuse the standard question set with code pre-scores; tier S (world-class) / A (known).

**Key supporting services** (`analyzer/services/`):
- `tweet-type-classifier.mjs` - Pre-classifies tweets (feeds Jev standard path context)
- `frequent-issuers.mjs` - Registry of ~94 accounts that frequently create tokens
- `pre-check-service.mjs` - Validates data quality before analysis (rules, no LLM). **Time-base rule (user decision 2026-09-23)**: staleness is measured against the **token creation time** (`raw_api_data.created_at`), never wall-clock analysis time — "was the corpus fresh at mint". This applies to expired tweet (10min) / expired video (365d) pre-checks, Jev state timeliness (`buildJevState({now})`), prestage state, and super-IP `calculateTimeliness` — making re-runs/backtests/delayed analysis idempotent. Missing creation time: pre-check skips the expiry rules; Jev state falls back to wall clock.
- `data-fetch-service.mjs` - Coordinates multi-platform data fetching; includes four.meme IPFS metadata unpacking (`ipfs-metadata-fetcher.mjs`): when API twitterUrl/webUrl are empty, real social links live only in the on-chain metadata JSON (`raw_api_data.meta` IPFS URL) — fetched via multi-gateway (pinata primary, ipfs.io is sunset) and merged into URL classification; unpack success removes the meta URL from the websites bucket
- `account-analysis-service.mjs` - Account/community prestage flow (rules validation → Jev prestage)

**Rules (no LLM)**: `prompts/account/account-community-rules.mjs` - account quality gates, address verification, name matching; `prompt-builder.mjs` only provides `getPromptTypeDesc`.

**Platform data fetchers** (`utils/`): twitter, weibo, github, youtube, douyin, bilibili, xiaohongshu, instagram, tiktok, weixin, amazon, binance-square, web

**Narrative Analysis Engine** (`engine/`): Multi-threaded worker architecture with task queue, polling from DB, concurrency 30. Config in `config/narrative-engine.json` (`engine` + `jev` sections; JSON is the single source of truth — env overrides were removed). Worker task timeout = `engine.taskTimeout`.

### Pre-Buy Check System

`src/trading-engine/pre-check/` — evaluates token risk before purchase:

```
PreBuyCheckService.performAllChecks()
    ├── EarlyParticipantCheckService (first 90 seconds trades, from `wss_price_ticks`)
    │   └── WalletClusterService (cluster detection, reuses trades data)
    └── TokenHolderService (holder blacklist via AVE API)
```

EarlyParticipantCheckService queries `wss_price_ticks` (market-wide per token, rows mapped to AVE-trade-compatible shape so WalletCluster/WalletLabel/TokenHolder are unchanged). An empty window returns real zero stats (reject semantics), not the legacy "probably graduated" pass-through values — those remain only for query errors.

All pre-buy factors stored in signal metadata under `preBuyCheckFactors`. Pre-buy checks only run when the buy strategy defines `preBuyCheckCondition` (first round) / `repeatBuyCheckCondition` (later rounds) — strategies cloned from legacy configs without these fields buy without pre-checks.

**Narrative rating direct call** (`narrativeCallCondition`, strategy field): when a buy strategy defines it and the condition holds at fire time (evaluated over the same fire factors as the strategy condition — `age`/`earlyReturn`/activity/trend, NOT narrativeRating itself), the buy leg synchronously calls `NarrativeAnalyzer.analyze()` via `NarrativeDirectCaller` (`src/trading-engine/pre-check/NarrativeDirectCaller.js`) after the blacklist check and before the pre-buy check. Jev is seconds-fast; 30s timeout via Promise.race (the timed-out analysis keeps running in the background, upserts, and the next round hits the cache), failure/timeout normalize to 9 and pass through — the strategy decides via `narrativeRating` in `preBuyCheckCondition`. Not configured / not triggered = always 9, identical to legacy behavior. BacktestEngine uses the same direct-call path (temporal leakage: analyze uses current corpus on historical tokens — absolute returns are not real-time achievable, compare relative increments only). Trigger trail lands in signal metadata as `narrativeCall`. Condition syntax: AND/OR only — `&&`/`||` are silently truncated (rest of the expression is dropped, no error).

**Narrative results are token-level global cache**: `token_narrative` is keyed by `token_address` (global upsert) and is NOT attached to experiments — the same token shares one result across all experiments/callers; `analyze()` reuses any valid (`is_valid`) cache hit regardless of experiment, `ignoreCache: true` forces re-analysis. `experiment_id` is no longer written on save (legacy values in old rows are left as-is); to invalidate stale results use row delete or `NarrativeRepository.updateIsValid(address, false)` — a cleanup mechanism (e.g. invalidate all rows when the narrative module changes) is planned but not built yet.

### OnlineProfileBuilder（在线代币分类；pumpfun 批 3.1 回迁）

`src/services/OnlineProfileBuilder.js` — 内嵌 FourMemeWssTradingEngine 的实时代币分类器，交易活跃度下降时触发（双门：idle 60s 无 tick / bigTickIdle 600s 无 ≥clsBigTickBnb 大额 tick；`_onFactorsUpdated` tick 入口 + 60s `_scanIdleTokens` 扫描补救死后零 tick token），写 `token_profiles` 表（token_address 全局 PK upsert，source='online'，不挂实验维度防级联删）。阈值判定与离线 classifyToken 共用 `scripts/shared/token-classifier.js`（单一真相）；metrics 直接读 FA state 标量（`_clsTicks`/`_relHighest*`/`_lastBigTickAt`/afterFirst9s 三元组），maxMarketCap = 可靠价峰 USD × totalSupply。

- **opt-in**：`config.fourmemeWs.onlineProfile.enabled` 默认 false（default.json 与实验级均可配；both 实验引擎级配置恒读 fourmemeWs 段）；启动时构造——改 config 须重启实验进程。BacktestEngine 不嵌（回测无写表副作用）
- **TPA 联动**：落库成功回调 `onProfileClassified` → `TokenPositionAnalyzer.upsertTokenProfileCache` 喂分类缓存（修 stuck-null；TPA 未启用时传 null 不挂钩）
- **重启过渡期边界**：水位对齐之前的存量活跃 token 不派发 create → FA tick 自动建 state（totalSupply=0）→ mcap=0 恒 low_quality 误标，离线 build-token-profiles.cjs 重跑覆盖纠正
- **单测**：`node scripts/_test_token_classifier.cjs`（分类阈值/visible_at/FA 对拍/触发门/扫描，零 DB）；2026-09-27 起在虚拟实验 c5945f36 实跑开启

### Token Position Analyzer（TPA，触发点 as-of 钱包画像；pumpfun 批 4 回迁）

`src/services/TokenPositionAnalyzer.js` — 代币触发门命中时（write-once，一 token 一次）对 top20 持仓者做 as-of 画像，产出 `TPAPre_*` 因子族（17 持仓键）注入 FA（`setHoldingFactors`/`setRetentionBasis` 静态注入 + `setAsofMs` 冻结审批价），FA `buildFactorMap` 尾部 spread 后 `TPAAnalyzed`/`TPAPre_retention`/`TPAPre_asofRelFirst` 可读；策略 condition 引用未触发的 `TPAPre_*` 恒 null → ConditionEvaluator false = **fail-closed 不买（去门控化）**。verdict 收口 `zhuangCondition`（默认 `TPAPre_tokenScore > 2 AND TPAPre_zhuangRetailRatio > 0.3`；`∞` 庄散比落表 null + `TPAPre_zhuangRetailRatioInfinite` 布尔）。

- **opt-in 挂载**：`config.tokenPositionAnalyzer == null` → 不构造（存量实验零影响）；段存在才构造并走 trigger fail-fast（时间门 blocks/ageSeconds 恰一，数量门 tradeCount/buyBnb/minHolders 非负）。live/回测引擎 `_onFactorsUpdated`/主循环触发，落表 `token_position_analyses`（enforce 落表标记；**shadow 姿态默认 enforce=false，策略条件暂不引用 TPAPre_*，纯观察**）
- **三路径画像**（钱包=地址属性，跨平台无过滤）：`wallet_offline_profiles`（step4 预计算）fresh 直用 / stale 增量 `mergeOfflineProfile` 合并 / miss 实时拉 `[asOf-14d, asOf]` ticks 现算（`wallet-profile-builder.js`，bad_action 口径单一源）
- **retention 基准**：触发刻从 `faState._traderMaxNetTokens` 峰值枚举大户集（含已清仓）冻结 `netZAtDecision`，此后每 tick 用 running `_traderNetTokens` 求和重算（净卖 → <1 走人实锤）
- **回测防前视**：BacktestEngine `_alignClassifiedAsOf=true` — `category_visible_at`（回退 `classified_at`）> asOf 的 token_profiles 分类视为未见（bad_action 不计）；回测侧 `setHistoricalTicks` 内存索引 + `persistSink` 走 BacktestWriteBuffer 批量落表
- **离线构建（step4）**：`build-wallet-profiles.cjs`（182 专用，`--threshold 3 --days 14`）两阶段聚合（HF 筛选 → 64 磁盘桶 → token_profiles 预查 → buildProfileFromTicks(asOfMs:null)），跑完删 `data/offline-cache/wallet_offline_profiles.jsonl.gz`；**必须在 build-token-profiles 之后跑**（依赖 flash_crash_period）；上线读侧前必须先全量跑完（`mergeOfflineProfile` 的 `aggregatedTradeCount` 哨兵 throw 防错配）
- **web 展示**：`/experiment/:id/position-analysis`（PositionAnalysisService + `experiment_position_analysis.*`），verdict/holding_factors/分类对照/表达式过滤

### Chain Support (BSC-only)

`src/utils/BlockchainConfig`: BSC only. Historical experiments on other chains (solana/base/ethereum) remain readable for display — unknown chain IDs fall through `normalizeBlockchainId` as lowercase originals instead of throwing; trading/config lookups throw for non-BSC.

### Web Interface

`src/web/` + `src/web-server.js`:
- Trading engine dashboard
- Narrative analyzer UI (`/narrative-analyzer`, `/narrative-tasks`)
- API: `/api/narrative/analyze`, `/api/narrative/tasks`, `/api/narrative/result/:address`
- K-line / current prices come from `wss_price_ticks` (via `src/web/services/tick-kline-service.js`); AVE tool endpoints (`/api/ave-*`) are kept for ad-hoc analysis

### Database

Supabase backend via `src/services/dbManager.js`. Key tables: `experiments`, `strategy_signals`, `trades`, `token_holders`, `wallets`, `experiment_tokens`, `experiment_time_series_data`, `token_monitoring_pool`, `wss_price_ticks` (raw trade ticks; UNIQUE(tx_hash, log_index), first writer owns the row; watcher 写入行 experiment_id=NULL; `quote_token` 标记 flap 非 BNB 计价盘——collector 按 PCS V2 quote/WBNB 实时汇率换算 price_bnb/bnb_amount 后落库，换算不可得跳行，BNB 盘为 NULL，历史 ~10,971 盘未回填), `wss_events` (token_create/graduation/heartbeat 低频事件通道，token 级全局表不挂 experiment 维度), `wallet_offline_profiles` (step4 钱包离线画像，address PK 全局无 platform), `token_position_analyses` (TPA 触发落表，UNIQUE(experiment_id,token_address,trigger_no); CASCADE 挂 experiments), plus narrative-specific tables managed by `src/narrative/db/NarrativeRepository.mjs`.

Experiment deletion is DB-level: every experiment-owned table carries `experiment_id → experiments(id) ON DELETE CASCADE` (see `scripts/sql/migrate-experiment-cascade-delete.sql`), so deleting the experiments row removes all its data — the web layer just deletes the row, no per-table cleanup.

## Configuration

- **`config/default.json`** - `fourmemeWs` section (contracts, reconnect, tickBuffer, debounce, live execution params) + strategy defaults (buyTimeMinutes: 1.33, earlyReturnMin: 80, earlyReturnMax: 120)
- **`config/narrative-engine.json`** - Jev client settings (`jev` section: endpoint/model/TYPESAFE_API_KEY env/timeout) + engine concurrency/timeouts
- **`config/.env`** - Environment variables (ANKR_WS_URL, AVE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, MINIMAX_API_KEY, ENCRYPTION_KEY for live wallet private keys, etc.)

## Strategy Parameters

- **Buy timing**: 1.33 minutes after token creation
- **earlyReturn range**: 80-120% (key buy signal)
- **Take profit**: +30% sell 50%, +50% sell remaining
- **Observation window**: 30 minutes

## Card Position Management (migrated from rich-js, 2026-09-27)

Token-level card ledger（用户裁定：组合级现金卡不迁）。**机制开关 = `experiment.config.positionManagement.perCardBNB` 存在且 >0**；不配 → 卡牌字段全忽略，存量实验零变化。

- **策略级字段**（买/卖腿均可）：`cards`（正整数；卖腿额外接受 `"all"`=全清）+ `cooldownSec`（正数秒，独立于卡牌，任何实验可用）。归一化在 `StrategyEngine.loadStrategies` 的 `normalizeCards`（脏值→null=旧语义）
- **买入**：金额 = `perCardBNB × (strategy.cards ?? 1)`（Decimal；virtual 现金门不足返 0=买失败不降张；live 用 `_buyAmountFor(signal)` 不走 PM cash 门，链上余额才是真门）。买成功 `_tokenCards[addr] += cards`
- **卖出 sizing**（`_emitSellSignal` 解析进 signal）：`soldN = cards==='all' ? tokenCards : min(cards, tokenCards)`；`sellPct = soldN >= tokenCards ? 1 : soldN/tokenCards`（全清腿恒精确 1 → PM `remainingAmount.eq(0)` 删仓判据成立）。未启用/未配 cards → 旧 `sellPercentage ?? 1` 路径
- **卡账本**：引擎实例 `_tokenCards = Map()`（原始地址 key，同 `_roundLedger` 口径）；维护在 `_executeSell` 成功分支——`cardTrade ? (after>0 ? set : delete) : (fullyClosed ? delete : 不动)`（强平腿/sellPct=1 腿不带 cardTrade 但全清→delete 防重买后卡数虚高）
- **重启恢复**：trades.metadata 记 `cardTrade: { cards, before, after }`（信号构造时点的绝对值）；`_loadHoldings`/`_loadHoldingsLive` 重放读 `after` 绝对值 set/delete
- **冷却**：`StrategyEngine.evaluate` 内 maxExecutions 检查后；期内腿返回 null→低优先级腿可顶上（与 maxExecutions 跳过语义一致）。回测传虚拟时钟（`recordStrategyExecution` 第 4 参），实时墙钟缺省
- **UI**：create_experiment.html 表单键 `cards`/`cooldownSec`/`per_card_bnb`；`card.dataset.rawConfig` 整包存复制源策略，collectFormData 的 `mergeRawConfig` 合并表单白名单外键（复制链路保真 bypassDebounce/sellPercentage 等无 UI 输入字段）
- **单测**：`node scripts/_test_card_position_mechanisms.cjs`（归一化/冷却/Decimal 精度边界三节，零 DB）

## Live Trading（实盘加固，2026-09-27）

双平台 live 全链路已通：four.meme 走 `FourMemeDirectTrader`（TokenManager2），flap 走 `FlapPortalTrader`（Portal `swapExactInput`；**live 只买 BNB 计价盘**——非 BNB 盘合约 revert = 天然 fail-closed；卖出 token→0x0 全盘支持）。live 实验只能 `node main.js start-experiment -e <id>` 启动（`src/run-engine.js` 对 live 显式拒绝，防被静默当虚拟盘）。实收解析用**余额差法**（买入 token `balanceOf` 前后差 = 税后真相；卖出 BNB `getBalance` 差 + `gasUsed×gasPrice` 补偿），对税币/非 BNB quote 盘免疫（TokenSold 事件 `eth` 字段非 BNB 盘记 quote 币，事件解析不可用）。

防御分层（参数在 default.json `fourmemeWs.live`/`flapWs.live`，验收 runbook `docs/live-acceptance-runbook.md`）：

- **L1 预成交校验 `assertMinOut`**（`traders/core/preTradeCheck.js` 纯函数）：trader 签名前校验「报价到手 vs 引擎信号价预期」，ratio < `minOutRatio`(默认 0.5) 拒单——BURNIE 报价错位/尘埃报价防线（相对滑点对尘埃失效）。`expectedTokenOut`/`expectedNativeOut` **契约必传**（缺即 throw，逼调用方显式表态）；卖出侧预估失败（trySell/quote）且有预期锚 → fail-closed 拒绝裸奔卖出（无锚独立工具路径保留旧行为）。事前/事后 ratio 语义刻意不统一，勿"统一"
- **L3 卖出熔断**：引擎 `_sellFailStreak` 连败 ≥ `sellCircuitBreakerFailures`(5) → `sellCircuitBreakerCooldownMs`(30min) 长冷却 + Telegram 告警；成功清零
- **L5 `_awaitReceipt`**：`waitForTransaction(hash,1,txWaitTimeoutMs 120s)` 超时回查一次 `getTransactionReceipt`，仍未上链 throw 带 txHash——**绝不自动重发防双买**；reverted throw
- **持仓数上限 `maxPositionTokens`**（0=不限，只拦新开仓）；**毕业告警**：live+bought 毕业 → Telegram 告警人工去 PCS 处置（TM2 毕业卖出必 revert）
- **多态 `_liveTraderType()`**：基类 'fourmeme' / FlapWssTradingEngine 覆盖 'flap'（`_initializeLiveTrader` 走 `traderFactory.createTrader`）；钱包解密/余额门/BNB-USD 锚定/恢复全复用父类
- **钱包复用（轻量版钱包管理）**：web 创建 live 实验时「复用历史钱包」下拉（`GET /api/live-wallets` 去重地址列表，不含私钥）→ 提交 `wallet.reuseExperimentId` → 服务端从源实验拷贝加密私钥密文（地址一致性校验 400），私钥永不回传前端；要求两端 ENCRYPTION_KEY 一致
- **单测**：`node scripts/_test_live_hardening.cjs`（零 DB：assertMinOut 全分支含 BURNIE 数值复现、`_awaitReceipt` 超时语义、FlapPortalTrader quote 方向/拒单在签名前/余额差记账/钳制/approve/实收=余额差+gas 补偿——真实 JsonRpcProvider+Wallet 实例 + 实例级 RPC 方法覆盖打桩；ethers v6 导出属性 getter-only，`ethers.Contract` 不可 monkey-patch）
- **真实资金验收未做**（需用户钱包，见 live-acceptance-deferred 记忆与 runbook）；flap 毕业/非 BNB 盘卖出 revert 属预期 fail-closed 行为

## Important Notes

- **Pre-buy check factors are always calculated** - No enable/disable configuration
- **Wallet cluster data reuse** - WalletClusterService reuses trades from EarlyParticipantCheckService
- **AVE API token format**: `{address}-{chain}` (e.g., `0x1234...abcd-bsc`) — AVE is now only used for holder/pre-check tooling and `/api/ave-*` analysis endpoints, not for discovery or prices
- **Snapshot ID format**: `{token_address}_{timestamp}`
- **Case sensitivity**: Wallet addresses are case-sensitive when querying database
- **Factor building**: Use `FactorBuilder.buildPreBuyCheckFactorValues()` when adding new pre-buy factors
- **Narrative prompts are ESM** (`.mjs`) while trading engine is CommonJS (`.js`) — don't mix import styles
- **Never delete experiment rows that have produced data** — deleting cascades to `wss_price_ticks` rows (race-owned by experiment_id) and loses them globally forever（watcher 架构后新行 exp_id=NULL 免疫级联，但历史行仍级联——删历史实验前必须用户裁定）
- **smart-wallet-mining 待迁**（watcher 架构遗留批次）：`scripts/smart-wallet-mining/` 仍按 experiment_id 口径拉 ticks（data-fetcher.js / mine-smart-wallets.cjs pickSources / verify-smart-wallets.cjs）——对新实验（exp_id=NULL ticks）会静默拉空，需改 token 集合或 received_at 全局窗口+platform 口径
- **Watcher 单实例**：`pids/wss-watcher.pid` 锁 + kill(pid,0) 探活；watcher 挂掉 → 实验侧 15min wss_down 告警（不自愈，需人工/监控重启 watcher）

## Adding New Pre-Buy Factors

1. Add factor calculation to appropriate service (e.g., `WalletClusterService`)
2. Add factor to `getEmptyFactorValues()` in the service
3. Add factor to `PreBuyCheckService._evaluateWithCondition()` context
4. Add factor to `FactorBuilder.buildPreBuyCheckFactorValues()` (for backtest compatibility)
5. Add factor to `FourMemeWssTradingEngine.js` preBuyCheckFactors construction (for virtual/live trading)

## Modifying Jev Question Sets

1. Edit the question's `instructions`/`criteria` in `src/narrative/analyzer/llm/jev-questions.mjs` (standard path) or `jev-prestage-questions.mjs` (prestage)
2. Bump `JEV_QUESTIONS_VERSION` / `JEV_PRESTAGE_QUESTIONS_VERSION`
3. If aggregation semantics change, update the mapping in `jev-result-mapper.mjs` / `jev-prestage-mapper.mjs`
4. Validate with `node scripts/narrative/jev_calibration.mjs` (standard) or `jev_prestage_calibration.mjs` (prestage) — check rating agreement and that no rating flips cross the buy boundary
