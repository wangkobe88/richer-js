# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Richer-js is an automated trading engine for **BSC four.meme platform tokens** (BSC-only). Token discovery and prices come from an **ankr WSS event subscription** on the four.meme TokenManager contract (fully event-driven, no polling); every trade tick is persisted to `wss_price_ticks`. It supports virtual trading (simulation), backtesting (tick replay), and live trading modes. It also includes a **narrative analysis engine** that evaluates meme coin events using a 3-stage LLM pipeline.

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
```

No test framework or CI is configured.

## Architecture Overview

### Main Entry Points

- **`main.js`** - Experiment runner (interactive CLI)
- **`src/run-engine.js`** - Run a single experiment's engine directly (virtual mode)
- **`src/web-server.js`** - Web interface (Express.js, port 3010)
- **`src/narrative/engine/start.mjs`** - Narrative analysis engine

### Trading Engine Flow (WSS event-driven)

```
ankr WSS (TokenManager2 logs subscription)
  ├─ TokenCreate    → token discovery (TokenPool + experiment_tokens)
  ├─ TokenTrade     → tick (dedup txHash+logIndex) ──┬→ wss_price_ticks (batch upsert)
  │                                                 ├→ TokenPool.updatePrice
  │                                                 └→ FourMemeFactorAggregator.processTick
  │                                                     └─ factorsUpdated → FourMemeWssTradingEngine
  │                                                                          ├─ sell leg: per-position realtime
  │                                                                          └─ buy leg: debounce (burst+maxWait)
  └─ LiquidityAdded → graduation (PancakeSwap route on live sells)
```

Two engines via `src/trading-engine/implementations/`:
- **FourMemeWssTradingEngine** - virtual (simulated accounting) and live (`FourMemeDirectTrader` on-chain trades) modes in one engine
- **BacktestEngine** - replays `wss_price_ticks` through the same factor-strategy pipeline (`FA.processTick(emitFactors:false)`)

### Narrative Analyzer (3-Stage LLM Pipeline)

**Location**: `src/narrative/`

The narrative analyzer evaluates whether a meme coin's underlying event has narrative value. It's a multi-stage LLM pipeline:

```
Token URL → URL Classification → Data Fetching → Pre-Check
                                                        ↓
                                              Tweet Type Classification
                                              (interpretive_reply / angle_seeking / direct_tweet)
                                                        ↓
                                              Stage 1: Event Preprocessing
                                              (event description + category classification)
                                                        ↓
                                              Stage 2: Category Scoring
                                              (8 categories, each with scoring rules)
                                                        ↓
                                              Stage 3: Token Analysis
                                              (relevance + quality + brand hijacking check)
```

**Stage 1** (`prompts/stage1/`): Extracts event description (theme, subject, content, timing, key entities) and classifies into one of 8 categories. Different prompts for different tweet types (angle-seeking, interpretive reply, direct tweet).

**Stage 2** (`prompts/event-scoring-categories/`): Category-specific scoring with hard blocking conditions:
- **A类** (Visual IP): Characters, mascots, virtual images
- **W类** (Web3 Project): Blockchain/crypto project launches
- **B类** (Product Event): Non-Web3 product launches/updates
- **F类** (Discovery): Hidden pattern/narrative discoveries
- **G类** (Speculative): Future predictions with reasoning
- **C类** (Personal Statement): Person statements/actions
- **D类** (Institutional Action): Institution announcements
- **E类** (Social Hotspot): Social media trends/viral content

**Stage 3** (`prompts/stage3-token-analysis.mjs`): Token-event relevance, token quality, brand hijacking detection (3 layers:知名代币名/知名人物名/著名机构名).

**Super IP Fast Track** (`prompts/super-ip/`): Known high-influence accounts (CZ, Elon Musk, Binance official, etc.) bypass the 3-stage pipeline and get evaluated in a single LLM call. Tier system: S (world-class) and A (known).

**Key supporting services** (`analyzer/services/`):
- `tweet-type-classifier.mjs` - Pre-classifies tweets before Stage 1
- `frequent-issuers.mjs` - Registry of ~94 accounts that frequently create tokens
- `pre-check-service.mjs` - Validates data quality before analysis
- `data-fetch-service.mjs` - Coordinates multi-platform data fetching
- `account-analysis-service.mjs` - Community and account background analysis

**Platform data fetchers** (`utils/`): twitter, weibo, github, youtube, douyin, bilibili, xiaohongshu, instagram, tiktok, weixin, amazon, binance-square, web

**Narrative Analysis Engine** (`engine/`): Multi-threaded worker architecture with task queue, polling from DB, configurable concurrency (default 30). Config in `config/narrative-engine.json`.

**Prompt loading**: `analyzer/prompt-loader.mjs` dynamically loads Stage 2 prompts based on Stage 1's classification result.

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

### Chain Support (BSC-only)

`src/utils/BlockchainConfig`: BSC only. Historical experiments on other chains (solana/base/ethereum) remain readable for display — unknown chain IDs fall through `normalizeBlockchainId` as lowercase originals instead of throwing; trading/config lookups throw for non-BSC.

### Web Interface

`src/web/` + `src/web-server.js`:
- Trading engine dashboard
- Narrative analyzer UI (`/narrative-analyzer`, `/narrative-tasks`)
- API: `/api/narrative/analyze`, `/api/narrative/tasks`, `/api/narrative/result/:address`
- K-line / current prices come from `wss_price_ticks` (via `src/web/services/tick-kline-service.js`); AVE tool endpoints (`/api/ave-*`) are kept for ad-hoc analysis

### Database

Supabase backend via `src/services/dbManager.js`. Key tables: `experiments`, `strategy_signals`, `trades`, `token_holders`, `wallets`, `experiment_tokens`, `experiment_time_series_data`, `token_monitoring_pool`, `wss_price_ticks` (raw trade ticks; UNIQUE(tx_hash, log_index), first writer owns the row), plus narrative-specific tables managed by `src/narrative/db/NarrativeRepository.mjs`.

## Configuration

- **`config/default.json`** - `fourmemeWs` section (contracts, reconnect, tickBuffer, debounce, live execution params) + strategy defaults (buyTimeMinutes: 1.33, earlyReturnMin: 80, earlyReturnMax: 120)
- **`config/narrative-engine.json`** - LLM models (MiniMax-M2.5 primary, DeepSeek-V3 fallback), concurrency, timeouts
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
- **Never delete experiment rows that have produced data** — deleting cascades to `wss_price_ticks` rows (race-owned by experiment_id) and loses them globally forever

## Adding New Pre-Buy Factors

1. Add factor calculation to appropriate service (e.g., `WalletClusterService`)
2. Add factor to `getEmptyFactorValues()` in the service
3. Add factor to `PreBuyCheckService._evaluateWithCondition()` context
4. Add factor to `FactorBuilder.buildPreBuyCheckFactorValues()` (for backtest compatibility)
5. Add factor to `FourMemeWssTradingEngine.js` preBuyCheckFactors construction (for virtual/live trading)

## Adding New Narrative Category Rules

Category scoring prompts are in `src/narrative/analyzer/prompts/event-scoring-categories/category-{letter}-{name}.mjs`. Each exports:
- `{CATEGORY_X_PROMPT_VERSION}` - version string
- `buildCategoryXPrompt(eventDescription, eventClassification)` - returns prompt string

After modifying a category prompt, bump its `CATEGORY_X_PROMPT_VERSION` constant.
