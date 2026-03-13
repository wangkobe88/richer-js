# 强短线交易者与代币质量关系分析方案

## 一、背景

**目标**：分析强短线交易者（Smart Money）的参与度与代币质量标注（高/中/低质量）的相关性。

**关键假设**：如果某代币有更多强短线交易者参与，可能意味着该代币质量更高。

## 二、数据源确认

### 2.1 可用数据源

| 数据表 | 可用字段 | 说明 |
|--------|----------|------|
| `strategy_signals` | created_at, token_address, symbol, action, executed | 买入信号及时间 |
| `experiment_tokens` | raw_api_data.main_pair, human_judges | 交易对 + 质量标注 |
| AVE API | getSwapTransactions() | 获取历史交易数据 |
| AVE API | getWalletInfo() | 获取钱包盈亏数据 |

### 2.2 重要发现

1. **❌ `_trades` 数据未存储**：`strategy_signals` 的 metadata 中没有保存原始交易数据
2. **✅ `main_pair` 可获取**：从 `experiment_tokens.raw_api_data.main_pair` 获取
3. **✅ 时间戳可用**：使用 `strategy_signals.created_at` 作为获取交易数据的时间点

## 三、分析流程

### 步骤1：获取信号和代币数据

```javascript
// 1. 获取所有执行的买入信号
SELECT token_address, symbol, created_at
FROM strategy_signals
WHERE experiment_id = '4c265a5b-...'
  AND action = 'buy'
  AND executed = true

// 2. 获取代币的 main_pair 和质量标注
SELECT token_address, raw_api_data->>'main_pair' as main_pair,
       human_judges->>'category' as quality_label
FROM experiment_tokens
WHERE experiment_id = '4c265a5b-...'
```

### 步骤2：获取早期交易数据

对于每个信号：
1. 使用 `created_at` 作为 toTime（转换为 Unix 时间戳）
2. 使用 `main_pair` 和 `bsc` 调用 AVE API：
   ```javascript
   getSwapTransactions(
     pairId = `${main_pair}-bsc`,
     limit = 300,
     fromTime = toTime - 90,  // 回溯90秒
     toTime = toTime,
     sort = 'asc'
   )
   ```

### 步骤3：提取钱包并分析盈亏

1. 从交易数据中提取所有唯一钱包地址：
   ```javascript
   const wallets = new Set();
   trades.forEach(t => {
     if (t.from_address) wallets.add(t.from_address.toLowerCase());
     if (t.to_address) wallets.add(t.to_address.toLowerCase());
   });
   ```

2. 调用 AVE API 获取钱包盈亏：
   ```javascript
   getWalletInfo(walletAddress, 'bsc')
   // 返回: total_profit, total_purchase, total_sold, ...
   ```

### 步骤4：识别强短线交易者

根据用户提供的示例，筛选条件可设为：

```javascript
// 严格条件（接近用户示例）
function isStrongTrader(walletInfo) {
  const profitAbs = Math.abs(walletInfo.total_profit);
  const soldPurchaseRatio = walletInfo.total_sold /
                            (walletInfo.total_purchase || 1);
  return profitAbs > 5000 && soldPurchaseRatio > 0.3;
}

// 宽松条件（实际分析用）
function isStrongTraderRelaxed(walletInfo) {
  const profitAbs = Math.abs(walletInfo.total_profit);
  const soldPurchaseRatio = walletInfo.total_sold /
                            (walletInfo.total_purchase || 1);
  const totalTrades = walletInfo.total_purchase + walletInfo.total_sold;
  return profitAbs > 500 && soldPurchaseRatio > 0.2 && totalTrades > 10;
}
```

### 步骤5：统计与关联分析

1. 统计每个代币的强短线交易者参与度：
   ```javascript
   {
     token_address: {
       symbol: '代币名',
       quality_label: 'high_quality',  // 人工标注
       strong_trader_count: 5,         // 强短线交易者数量
       total_trader_count: 50,         // 总交易者数量
       strong_trader_ratio: 0.10       // 占比
     }
   }
   ```

2. 按质量分组分析：
   ```javascript
   // 高质量组
   high_quality: {
     avg_strong_trader_ratio: 0.15,
     avg_total_traders: 80,
     sample_count: 10
   }
   // 中质量组、低质量组类似
   ```

3. 相关性分析：
   - 计算强短线交易者占比与代币收益率的相关性
   - 统计不同质量组的强短线交易者参与度分布

## 四、注意事项

### 4.1 API 限制

- AVE API 有速率限制，需要添加延迟和重试逻辑
- 建议批量处理，每个代币间隔 100-200ms

### 4.2 数据处理

- 钱包地址需要统一转小写
- 时间戳需要正确转换（秒 vs 毫秒）
- 需要缓存已查询的钱包数据，避免重复调用

### 4.3 统计有效性

- 样本量可能较小（74个信号），需要注意统计显著性
- 质量标注可能不完整（需要检查标注覆盖率）

## 五、预期输出

1. **汇总报告**：
   - 不同质量组的强短线交易者参与度对比
   - 强短线交易者占比与收益率的相关性

2. **详细数据**：
   - 每个代币的强短线交易者列表
   - 被识别出的强短线交易者盈亏数据

3. **可视化建议**：
   - 箱线图：不同质量组的强短线交易者占比分布
   - 散点图：强短线交易者占比 vs 代币收益率

## 六、实施步骤

1. ✅ 检查数据结构（已完成）
2. ⏳ 编写数据获取脚本
3. ⏳ 实现钱包盈亏分析
4. ⏳ 统计与关联分析
5. ⏳ 生成分析报告

## 七、数据获取示例

AVE API 调用示例（已验证可用）：
```javascript
const { AveWalletAPI, AveTxAPI } = require('./src/core/ave-api');

const walletApi = new AveWalletAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

const txApi = new AveTxAPI(
  'https://prod.ave-api.com',
  30000,
  process.env.AVE_API_KEY
);

// 获取钱包盈亏
const walletInfo = await walletApi.getWalletInfo(walletAddress, 'bsc');
// { total_profit, total_purchase, total_sold, ... }

// 获取交易数据
const trades = await txApi.getSwapTransactions(
  '0x..._fo-bsc',  // pairId
  300,             // limit
  fromTime,        // Unix timestamp in seconds
  toTime,          // Unix timestamp in seconds
  'asc'            // sort
);
```
