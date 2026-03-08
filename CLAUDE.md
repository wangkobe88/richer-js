# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Richer-js is an automated trading engine for four.meme platform tokens. The system collects new tokens, monitors their K-line data, and executes buy/sell decisions based on data-driven strategies. It supports virtual trading (simulation), backtesting, and live trading modes.

## Common Commands

```bash
# Start the trading engine (virtual mode by default)
npm start

# Start in development mode
npm run dev

# Start the web server (runs on port 3010 by default)
npm run web

# Run an experiment (interactive CLI for creating experiments)
npm run experiment
```

## Architecture Overview

### Main Entry Points

- **`src/index.js`** - Trading engine main entry (virtual trading)
- **`src/web-server.js`** - Web interface server (Express.js, port 3010)
- **`main.js`** - Experiment runner entry point (CLI for creating experiments)

### Core Architecture Flow

```
PlatformCollector → TokenPool → KlineMonitor → DecisionMaker → StrategyEngine
       ↓                 ↓            ↓              ↓              ↓
  Collect new      Monitor        Update        Make buy/sell   Execute
  tokens (20s)     tokens         prices         decisions      strategy
```

### Trading Engine Implementations

The system supports three trading modes via `src/trading-engine/implementations/`:

- **`VirtualTradingEngine.js`** - Live simulation trading (default)
  - Collects real-time data from four.meme API
  - Performs all pre-buy checks but doesn't execute real trades
  - Records signals and virtual trades to database

- **`BacktestEngine.js`** - Historical backtesting
  - Uses historical data from `experiment_time_series_data` table
  - Reconstructs token states at each timestamp
  - Skips holder checks (historical holder data not available)
  - Updates signal metadata with backtest results

- **`LiveTradingEngine.js`** - Real trading execution
  - Executes actual trades on blockchain
  - Same pre-buy checks as virtual mode

### Pre-Buy Check System

The pre-buy check system (`src/trading-engine/pre-check/`) is responsible for evaluating token risk before purchase. All checks are coordinated by `PreBuyCheckService`:

```
PreBuyCheckService.performAllChecks()
    ├── EarlyParticipantCheckService (trades analysis)
    │   └── WalletClusterService (cluster detection, reuses trades data)
    └── TokenHolderService (holder blacklist check)
```

**Key Services:**

- **`PreBuyCheckService.js`** - Main coordinator, evaluates condition expressions
  - Always executes all checks (no enable/disable config)
  - Accepts condition expressions like: `walletClusterSecondToFirstRatio > 0.3 && walletClusterMegaRatio < 0.4`
  - Returns structured factor values for signal metadata

- **`EarlyParticipantCheckService.js`** - Analyzes early trading activity (first 90 seconds)
  - Factors: `earlyTradesVolumePerMin`, `earlyTradesCountPerMin`, `earlyTradesWalletsPerMin`, etc.
  - Stores raw trades data in `_trades` field for reuse by WalletClusterService

- **`WalletClusterService.js`** - Detects "wallet clusters" (groups of simultaneous trades)
  - Identifies pump-and-dump patterns: few large clusters with small 2nd cluster
  - Core factors: `walletClusterSecondToFirstRatio`, `walletClusterMegaRatio`, `walletClusterTop2Ratio`
  - Reuses trades from EarlyParticipantCheckService (no extra API calls)

- **`TokenHolderService.js`** - Checks holder blacklist via AVE API
  - Categories: `pump_group`, `negative_holder`, `dev`

**Factor Metadata Structure:**

All pre-buy factors are stored in signal metadata under `preBuyCheckFactors`:
```javascript
metadata: {
  preBuyCheckFactors: {
    // Holder check
    holderWhitelistCount, holderBlacklistCount, devHoldingRatio, ...
    // Early participant (19 factors)
    earlyTradesVolumePerMin, earlyTradesCountPerMin, ...
    // Wallet cluster (12 factors)
    walletClusterSecondToFirstRatio, walletClusterMegaRatio, ...
  }
}
```

See `src/trading-engine/core/FactorBuilder.js` for factor building logic used by BacktestEngine.

### Multi-Chain Support

The system supports multiple blockchains via `src/utils/BlockchainConfig`:

- **BSC** (BNB)
- **Ethereum** (ETH)
- **Solana** (SOL)
- **Base** (ETH)
- **Flap** (FLAP)
- **Bankr** (BANKR)

Each chain has:
- Native token symbol
- Platform-specific API endpoints
- Transaction explorer URLs

### Signal System

Signals are stored in `strategy_signals` table with metadata containing:

- **Trend factors** - Age, price, earlyReturn, trend indicators (stored in `trendFactors`)
- **Pre-buy check factors** - Holder, early participant, wallet cluster (stored in `preBuyCheckFactors`)
- **Execution status** - `executed`, `execution_status`, `execution_reason`

Signals are created by `TradeSignal` entity class (`src/trading-engine/entities/TradeSignal.js`).

### Key Modules

#### Core Components (`src/core/`)

- **`token-pool.js`** - Manages the pool of tokens being monitored (max 30 min window)
- **`strategy-engine.js`** - Calculates earlyReturn indicator, executes buy conditions (80-120% range)
- **`ave-api/`** - AVE API client for token data and risk information
- **`PlatformPairResolver.js`** - Resolves inner/outer trading pairs for cross-chain tokens

#### Data Collection (`src/collectors/`)

- **`platform-collector.js`** - Polls platforms for new tokens every 20 seconds
  - Supports multiple platforms: fourmeme, pumpfun, flap, base, bankr
  - Implements holder blacklist detection before adding tokens to monitoring pool

#### Monitors (`src/monitors/`)

- **`kline-monitor.js`** - Monitors K-line data updates (20s interval, 35 K-lines history)

#### Web Interface (`src/web/`)

- **`web-server.js`** - Express.js server with RESTful API
- **`services/ExperimentDataService.js`** - Database operations for experiments, signals, trades
- **`templates/`** - HTML templates for web UI
- **`static/js/`** - Frontend JavaScript modules

### Database

- **Supabase** backend database via `src/services/dbManager.js`
- Key tables:
  - `experiments` - Experiment configurations and results
  - `strategy_signals` - Trading signals with full factor metadata
  - `trades` - Executed trades (virtual or live)
  - `token_holders` - Holder data for blacklist detection
  - `wallets` - Wallet classifications (pump_group, negative_holder, etc.)
  - `experiment_tokens` - Tokens discovered during experiments
  - `experiment_time_series_data` - Historical factor values for backtesting
  - `token_monitoring_pool` - Tokens currently being monitored

## Important Configuration

- **`config/default.json`** - Strategy parameters (buyTimeMinutes: 1.33, earlyReturnMin: 80, earlyReturnMax: 120)
- **`config/.env`** - Environment variables (AVE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY)

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

## Adding New Pre-Buy Factors

When adding new pre-buy check factors:

1. Add factor calculation to appropriate service (e.g., `WalletClusterService`)
2. Add factor to `getEmptyFactorValues()` in the service
3. Add factor to `PreBuyCheckService._evaluateWithCondition()` context
4. Add factor to `FactorBuilder.buildPreBuyCheckFactorValues()` (for backtest compatibility)
5. Add factor to `VirtualTradingEngine.js` preBuyCheckFactors construction (for virtual trading)
6. Update documentation in `docs/`
