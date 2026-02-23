# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Richer-js is an automated trading engine for four.meme platform tokens. The system collects new tokens, monitors their K-line data, and executes buy/sell decisions based on data-driven strategies. It currently outputs decisions to logs without executing real trades.

## Common Commands

```bash
# Start the trading engine
npm start

# Start in development mode
npm run dev

# Start the web server (runs on port 3010 by default)
npm run web

# Run an experiment
npm run experiment
```

## Architecture Overview

### Main Entry Points

- **`src/index.js`** - Trading engine main entry
- **`src/web-server.js`** - Web interface server (Express.js, port 3010)
- **`main.js`** - Experiment runner entry point

### Core Architecture Flow

```
PlatformCollector → TokenPool → KlineMonitor → DecisionMaker → StrategyEngine
       ↓                 ↓            ↓              ↓              ↓
  Collect new      Monitor        Update        Make buy/sell   Execute
  tokens (20s)     tokens         prices         decisions      strategy
```

### Key Modules

#### Core Components (`src/core/`)

- **`token-pool.js`** - Manages the pool of tokens being monitored (max 30 min window)
- **`strategy-engine.js`** - Calculates earlyReturn indicator, executes buy conditions (80-120% range)
- **`ave-api/`** - AVE API client for token data and risk information

#### Data Collection (`src/collectors/`)

- **`platform-collector.js`** - Polls four.meme for new tokens every 20 seconds
  - Implements holder blacklist detection before adding tokens to monitoring pool
  - Checks for pump_group and negative_holder wallets

#### Monitors (`src/monitors/`)

- **`kline-monitor.js`** - Monitors K-line data updates (20s interval, 35 K-lines history)

#### Trading Engine (`src/trading-engine/`)

- **`implementations/VirtualTradingEngine.js`** - Virtual trading implementation
  - Performs pre-buy holder risk checks
  - Executes buy/sell decisions in virtual mode
- **`holders/TokenHolderService.js`** - Manages holder blacklist detection
- **`factories/ExperimentFactory.js`** - Experiment management factory

#### Web Interface (`src/web/`)

- **`web-server.js`** - Express.js server with RESTful API
- **`services/`** - Data services (experiments, wallets, token holders, price refresh)
- **`templates/`** - HTML templates for web UI
- **`static/js/`** - Frontend JavaScript modules

### Database

- **Supabase** backend database via `src/services/dbManager.js`
- Key tables: `experiments`, `tokens`, `trades`, `token_holders`, `wallets`, `signals`, `token_monitoring_pool`

## Important Configuration

- **`config/default.json`** - Strategy parameters (buyTimeMinutes: 1.33, earlyReturnMin: 80, earlyReturnMax: 120)
- **`config/.env`** - Environment variables (AVE_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY)

## Holder Blacklist Detection

The system implements holder blacklist detection at two points:

1. **Collection Phase** (`platform-collector.js`): Before adding token to monitoring pool
2. **Pre-Buy Phase** (`VirtualTradingEngine.js`): Before executing purchase

Blacklist categories:
- `pump_group` - Pump group wallets (流水盘钱包)
- `negative_holder` - Negative holders
- `dev` - Developer wallets

Holder data is stored in `token_holders` table with `experiment_id` for tracking.

## Key Data Flow

1. **Collection**: PlatformCollector fetches new tokens from four.meme
2. **Risk Check**: TokenHolderService checks holder blacklist via AVE API
3. **Monitoring**: TokenPool maintains token status, KlineMonitor updates prices
4. **Decision**: DecisionMaker checks buy conditions at 1.33 minutes
5. **Execution**: StrategyEngine outputs buy/sell decisions to logs

## Strategy Parameters

- **Buy timing**: 1.33 minutes after token creation
- **earlyReturn range**: 80-120% (key buy signal)
- **Take profit**: +30% sell 50%, +50% sell remaining
- **Observation window**: 30 minutes
- **Polling interval**: 20 seconds

## Important Notes

- System currently only outputs decisions to logs, does not execute real trades
- Wallet addresses are case-sensitive when querying database
- AVE API token format: `{address}-{chain}` (e.g., `0x1234...abcd-bsc`)
- Snapshot ID format: `{token_address}_{timestamp}`
