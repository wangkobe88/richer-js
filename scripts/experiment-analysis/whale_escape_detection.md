# 主力出逃检测因子设计

## 背景
通过分析 Qshit 代币的价格急跌案例，发现：
- 峰值后3分钟内TVL从$11,988暴跌到$1,645（-86.3%）
- 价格从峰值下跌72.8%
- 这是典型的"拉高出货"模式

## 检测因子设计

### 1. TVL急跌因子
```
名称: tvlSharpDrop
描述: 短时间内TVL大幅流出
计算: (峰值TVL - 当前TVL) / 峰值TVL * 100
阈值: > 50% 预警, > 70% 危险
时间窗口: 1-5分钟
```

### 2. 价格与TVL背离因子
```
名称: priceTvlDivergence
描述: 价格下跌速度快于TVL流出速度（恐慌抛售）
计算: |价格变化%| - |TVL变化%|
阈值: > 10% 预警
```

### 3. 大额连续流出因子
```
名称: largeOutflowCount
描述: 连续出现大额卖出交易
计算: 统计5秒内卖出交易数量和金额
阈值: >3笔大额卖出 或 总金额>TVL的10%
```

### 4. 早期参与者抛售因子
```
名称: earlySellerRatio
描述: 早期买入者的抛售比例
计算: 前10个买入者的卖出金额 / 总卖出金额
阈值: > 30% 预警
```

## 实现建议

在 KlineMonitor 或 PreBuyCheckService 中添加：

```javascript
// 检测TVL急跌
checkTvlSharpDrop(currentTvl, peakTvl) {
  const drop = (peakTvl - currentTvl) / peakTvl * 100;
  return {
    factor: 'tvlSharpDrop',
    value: drop,
    warning: drop > 50,
    danger: drop > 70
  };
}

// 检测大额连续流出
checkLargeOutflow(trades, windowSeconds = 5) {
  const now = Date.now() / 1000;
  const recentTrades = trades.filter(t =>
    t.type === 'sell' && t.timestamp > now - windowSeconds
  );

  const totalSell = recentTrades.reduce((sum, t) => sum + t.to_usd, 0);
  const avgTvl = this.getAverageTVL();

  return {
    factor: 'largeOutflowCount',
    count: recentTrades.length,
    totalAmount: totalSell,
    ratio: totalSell / avgTvl,
    warning: recentTrades.length > 3 || (totalSell / avgTvl) > 0.1
  };
}
```

## 卖出信号优化

当检测到以下情况时，建议立即卖出：
1. tvlSharpDrop > 50%
2. largeOutflowCount > 3笔且总金额 > TVL的10%
3. priceTvlDivergence > 10%（恐慌性抛售）

## 数据存储

在 signal metadata 中记录：
```json
{
  "escapeFactors": {
    "tvlSharpDrop": 86.3,
    "largeOutflowCount": 8,
    "priceTvlDivergence": 15.5,
    "peakTVL": 11988,
    "currentTVL": 1645,
    "escapeStartedAt": "2026-03-13T01:49:15.952Z"
  }
}
```
