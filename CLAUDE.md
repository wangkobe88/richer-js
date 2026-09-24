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
- **FourMemeWssTradingEngine** - virtual (simulated accounting) and live (`FourMemeDirectTrader` on-chain trades) modes in one engine; platform via `_wsConfigSectionName()`/`_wsPlatform()`（flap 子类覆盖）
- **BacktestEngine** - replays `wss_price_ticks` through the same factor-strategy pipeline（**token 集合 + platform 口径**：`_tokenMeta` 全集 100 地址/批 `.in` + `.eq('platform')`，分块后全局 id 归并排序；不再按 experiment_id——watcher 新行 exp_id=NULL）

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

### Chain Support (BSC-only)

`src/utils/BlockchainConfig`: BSC only. Historical experiments on other chains (solana/base/ethereum) remain readable for display — unknown chain IDs fall through `normalizeBlockchainId` as lowercase originals instead of throwing; trading/config lookups throw for non-BSC.

### Web Interface

`src/web/` + `src/web-server.js`:
- Trading engine dashboard
- Narrative analyzer UI (`/narrative-analyzer`, `/narrative-tasks`)
- API: `/api/narrative/analyze`, `/api/narrative/tasks`, `/api/narrative/result/:address`
- K-line / current prices come from `wss_price_ticks` (via `src/web/services/tick-kline-service.js`); AVE tool endpoints (`/api/ave-*`) are kept for ad-hoc analysis

### Database

Supabase backend via `src/services/dbManager.js`. Key tables: `experiments`, `strategy_signals`, `trades`, `token_holders`, `wallets`, `experiment_tokens`, `experiment_time_series_data`, `token_monitoring_pool`, `wss_price_ticks` (raw trade ticks; UNIQUE(tx_hash, log_index), first writer owns the row; watcher 写入行 experiment_id=NULL), `wss_events` (token_create/graduation/heartbeat 低频事件通道，token 级全局表不挂 experiment 维度), plus narrative-specific tables managed by `src/narrative/db/NarrativeRepository.mjs`.

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
