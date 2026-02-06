# Richer-js 数据体系文档

## 概述

本项目使用 Supabase (PostgreSQL) 作为数据库，主要记录交易实验的相关数据。

**重要限制**: Supabase 单次查询最多返回 1000 行数据，需要分页获取。

---

## 核心数据表

### 1. experiments - 实验表

实验的主表，记录每次交易实验的基本信息和配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| experiment_name | text | 实验名称 |
| experiment_description | text | 实验描述 |
| status | text | 状态: initializing/running/completed/failed/stopped |
| config | jsonb | 实验配置（策略、卡牌管理等） |
| trading_mode | text | 交易模式: virtual/live/backtest |
| strategy_type | text | 策略类型 |
| blockchain | text | 区块链: bsc/solana |
| kline_type | text | K线类型: 1m/5m/15m/30m/1h/4h/1d |
| started_at | timestamp | 开始时间 |
| stopped_at | timestamp | 停止时间 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

**关联关系**:
- 一个实验有多个交易 (trades.experiment_id)
- 一个实验有多个信号 (strategy_signals.experiment_id)
- 一个实验有多个代币 (experiment_tokens.experiment_id)

---

### 2. trades - 交易表

记录所有执行的交易（包括虚拟交易和实盘交易）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| experiment_id | uuid | 关联实验ID |
| signal_id | uuid | 关联信号ID（可选） |
| token_address | text | 代币地址 |
| token_symbol | text | 代币符号 |
| token_id | text | 代币ID（可选） |
| chain | text | 区块链 |
| trade_direction | text | 交易方向: buy/sell |
| trade_status | text | 交易状态: pending/success/failed |
| input_currency | text | 输入货币（如BNB） |
| output_currency | text | 输出货币（如代币符号） |
| input_amount | numeric | 输入数量 |
| output_amount | numeric | 输出数量 |
| unit_price | numeric | 单价 |
| success | boolean | 是否成功 |
| is_virtual_trade | boolean | 是否虚拟交易 |
| metadata | jsonb | 元数据（卡牌信息等） |
| created_at | timestamp | 创建时间 |
| executed_at | timestamp | 执行时间 |

**买入示例**:
```
input_currency: "BNB"
output_currency: "DOGE"
input_amount: 0.1  (花费的BNB)
output_amount: 10000  (获得的代币数量)
unit_price: 0.00001  (BNB per token)
```

**卖出示例**:
```
input_currency: "DOGE"
output_currency: "BNB"
input_amount: 10000  (卖出的代币数量)
output_amount: 0.12  (获得的BNB)
unit_price: 0.000012  (BNB per token)
```

---

### 3. strategy_signals - 策略信号表

记录策略生成的所有交易信号（买入/卖出/持有）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| experiment_id | uuid | 关联实验ID |
| token_address | text | 代币地址 |
| token_symbol | text | 代币符号 |
| chain | text | 区块链 |
| signal_type | text | 信号类型: BUY/SELL |
| action | text | 动作: buy/sell/hold |
| confidence | numeric | 置信度（可选） |
| reason | text | 信号原因（可选） |
| metadata | jsonb | 元数据（价格、因子等） |
| executed | boolean | 是否已执行 |
| created_at | timestamp | 创建时间 |

**metadata 字段包含**:
- price: 当前价格
- earlyReturn: 早期收益率
- buyPrice: 买入价格
- currentPrice: 当前价格
- collectionPrice: 收集价格
- sellRatio: 卖出比例
- profitPercent: 利润百分比
- holdDuration: 持有时长
- strategyId/strategyName: 策略信息
- cards/cardConfig: 卡牌管理信息
- 各种因子值

---

### 4. experiment_tokens - 实验代币表

记录实验中发现和监控的所有代币。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| experiment_id | uuid | 关联实验ID |
| token_address | text | 代币地址 |
| token_symbol | text | 代币符号 |
| blockchain | text | 区块链 |
| discovered_at | timestamp | 发现时间 |
| status | text | 状态: monitoring/bought/exited |
| raw_api_data | jsonb | 原始API数据 |
| created_at | timestamp | 创建时间 |
| updated_at | timestamp | 更新时间 |

---

### 5. experiment_time_series_data - 时序数据表

记录实验运行过程中的时间序列数据（价格、因子等）。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| experiment_id | uuid | 关联实验ID |
| token_address | text | 代币地址 |
| token_symbol | text | 代币符号 |
| timestamp | timestamp | 时间戳 |
| loop_count | integer | 轮次计数 |
| price_usd | numeric | USD价格 |
| price_native | numeric | 原生币价格（BNB） |
| factor_values | jsonb | 因子值对象 |
| signal_type | text | 信号类型（可选） |
| signal_executed | boolean | 信号是否执行（可选） |
| execution_reason | text | 执行原因或策略信息（可选） |
| blockchain | text | 区块链 |

**factor_values 字段包含**:
- 各种策略因子的值，如 earlyReturn、volume、marketCap 等

---

### 6. portfolio_snapshots - 投资组合快照表

记录实验运行期间的投资组合快照。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| experiment_id | uuid | 关联实验ID |
| snapshot_time | timestamp | 快照时间 |
| total_value | numeric | 总价值 |
| total_value_change | numeric | 价值变化 |
| total_value_change_percent | numeric | 价值变化百分比 |
| cash_balance | numeric | 现金余额 |
| cash_native_balance | numeric | 原生币余额 |
| total_portfolio_value_native | numeric | 投资组合总价值 |
| token_positions | jsonb | 代币持仓列表 |
| positions_count | integer | 持仓数量 |
| metadata | jsonb | 元数据 |
| created_at | timestamp | 创建时间 |

---

## 数据访问方法

### 使用 ExperimentDataService

```javascript
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');
const { dbManager } = require('../src/services/dbManager');

// 初始化
const dataService = new ExperimentDataService();
const supabase = dbManager.getClient();
```

#### 1. 获取交易数据

```javascript
// 获取所有交易（自动分页）
const trades = await dataService.getTrades(experimentId, { limit: 10000 });

// 带筛选
const buyTrades = await dataService.getTrades(experimentId, {
  direction: 'buy',
  success: 'true',
  limit: 100
});
```

#### 2. 获取信号数据

```javascript
// 获取所有信号
const signals = await dataService.getSignals(experimentId, { limit: 10000 });

// 带筛选
const buySignals = await dataService.getSignals(experimentId, {
  action: 'buy'
});
```

#### 3. 获取代币数据

```javascript
// 获取所有代币
const tokens = await dataService.getTokens(experimentId, { limit: 10000 });

// 带状态筛选
const boughtTokens = await dataService.getTokens(experimentId, {
  status: 'bought'
});
```

#### 4. 获取实验统计数据

```javascript
const stats = await dataService.getExperimentStats(experimentId);
// 返回: { trades: {...}, signals: {...}, summary: {...} }
```

---

### 使用 ExperimentTimeSeriesService

```javascript
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');

const timeSeriesService = new ExperimentTimeSeriesService();

// 获取时序数据
const timeSeriesData = await timeSeriesService.getExperimentTimeSeries(
  experimentId,
  tokenAddress,  // 可选，不传则获取所有代币
  { limit: 10000 }
);

// 获取因子时序数据
const factorData = await timeSeriesService.getFactorTimeSeries(
  experimentId,
  tokenAddress,
  'earlyReturn'  // 因子名称
);
```

---

### 直接使用 Supabase 查询

```javascript
const { dbManager } = require('../src/services/dbManager');
const supabase = dbManager.getClient();

// 查询实验列表
const { data: experiments } = await supabase
  .from('experiments')
  .select('*')
  .eq('status', 'running');

// 查询特定代币的交易
const { data: tokenTrades } = await supabase
  .from('trades')
  .select('*')
  .eq('experiment_id', experimentId)
  .eq('token_address', tokenAddress)
  .order('created_at', { ascending: true });
```

---

## 常用分析查询示例

### 计算代币收益率（FIFO）

```javascript
// 参考 experiment_token_returns.js 中的实现
function calculateTokenPnL(tokenTrades) {
  const buyQueue = [];
  let totalRealizedPnL = 0;
  let totalBNBSpent = 0;
  let totalBNBReceived = 0;

  // 按时间排序
  tokenTrades.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  for (const trade of tokenTrades) {
    if (trade.trade_direction === 'buy') {
      buyQueue.push({
        amount: parseFloat(trade.output_amount),
        cost: parseFloat(trade.input_amount)
      });
      totalBNBSpent += parseFloat(trade.input_amount);
    } else {
      let remainingToSell = parseFloat(trade.input_amount);
      let costOfSold = 0;

      while (remainingToSell > 0 && buyQueue.length > 0) {
        const oldestBuy = buyQueue[0];
        const sellAmount = Math.min(remainingToSell, oldestBuy.amount);
        const unitCost = oldestBuy.cost / oldestBuy.amount;
        costOfSold += unitCost * sellAmount;
        remainingToSell -= sellAmount;
        oldestBuy.amount -= sellAmount;

        if (oldestBuy.amount <= 0.00000001) {
          buyQueue.shift();
        }
      }

      totalBNBReceived += parseFloat(trade.output_amount);
      totalRealizedPnL += (parseFloat(trade.output_amount) - costOfSold);
    }
  }

  const returnRate = totalBNBSpent > 0
    ? ((totalBNBReceived - totalBNBSpent) / totalBNBSpent * 100)
    : 0;

  return { returnRate, totalRealizedPnL, totalBNBSpent, totalBNBReceived };
}
```

### 获取信号执行率

```javascript
// 获取信号执行率
const signals = await dataService.getSignals(experimentId, { limit: 10000 });
const executedSignals = signals.filter(s => s.executed);
const executionRate = (executedSignals.length / signals.length * 100).toFixed(2);
```

### 按代币统计交易

```javascript
// 按代币统计交易次数
const trades = await dataService.getTrades(experimentId, { limit: 10000 });
const tokenStats = {};

trades.forEach(trade => {
  const addr = trade.tokenAddress;
  if (!tokenStats[addr]) {
    tokenStats[addr] = { symbol: trade.tokenSymbol, buyCount: 0, sellCount: 0 };
  }
  if (trade.tradeDirection === 'buy') tokenStats[addr].buyCount++;
  else tokenStats[addr].sellCount++;
});
```

---

## 环境配置

确保 `config/.env` 文件包含以下配置：

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key
```

---

## 数据分析脚本模板

```javascript
#!/usr/bin/env node
/**
 * 分析脚本模板
 */

require('dotenv').config({ path: '../config/.env' });
const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');
const { ExperimentTimeSeriesService } = require('../src/web/services/ExperimentTimeSeriesService');

async function main() {
  const dataService = new ExperimentDataService();
  const timeSeriesService = new ExperimentTimeSeriesService();

  const experimentId = process.argv[2] || 'your-experiment-id';

  // 1. 获取实验数据
  const [trades, signals, tokens] = await Promise.all([
    dataService.getTrades(experimentId, { limit: 10000 }),
    dataService.getSignals(experimentId, { limit: 10000 }),
    dataService.getTokens(experimentId, { limit: 10000 })
  ]);

  console.log(`交易数: ${trades.length}`);
  console.log(`信号数: ${signals.length}`);
  console.log(`代币数: ${tokens.length}`);

  // 2. 执行分析逻辑
  // ...

  // 3. 输出结果
}

main().catch(console.error);
```
