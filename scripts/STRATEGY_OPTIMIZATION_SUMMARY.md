# 策略优化分析总结报告

## 一、分析概况

- **实验ID**: afed3289-2f89-4da5-88f1-1468d61f8b3d
- **数据规模**: 44个人工标注代币（高质量2个，中质量14个，低质量28个）
- **分析目标**: 评估购买前检查因子和趋势因子的区分能力，提出优化建议

---

## 二、数据结构说明

### 信号数据 (strategy_signals.metadata)

```javascript
{
  "trendFactors": {        // 趋势因子 - 例行运行阶段
    "age": number,         // 代币年龄(分钟)
    "fdv": number,         // 完全稀释估值
    "tvl": number,         // 总锁定价值
    "holders": number,     // 持币地址数
    "trendCV": number,     // 趋势变异系数
    "trendSlope": number,  // 趋势斜率
    "earlyReturn": number, // 早期收益率
    "riseSpeed": number,   // 上涨速度
    "trendTotalReturn": number,  // 总收益率
    "trendStrengthScore": number, // 趋势强度分数
    "drawdownFromHighest": number, // 从最高点回撤
    // ... 更多因子
  },
  "preBuyCheckFactors": {  // 购买前检查因子
    "holderBlacklistCount": number,    // 黑名单持币地址数
    "holderWhitelistCount": number,    // 白名单持币地址数
    "devHoldingRatio": number,         // 开发者持仓比例
    "maxHoldingRatio": number,         // 最大持仓比例
    "earlyTradesCountPerMin": number,  // 每分钟交易次数
    "earlyTradesVolumePerMin": number, // 每分钟交易量
    "earlyTradesUniqueWallets": number,// 早期独立钱包数
    "earlyTradesWalletsPerMin": number,// 每分钟活跃钱包数
    // ... 更多因子
  }
}
```

---

## 三、购买前检查因子分析

### 3.1 因子区分能力排序

| 排名 | 因子 | 分离度 | 中高质量均值 | 低质量均值 |
|------|------|--------|-------------|-----------|
| 1 | earlyTradesUniqueWallets | 1.25 | 89.69 | 53.18 |
| 2 | holderWhitelistCount | 1.10 | 38.06 | 24.75 |
| 3 | earlyTradesWalletsPerMin | 1.10 | 68.03 | 42.16 |
| 4 | earlyTradesCountPerMin | 1.00 | 131.39 | 81.99 |
| 5 | earlyTradesVolumePerMin | 0.85 | 11238.47 | 7495.43 |

### 3.2 优化建议

| 因子 | 当前阈值 | 建议阈值 | 说明 |
|------|----------|----------|------|
| earlyTradesUniqueWallets | 未设置 | >= 70 | **新增**，最强特征 |
| earlyTradesWalletsPerMin | 未设置 | >= 65 | **新增** |
| holderWhitelistCount | >= 黑名单*2 | >= 30 | 设绝对下限 |
| earlyTradesCountPerMin | >= 30 | >= 120 | 大幅提高 |
| earlyTradesVolumePerMin | >= 4000 | >= 10000 | 大幅提高 |

---

## 四、趋势因子分析

### 4.1 因子区分能力排序

| 排名 | 因子 | 分离度 | 中高质量均值 | 低质量均值 |
|------|------|--------|-------------|-----------|
| 1 | tvl | 1.70 | 7586.39 | 4096.26 |
| 2 | earlyReturn | 1.54 | 217.82 | 91.71 |
| 3 | fdv | 1.46 | 12430.80 | 7648.91 |
| 4 | holders | 1.15 | 50.06 | 27.64 |
| 5 | drawdownFromHighest | 1.10 | -2.18 | -10.85 |

### 4.2 关键发现

**当前趋势策略问题严重**：
- 精确率仅 36.4%
- 召回率 100%（几乎所有代币都通过）
- 假正率接近 100%

**原因**：阈值设置过于宽松

### 4.3 优化建议

| 因子 | 当前阈值 | 建议阈值 | 说明 |
|------|----------|----------|------|
| tvl | 未设置 | >= 5000 | **新增**，最强特征 |
| fdv | 未设置 | >= 8000 | **新增** |
| holders | 未设置 | >= 30 | **新增** |
| earlyReturn | > 15 | > 80 | 大幅提高 |
| drawdownFromHighest | > -25 | >= -10 | 收紧 |
| trendTotalReturn | >= 10 | > 50 | 提高 |

### 4.4 建议移除的弱因子

- `trendPriceUp`, `trendMedianUp`: 所有代币值相同，无区分能力
- `trendStrengthScore`: 方向与预期相反（低质量代币分数更高）
- `trendRiseRatio`, `trendRecentDownRatio`: 分离度较低

---

## 五、策略组合对比

### 5.1 策略对比表

| 策略 | 精确率 | 召回率 | F1 | 特点 |
|------|--------|--------|-----|------|
| **当前策略** | 34.9% | 93.8% | 50.8% | 过于宽松，误判率高 |
| **优化策略A-保守** | 100% | 18.8% | 31.6% | 精确率最高，但召回率低 |
| **优化策略B-平衡** | 87.5% | 43.8% | 58.3% | **推荐**，平衡精度和召回 |
| **优化策略C-激进** | 73.3% | 68.8% | 71.0% | 召回率最高，F1最高 |
| **优化策略D-趋势强化** | 100% | 25.0% | 40.0% | 强化趋势筛选 |

### 5.2 推荐策略：优化策略B（平衡）

**混淆矩阵**：
```
                实际
         ┌─────────────┬─────────────┐
         │   高质量    │   低质量    │
   ┌─────┼─────────────┼─────────────┤
预  │通过 │  TP =   7  │  FP =   1  │
测  ├─────┼─────────────┼─────────────┤
结  │拒绝 │  FN =   9  │  TN =  27  │
   └─────┴─────────────┴─────────────┘
```

**与当前策略对比**：
- 精确率: 34.9% → 87.5% (+52.6%)
- 假正率: 100% → 3.6% (-96.4%)
- 权衡: 召回率 93.8% → 43.8% (-50%)

---

## 六、推荐策略配置

### 6.1 趋势条件（例行运行阶段）

```
trendCondition = "
  earlyReturn > 80 AND
  drawdownFromHighest >= -10 AND
  tvl >= 5000 AND
  holders >= 30 AND
  fdv >= 8000
"
```

### 6.2 购买前检查条件（执行购买前）

```
preBuyCheckCondition = "
  holderBlacklistCount <= 5 AND
  holderWhitelistCount >= 25 AND
  devHoldingRatio < 15 AND
  maxHoldingRatio < 18 AND
  earlyTradesCountPerMin >= 100 AND
  earlyTradesVolumePerMin >= 8000 AND
  earlyTradesUniqueWallets >= 65
"
```

---

## 七、实施建议

### 7.1 立即实施
1. 添加新特征：`earlyTradesUniqueWallets`, `tvl`, `fdv`, `holders`
2. 调整阈值：`earlyReturn` 从 >15 提高到 >80

### 7.2 逐步调整
1. 先在回测环境验证效果
2. 小幅度逐步收紧阈值，观察实盘表现
3. 持续积累人工标注数据，定期重新训练

### 7.3 风险提示
- 高质量样本较少（仅2个），统计结果可能不够稳健
- 建议积累更多标注数据后进一步验证
- 不同市场环境可能需要不同的策略参数

---

## 八、分析脚本

以下脚本可用于后续分析：

- `scripts/analyze_human_judgment_summary.js` - 购买前检查因子分析
- `scripts/analyze_trend_factors.js` - 趋势因子分析
- `scripts/analyze_combined_strategies.js` - 策略组合评估
- `scripts/evaluate_prebuy_strategies.js` - 策略混淆矩阵
