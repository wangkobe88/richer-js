# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Richer-js is an automated trading engine for four.meme platform tokens. The system collects new tokens, monitors their K-line data, and executes buy/sell decisions based on data-driven strategies. It supports virtual trading (simulation), backtesting, and live trading modes. It also includes a **narrative analysis engine** that evaluates meme coin events using a 3-stage LLM pipeline.

## Common Commands

```bash
# Trading engine (virtual mode by default)
npm start

# Trading engine (dev mode)
npm run dev

# Web server (port 3010)
npm run web

# Experiment runner (interactive CLI)
npm run experiment

# Narrative analysis engine (standalone worker)
npm run narrative-engine
```

No test framework or CI is configured.

## Architecture Overview

### Main Entry Points

- **`src/index.js`** - Trading engine (virtual trading)
- **`src/web-server.js`** - Web interface (Express.js, port 3010)
- **`main.js`** - Experiment runner (CLI)
- **`src/narrative/engine/start.mjs`** - Narrative analysis engine

### Trading Engine Flow

```
PlatformCollector → TokenPool → KlineMonitor → DecisionMaker → StrategyEngine
       ↓                 ↓            ↓              ↓              ↓
  Collect new      Monitor        Update        Make buy/sell   Execute
  tokens (20s)     tokens         prices         decisions      strategy
```

Three trading modes via `src/trading-engine/implementations/`:
- **VirtualTradingEngine** - Simulation with real data, no actual trades
- **BacktestEngine** - Historical backtesting from `experiment_time_series_data`
- **LiveTradingEngine** - Real blockchain trade execution

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
    ├── EarlyParticipantCheckService (first 90 seconds trades analysis)
    │   └── WalletClusterService (cluster detection, reuses trades data)
    └── TokenHolderService (holder blacklist via AVE API)
```

All pre-buy factors stored in signal metadata under `preBuyCheckFactors`.

### Multi-Chain Support

`src/utils/BlockchainConfig`: BSC, Ethereum, Solana, Base, Flap, Bankr — each with native symbol, API endpoints, explorer URLs.

### Web Interface

`src/web/` + `src/web-server.js`:
- Trading engine dashboard
- Narrative analyzer UI (`/narrative-analyzer`, `/narrative-tasks`)
- API: `/api/narrative/analyze`, `/api/narrative/tasks`, `/api/narrative/result/:address`

### Database

Supabase backend via `src/services/dbManager.js`. Key tables: `experiments`, `strategy_signals`, `trades`, `token_holders`, `wallets`, `experiment_tokens`, `experiment_time_series_data`, `token_monitoring_pool`, plus narrative-specific tables managed by `src/narrative/db/NarrativeRepository.mjs`.

## Configuration

- **`config/default.json`** - Strategy parameters (buyTimeMinutes: 1.33, earlyReturnMin: 80, earlyReturnMax: 120)
- **`config/narrative-engine.json`** - LLM models (MiniMax-M2.5 primary, DeepSeek-V3 fallback), concurrency, timeouts
- **`config/.env`** - Environment variables (AVE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, MINIMAX_API_KEY, etc.)

## Strategy Parameters

- **Buy timing**: 1.33 minutes after token creation
- **earlyReturn range**: 80-120% (key buy signal)
- **Take profit**: +30% sell 50%, +50% sell remaining
- **Observation window**: 30 minutes
- **Polling interval**: 20 seconds

## Important Notes

- **Pre-buy check factors are always calculated** - No enable/disable configuration
- **Wallet cluster data reuse** - WalletClusterService reuses trades from EarlyParticipantCheckService
- **AVE API token format**: `{address}-{chain}` (e.g., `0x1234...abcd-bsc`)
- **Snapshot ID format**: `{token_address}_{timestamp}`
- **Case sensitivity**: Wallet addresses are case-sensitive when querying database
- **Factor building**: Use `FactorBuilder.buildPreBuyCheckFactorValues()` when adding new pre-buy factors
- **Narrative prompts are ESM** (`.mjs`) while trading engine is CommonJS (`.js`) — don't mix import styles

## Adding New Pre-Buy Factors

1. Add factor calculation to appropriate service (e.g., `WalletClusterService`)
2. Add factor to `getEmptyFactorValues()` in the service
3. Add factor to `PreBuyCheckService._evaluateWithCondition()` context
4. Add factor to `FactorBuilder.buildPreBuyCheckFactorValues()` (for backtest compatibility)
5. Add factor to `VirtualTradingEngine.js` preBuyCheckFactors construction (for virtual trading)

## Adding New Narrative Category Rules

Category scoring prompts are in `src/narrative/analyzer/prompts/event-scoring-categories/category-{letter}-{name}.mjs`. Each exports:
- `{CATEGORY_X_PROMPT_VERSION}` - version string
- `buildCategoryXPrompt(eventDescription, eventClassification)` - returns prompt string

After modifying a category prompt, bump its `CATEGORY_X_PROMPT_VERSION` constant.
