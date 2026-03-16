# 砸盘预警因子设计

## 核心发现：Qshit案例分析

通过分析Qshit代币的价格暴跌前交易模式，发现了**"大户离场后的平静期"**这一关键预警信号。

### 时间线

```
区块 86267162: 最后两笔大额买入 $324.19 x 2
    ↓ (42秒后，交易萎缩)
区块 86267169-86267171: 平均单笔 $19，交易极度萎缩
    ↓
区块 86267176: 价格峰值
    ↓
价格暴跌 -72.8%，TVL流出 -90.4%
```

## 预警因子设计

### 1. 大户消失因子 (whaleAbsence)

**定义**: 大额买入($300+)消失的时间长度

```javascript
// 计算最后大额买入距离现在的区块数
function calculateWhaleAbsence(trades, currentBlock, threshold = 300) {
  const lastLargeBuy = trades
    .filter(t => t.to_usd > threshold && t.block_number < currentBlock)
    .sort((a, b) => b.block_number - a.block_number)[0];

  if (!lastLargeBuy) return null;

  const blocksSince = currentBlock - lastLargeBuy.block_number;
  const secondsSince = blocksSince * 3; // BSC每区块约3秒

  return {
    factor: 'whaleAbsence',
    lastLargeBuyBlock: lastLargeBuy.block_number,
    blocksSinceLastLarge: blocksSince,
    secondsSinceLastLarge: secondsSince,
    warning: blocksSince > 10,  // 30秒没有大额买入
    danger: blocksSince > 15     // 45秒没有大额买入
  };
}
```

**阈值**:
- `blocksSinceLastLarge > 10` (30秒): 预警
- `blocksSinceLastLarge > 15` (45秒): 危险

### 2. 交易萎缩因子 (tradingShrinkage)

**定义**: 交易活跃度下降的程度

```javascript
function calculateTradingShrinkage(byBlock, currentBlock, windowBlocks = 6) {
  // 获取最近两个窗口的交易数据
  const recentBlocks = getRecentBlocks(byBlock, currentBlock, windowBlocks * 2);
  const midPoint = recentBlocks.length / 2;

  const currentWindow = recentBlocks.slice(midPoint);
  const previousWindow = recentBlocks.slice(0, midPoint);

  const currentAvg = calculateAvgTrade(currentWindow);
  const previousAvg = calculateAvgTrade(previousWindow);

  const shrinkage = (previousAvg - currentAvg) / previousAvg * 100;

  return {
    factor: 'tradingShrinkage',
    currentAvgAmount: currentAvg,
    previousAvgAmount: previousAvg,
    shrinkagePercent: shrinkage,
    warning: shrinkage > 50,    // 平均金额下降50%
    danger: shrinkage > 70 || currentAvg < 30  // 平均金额下降70%或低于$30
  };
}
```

**阈值**:
- `shrinkage > 50%`: 预警
- `shrinkage > 70%` 或 `currentAvg < $30`: 危险

### 3. 大户撤离信号因子 (whaleExitSignal)

**定义**: 大户停止买入 + 交易萎缩的组合信号

```javascript
function calculateWhaleExitSignal(byBlock, trades, currentBlock) {
  const whaleAbsence = calculateWhaleAbsence(trades, currentBlock);
  const tradingShrinkage = calculateTradingShrinkage(byBlock, currentBlock);

  // 组合判断
  const isWhaleAbsent = whaleAbsence?.danger || false;
  const isTradingShrunk = tradingShrinkage?.danger || false;

  const signal = {
    factor: 'whaleExitSignal',
    level: 'none',
    reason: []
  };

  if (isWhaleAbsent && isTradingShrunk) {
    signal.level = 'critical';
    signal.reason.push('大户停止买入且交易极度萎缩');
  } else if (whaleAbsence?.warning || tradingShrinkage?.warning) {
    signal.level = 'warning';
    if (whaleAbsence?.warning) signal.reason.push('大户停止买入');
    if (tradingShrinkage?.warning) signal.reason.push('交易萎缩');
  }

  return signal;
}
```

### 4. 持仓集中度变化因子 (concentrationShift)

**定义**: 检测早期大户是否在后期停止买入

```javascript
function calculateConcentrationShift(trades, currentBlock) {
  // 找出前25%时间买入超过$200的钱包
  const sortedTimes = trades.map(t => t.time).sort();
  const firstQuarterTime = sortedTimes[Math.floor(sortedTimes.length / 4)];

  const earlyWhales = trades.filter(t =>
    t.to_usd > 200 && t.time <= firstQuarterTime
  ).map(t => t.wallet_address);

  // 检查这些钱包在最近60秒是否还在买入
  const recentTime = currentBlock * 3 - 60;
  const activeEarlyWhales = trades.filter(t =>
    earlyWhales.includes(t.wallet_address) && t.time >= recentTime
  ).map(t => t.wallet_address);

  const inactiveRatio = (earlyWhales.length - activeEarlyWhales.length) / earlyWhales.length;

  return {
    factor: 'concentrationShift',
    earlyWhaleCount: earlyWhales.length,
    activeEarlyWhaleCount: activeEarlyWhales.length,
    inactiveEarlyWhaleRatio: inactiveRatio,
    warning: inactiveRatio > 0.5,   // 超过50%早期大户停止
    danger: inactiveRatio > 0.7      // 超过70%早期大户停止
  };
}
```

## 综合预警逻辑

```javascript
// 在 KlineMonitor 或 DecisionMaker 中
function checkDumpSignals(tokenData) {
  const signals = {
    whaleAbsence: calculateWhaleAbsence(tokenData.trades, tokenData.currentBlock),
    tradingShrinkage: calculateTradingShrinkage(tokenData.byBlock, tokenData.currentBlock),
    whaleExit: calculateWhaleExitSignal(tokenData.byBlock, tokenData.trades, tokenData.currentBlock),
    concentrationShift: calculateConcentrationShift(tokenData.trades, tokenData.currentBlock)
  };

  // 计算综合风险等级
  let riskLevel = 0;
  if (signals.whaleAbsence?.danger) riskLevel += 2;
  if (signals.tradingShrinkage?.danger) riskLevel += 2;
  if (signals.whaleExit?.level === 'critical') riskLevel += 3;
  if (signals.concentrationShift?.danger) riskLevel += 1;

  return {
    riskLevel,  // 0-8, 越高越危险
    signals,
    shouldSell: riskLevel >= 5,  // 风险等级>=5建议卖出
    shouldSkipBuy: riskLevel >= 3  // 风险等级>=3不建议买入
  };
}
```

## 信号示例

### Qshit案例 (区块86267170，峰值前6个区块)

```json
{
  "whaleAbsence": {
    "blocksSinceLastLarge": 8,
    "secondsSinceLastLarge": 24,
    "warning": false,
    "danger": false
  },
  "tradingShrinkage": {
    "currentAvgAmount": 19,
    "previousAvgAmount": 66,
    "shrinkagePercent": 71,
    "warning": true,
    "danger": true
  },
  "whaleExitSignal": {
    "level": "warning",
    "reason": ["交易萎缩"]
  },
  "concentrationShift": {
    "inactiveEarlyWhaleRatio": 0.78,
    "warning": true,
    "danger": true
  },
  "riskLevel": 5,
  "shouldSkipBuy": true,
  "shouldSell": false
}
```

## 建议应用

1. **买入信号过滤**: 当 `riskLevel >= 3` 时，跳过买入
2. **已有持仓**: 当 `riskLevel >= 5` 时，立即卖出
3. **实时监控**: 每个区块都计算这些因子，当风险等级突然上升时预警

## 后续验证

需要收集更多"拉高出货"案例，验证这些因子的有效性和阈值设置。
