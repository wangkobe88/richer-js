# 强短线交易者与代币质量关系分析方案（修订版）

## 一、核心发现

### 1.1 数据获取方式（参考已有分析脚本）

**信号时间使用方式**（参考 `fetch_early_trades_final.js`）：
```javascript
// 从买入信号获取时间
const checkTime = Math.floor(new Date(signal.metadata.timestamp).getTime() / 1000);

// 回溯窗口：买入前30-90秒
const targetFromTime = checkTime - 90;
const currentToTime = checkTime - 30;

// 调用AVE API获取交易
const trades = await txApi.getSwapTransactions(
  `${tokenAddress}_fo-bsc`,  // innerPair格式
  300,
  targetFromTime,
  currentToTime,
  'asc'
);
```

**钱包盈亏获取方式**（参考 `analyze_early_participants.js`）：
```javascript
// 使用本地API，不需要直接调AVE
const response = await post('http://localhost:3010/api/wallet/query', {
  walletAddress: wallet,
  chain: 'bsc'
});

// 返回数据结构
{
  success: true,
  data: {
    walletInfo: {
      total_balance,      // 总持仓
      total_profit,       // 总盈亏
      total_purchase,     // 总买入次数
      total_sold,         // 总卖出次数
      total_win_ratio     // 胜率
    },
    tokens: [...]        // 持仓代币列表
  }
}
```

### 1.2 关键API端点

| 端点 | 用途 |
|------|------|
| `/api/wallet/query` | 获取钱包盈亏数据 |
| AVE Tx API | 获取早期交易数据 |

## 二、分析流程

```
┌─────────────────────────────────────────────────────────────────┐
│ 步骤1: 获取执行的买入信号                                         │
├─────────────────────────────────────────────────────────────────┤
│ - 从 strategy_signals 表获取                                     │
│ - 筛选条件: experiment_id='4c265a5b...', action='buy', executed=true │
│ - 获取字段: id, token_address, token_symbol, created_at, metadata │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤2: 获取代币的 main_pair 和质量标注                           │
├─────────────────────────────────────────────────────────────────┤
│ - 从 experiment_tokens 表获取                                     │
│ - 提取: raw_api_data.main_pair, human_judges.category            │
│ - main_pair 格式: "0x..._fo"                                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤3: 获取早期交易数据（买入前30-90秒）                          │
├─────────────────────────────────────────────────────────────────┤
│ - 使用 signal.metadata.timestamp 作为基准时间                    │
│ - 调用 AVE Tx API: getSwapTransactions()                        │
│ - 时间窗口: [checkTime - 90, checkTime - 30]                    │
│ - 提取所有钱包地址 (from_address + to_address)                  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤4: 获取钱包盈亏数据                                          │
├─────────────────────────────────────────────────────────────────┤
│ - 调用本地 API: POST /api/wallet/query                          │
│ - 返回: total_profit, total_purchase, total_sold, ...           │
│ - 缓存结果避免重复查询                                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤5: 识别强短线交易者                                          │
├─────────────────────────────────────────────────────────────────┤
│ - 条件1: |total_profit| > 500 USD                               │
│ - 条件2: total_sold / total_purchase > 0.2                      │
│ - 条件3: total_purchase + total_sold > 10                       │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 步骤6: 统计与关联分析                                            │
├─────────────────────────────────────────────────────────────────┤
│ - 按代币统计: 总钱包数、强短线交易者数、占比                      │
│ - 按质量分组: high/mid/low_quality, fake_pump, no_user          │
│ - 分析相关性: 强短线交易者占比 vs 代币质量/收益率                │
└─────────────────────────────────────────────────────────────────┘
```

## 三、数据结构

### 3.1 信号数据
```javascript
{
  id: "signal_id",
  token_address: "0x...",
  token_symbol: "代币名",
  created_at: "2026-03-12T11:00:00Z",
  metadata: {
    timestamp: 1773280710,  // Unix时间戳（秒）
    preBuyCheckFactors: {
      earlyTradesCheckTime: 1773280710,
      // ... 其他因子
    }
  }
}
```

### 3.2 代币数据
```javascript
{
  token_address: "0x...",
  token_symbol: "代币名",
  raw_api_data: {
    main_pair: "0x..._fo",  // 用于构建 pairId
    // ...
  },
  human_judges: {
    category: "high_quality",  // 或 mid_quality, low_quality, fake_pump, no_user
    note: "...",
    judge_at: "2026-03-12T..."
  }
}
```

### 3.3 钱包数据（来自 /api/wallet/query）
```javascript
{
  walletInfo: {
    total_balance: 1234.56,
    total_profit: 123.45,
    total_purchase: 50,
    total_sold: 30,
    total_win_ratio: 0.65
  },
  tokens: [...]
}
```

## 四、注意事项

### 4.1 API限流处理
- AVE API: 每个代币之间延迟2秒
- 本地 API: 每个钱包之间延迟1秒
- 重试机制: 最多5次重试，指数退避

### 4.2 数据去重
- 钱包地址统一转小写
- 同一代币可能有多个买入信号，需要合并统计

### 4.3 质量标注覆盖率
- 检查标注覆盖率，可能部分代币没有人工标注

## 五、预期输出

1. **汇总报告**：
   - 不同质量组的强短线交易者参与度对比
   - 强短线交易者占比与收益率的相关性

2. **详细数据**：
   - 每个代币的强短线交易者列表
   - 每个强短线交易者的盈亏数据

3. **可视化建议**：
   - 箱线图：不同质量组的强短线交易者占比分布
   - 散点图：强短线交易者占比 vs 代币收益率

## 六、参考脚本

| 脚本 | 功能 |
|------|------|
| `scripts/experiment_505ac306_analysis/fetch_early_trades_final.js` | 获取早期交易数据 |
| `scripts/early-participants-analysis/analyze_early_participants.js` | 钱包盈亏分析 |
| `scripts/analyze_4c265a5b_correct.js` | 收益计算 |
| `scripts/analyze_factor_ranges.js` | 因子区间分析 |
