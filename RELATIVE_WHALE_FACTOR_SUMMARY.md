# 相对交易位置大户行为因子 - 实现总结

## 问题背景

原分析使用"最早交易时间"定义早期大户，但生产环境中只有 `signalTime - 90s` 的数据窗口。

**关键数据：**
- 90秒窗口覆盖率：49.2%
- 180秒窗口覆盖率：69.5%
- **结论：即使扩展到180秒也无法覆盖大部分代币，需要替代方案**

## 解决方案：相对交易位置

不再依赖"代币创建后多久"，而是使用"我们观察到的前30%交易"作为"早期"的定义。

### 核心思想
- **绝对时间不重要**：不管信号在代币创建后多久生成
- **相对位置更重要**：在我们能观察到的交易中，大户是在早期还是晚期入场
- **行为模式更关键**：大户入场后是持有还是卖出

## 因子定义

### 1. walletRelativeEarlyWhaleHoldRatio

**定义**：在可观察到的前30%交易中入场且买入金额>$200的钱包（早期大户），未卖出任何代币的比例

**计算步骤**：
```javascript
// 1. 获取交易数据：signalTime - 90s 到 signalTime
const trades = await getSwapTransactions(pairId, signalTime - 90, signalTime);

// 2. 去重后按时间排序
const uniqueTrades = deduplicateAndSort(trades);

// 3. 定义"早期"阈值
const earlyThreshold = Math.floor(uniqueTrades.length * 0.3);
const earlyEndTime = uniqueTrades[earlyThreshold - 1].time;

// 4. 识别早期大户
const earlyWhales = wallets.filter(w =>
  w.firstBuyTime <= earlyEndTime && w.totalBuyAmount > 200
);

// 5. 计算持有率
const holdingWhales = earlyWhales.filter(w => w.sellTrades.length === 0);
const holdRatio = holdingWhales.length / earlyWhales.length;
```

### 2. walletRelativeEarlyWhaleSellRatio

**定义**：早期大户的卖出比例（总卖出代币数 / 总买入代币数）

**计算步骤**：
```javascript
let totalSellRatio = 0;
for (const whale of earlyWhales) {
  const soldTokens = whale.sellTrades.reduce((sum, t) => sum + t.fromAmount, 0);
  const sellRatio = soldTokens / whale.totalBuyTokens;
  totalSellRatio += sellRatio;
}
const avgSellRatio = totalSellRatio / earlyWhales.length;
```

## 实验结果

### 数据集
- 两个实验，82个代币
- 有大户数据：36个代币
- 盈利代币：14个
- 亏损代币：22个

### 性能对比

| 过滤条件 | 亏损召回 | 盈利误伤 | F1分数 |
|---------|---------|---------|--------|
| earlyWhaleHoldRatio < 0.4 | 86.4% (19/22) | 42.9% (6/14) | 0.688 |
| earlyWhaleSellRatio > 0.5 | 81.8% (18/22) | 42.9% (6/14) | 0.673 |
| **组合条件** | **86.4% (19/22)** | **35.7% (5/14)** | **0.737** |
| earlyWhaleHoldRatio < 0.3 | 86.4% (19/22) | 42.9% (6/14) | 0.688 |

### 最佳条件

**推荐：`walletRelativeEarlyWhaleHoldRatio < 0.4 && walletRelativeEarlyWhaleSellRatio > 0.3`**

- 亏损召回率：86.4%（能过滤掉大部分亏损代币）
- 盈利误伤率：35.7%（会误伤部分盈利代币）
- F1分数：0.737（综合性能最佳）

### 典型例子

**盈利代币（大户持有）- BINANCE (+780.6%)**
- 3个早期大户
- 持有率：67%
- 卖出率：29%
- 大户行为：2个持有，1个卖出88%

**亏损代币（大户卖出）- 0x5727f4 (-33.3%)**
- 1个早期大户
- 持有率：0%
- 卖出率：129%
- 大户行为：快速卖出，套现离场

## 实现建议

### 1. 代码结构

在 `src/trading-engine/pre-check/WalletClusterService.js` 中添加新方法：

```javascript
class WalletClusterService {
  // 现有方法...

  /**
   * 计算相对早期大户行为因子
   * 不依赖代币创建时间，使用可观察到的交易数据
   */
  calculateRelativeEarlyWhaleFactors(trades, signalTime) {
    // 1. 过滤出信号时间窗口内的交易
    const windowStart = signalTime - 90;
    const windowTrades = trades.filter(t => t.time >= windowStart && t.time <= signalTime);

    if (windowTrades.length < 20) {
      return { hasInsufficientData: true };
    }

    // 2. 定义早期阈值（前30%交易）
    const earlyThreshold = Math.floor(windowTrades.length * 0.3);
    const earlyEndTime = windowTrades[earlyThreshold - 1]?.time || windowTrades[0].time;

    // 3. 分析钱包行为
    const walletMap = this._groupTradesByWallet(windowTrades);
    const earlyWhales = this._identifyEarlyWhales(walletMap, earlyEndTime);

    if (earlyWhales.length === 0) {
      return { hasNoEarlyWhales: true };
    }

    // 4. 计算因子
    const holdingWhales = earlyWhales.filter(w => w.sellTrades.length === 0);
    const holdRatio = holdingWhales.length / earlyWhales.length;

    let totalSellRatio = 0;
    for (const whale of earlyWhales) {
      const soldTokens = whale.sellTrades.reduce((sum, t) => sum + t.fromAmount, 0);
      totalSellRatio += soldTokens / whale.totalBuyTokens;
    }
    const sellRatio = totalSellRatio / earlyWhales.length;

    return {
      walletRelativeEarlyWhaleHoldRatio: holdRatio,
      walletRelativeEarlyWhaleSellRatio: sellRatio,
      walletRelativeEarlyWhaleCount: earlyWhales.length
    };
  }
}
```

### 2. PreBuyCheckService 集成

在 `src/trading-engine/pre-check/PreBuyCheckService.js` 中添加新因子到上下文：

```javascript
_evaluateWithCondition(condition, factorValues) {
  const context = {
    // 现有因子...
    walletRelativeEarlyWhaleHoldRatio: factorValues.walletRelativeEarlyWhaleHoldRatio ?? 1.0,
    walletRelativeEarlyWhaleSellRatio: factorValues.walletRelativeEarlyWhaleSellRatio ?? 0.0,
    // ...
  };

  return this._evaluateExpression(condition, context);
}
```

### 3. 推荐策略条件

在策略配置中使用：

```json
{
  "preBuyCondition": "walletRelativeEarlyWhaleHoldRatio >= 0.4 || walletRelativeEarlyWhaleSellRatio <= 0.3",
  "description": "过滤早期大户大量卖出的代币（拉砸模式）"
}
```

或者反向写法（更直观）：

```json
{
  "preBuyCondition": "!(walletRelativeEarlyWhaleHoldRatio < 0.4 && walletRelativeEarlyWhaleSellRatio > 0.3)",
  "description": "排除早期大户持有率低且卖出率高的代币"
}
```

### 4. FactorBuilder 集成

在 `src/trading-engine/core/FactorBuilder.js` 中添加：

```javascript
buildPreBuyCheckFactorValues(signal, tokenState) {
  // 现有因子...

  // 添加相对早期大户因子
  if (walletClusterData?.walletRelativeEarlyWhaleHoldRatio !== undefined) {
    factors.walletRelativeEarlyWhaleHoldRatio = walletClusterData.walletRelativeEarlyWhaleHoldRatio;
    factors.walletRelativeEarlyWhaleSellRatio = walletClusterData.walletRelativeEarlyWhaleSellRatio;
    factors.walletRelativeEarlyWhaleCount = walletClusterData.walletRelativeEarlyWhaleCount;
  }

  return factors;
}
```

## 注意事项

### 1. 数据不足处理
- 总交易数 < 20：跳过计算，返回默认值（holdRatio=1.0, sellRatio=0.0）
- 无早期大户：返回 hasNoEarlyWhales 标志

### 2. 性能优化
- 复用 EarlyParticipantCheckService 的交易数据，避免重复API调用
- 一次交易分析同时计算钱包聚簇和早期大户因子

### 3. 阈值调优
- 大户金额阈值：当前$200，可根据实际调整
- 早期比例：当前30%，可根据数据质量调整
- 过滤条件：当前 holdRatio < 0.4 && sellRatio > 0.3

### 4. 与现有因子的关系
- **walletClusterSecondToFirstRatio**：检测交易聚簇模式（拉砸特征）
- **walletRelativeEarlyWhaleHoldRatio**：检测早期大户的持仓行为
- **组合使用**：两个因子互补，能更准确地识别拉砸代币

## 下一步

1. ✅ 实现因子计算逻辑
2. ✅ 集成到 PreBuyCheckService
3. ✅ 更新 FactorBuilder（用于回测）
4. ⏳ 在实验中测试效果
5. ⏳ 根据实际表现调优阈值

## 参考资料

- `analyze_signal_time_gap.js` - 分析信号时间与代币创建时间的差距
- `analyze_relative_whale_behavior.js` - 使用相对交易位置分析大户行为
- `analyze_optimized_relative_strategy.js` - 自适应早期大户行为分析
