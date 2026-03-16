# 最新四个回测实验分析报告

## 实验概览

**实验时间**: 2026-03-16
**分析范围**: 回测006, 007, 008, 009

### 实验基本信息

| 实验ID | 实验名称 | 买入信号 | 执行/拒绝 | 总交易 | 盈亏(%) | 胜率 |
|--------|----------|----------|-----------|--------|---------|------|
| 68db0134 | 回测006 | 156 | 15/141 | 56 | +23.3% | 48% |
| e3c37811 | 回测007 | 221 | 21/200 | 46 | +6.6% | 36% |
| 7855de6d | 回测008 | 235 | 27/208 | 70 | +25.8% | 43% |
| 70fea05f | 回测009 | 275 | 52/223 | 104 | +8.2% | 50% |

## 汇总统计

```
总买入信号:   887
总执行/拒绝:  115 / 772
执行率:       13.0%
总盈亏:       +21.33 (+15.5%)
总胜率:       45.2% (52/115)
```

## 策略配置

四个实验使用**完全相同的策略配置**：

### 买入条件
```
holderTrendCV > 0.02 AND holderTrendSlope > 0.005 AND
holderTrendHolderCountUp >= 1 AND holderTrendMedianUp >= 1 AND
holderTrendStrengthScore >= 30 AND holderTrendGrowthRatio >= 2 AND
holderTrendRecentDecreaseRatio < 0.6 AND holderTrendRiseRatio >= 0.25 AND
age > 1.2 AND tvl >= 5000 AND
trendCV > 0.02 AND trendSlope > 0.02 AND trendPriceUp >= 1 AND
trendMedianUp >= 1 AND trendStrengthScore >= 30 AND
trendTotalReturn >= 10 AND earlyReturn > 15 AND
trendRecentDownRatio < 0.6 AND trendRiseRatio >= 0.6
```

### 预检查条件 (preBuyCheckCondition)
```
holderBlacklistCount <= 5 AND
holderWhitelistCount >= holderBlacklistCount * 2 AND
devHoldingRatio <= 15 AND
maxHoldingRatio < 18 AND
earlyTradesHighValueCount >= 8 AND
earlyTradesHighValuePerMin >= 10 AND
earlyTradesCountPerMin >= 30 AND
earlyTradesCountPerMin < 150 AND
earlyTradesVolumePerMin >= 3200 AND
earlyTradesActualSpan >= 60 AND
walletClusterMaxBlockBuyRatio < 0.15 AND
(walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85) AND
walletClusterSecondToFirstRatio >= 0.1 AND
creatorIsNotBadDevWallet >= 1 AND
drawdownFromHighest > -25 AND
strongTraderNetPositionRatio < 7
```

### 卖出条件
- **优先级1**: holderDrawdownFromHighestSinceLastBuy <= -15 OR drawdownFromHighestSinceLastBuy <= -30, holdDuration < 180
- **优先级2**: holderDrawdownFromHighestSinceLastBuy <= -12 OR drawdownFromHighestSinceLastBuy <= -25, 180 <= holdDuration <= 300
- **优先级3**: drawdownFromHighestSinceLastBuy <= -10 OR drawdownFromHighestSinceLastBuy <= -20, holdDuration >= 300

## 预检查拒绝原因统计

### 四个实验汇总

| 拒绝原因 | 数量 | 占比 |
|----------|------|------|
| earlyTradesCountPerMin | 479 | 62.0% |
| earlyTradesVolumePerMin | 309 | 40.0% |
| earlyTradesHighValuePerMin | 307 | 39.8% |
| earlyTradesHighValueCount | 216 | 28.0% |
| earlyTradesActualSpan | 158 | 20.5% |
| drawdownFromHighest | 125 | 16.2% |
| walletClusterMaxBlockBuyRatio | 99 | 12.8% |
| strongTraderNetPositionRatio | 77 | 10.0% |

### 各实验拒绝原因

**回测006 (141拒绝)**:
- earlyTradesCountPerMin: 88 (62.4%)
- earlyTradesHighValuePerMin: 55 (39.0%)
- earlyTradesVolumePerMin: 52 (36.9%)
- earlyTradesHighValueCount: 35 (24.8%)

**回测007 (200拒绝)**:
- earlyTradesCountPerMin: 136 (68.0%)
- earlyTradesVolumePerMin: 88 (44.0%)
- earlyTradesHighValuePerMin: 84 (42.0%)
- earlyTradesHighValueCount: 66 (33.0%)

**回测008 (208拒绝)**:
- earlyTradesCountPerMin: 132 (63.5%)
- earlyTradesHighValuePerMin: 73 (35.1%)
- earlyTradesVolumePerMin: 72 (34.6%)
- earlyTradesHighValueCount: 56 (26.9%)

**回测009 (223拒绝)**:
- earlyTradesCountPerMin: 123 (55.2%)
- earlyTradesVolumePerMin: 97 (43.5%)
- earlyTradesHighValuePerMin: 95 (42.6%)
- earlyTradesHighValueCount: 59 (26.5%)

## 关键发现

### 1. 执行率偏低
- **平均执行率仅13.0%** (115/887)
- 主要原因: `earlyTradesCountPerMin` 条件过于严格，导致62%的信号被拒绝

### 2. 早期交易频率是最主要过滤因素
- `earlyTradesCountPerMin` (30-150范围) 拒绝了62%的信号
- 这表明大部分代币在早期的交易频率不符合预期

### 3. 四个实验表现差异分析

由于四个实验使用相同策略但**不同源数据**，表现差异主要源于数据集特征：

- **回测008**: 最高收益率25.8%，执行数27
- **回测006**: 收益率23.3%，执行数15
- **回测009**: 最低收益率8.2%，但执行数最高52，胜率最好50%
- **回测007**: 最低收益率6.6%，执行数21

### 4. 预检查条件效果

预检查成功过滤了大量低质量信号：
- 87%的信号被预检查拒绝
- 被拒绝的主要原因是早期交易活动不符合要求

### 5. 胜率分析
- 总胜率45.2%表明策略仍有改进空间
- 回测009胜率最高(50%)，但收益率较低，说明止盈策略可能过于保守

## 建议与优化方向

### 1. 调整 earlyTradesCountPerMin 阈值
- 当前设置 30-150 可能过严
- 建议测试更宽的范围如 20-180 或 25-170

### 2. 考虑放宽其他早期交易条件
- `earlyTradesVolumePerMin >= 3200` (40%拒绝率)
- `earlyTradesHighValuePerMin >= 10` (39.8%拒绝率)

### 3. 优化止盈策略
- 回测009高胜率低收益说明可能过早卖出
- 可考虑调整卖出阈值或延长持有时间

### 4. 分析不同源数据集的特征
- 四个实验使用不同源数据，表现差异较大
- 需要分析各源数据集的市场环境特征
