## 重新分析两个实验的真正差异

### preBuyCheckCondition 对比

**实验1:**
```
holderBlacklistCount <= 5 AND holderWhitelistCount >= holderBlacklistCount * 2 AND
devHoldingRatio <= 15 AND maxHoldingRatio < 18 AND
earlyTradesHighValueCount >= 8 AND earlyTradesHighValuePerMin >= 10 AND
earlyTradesCountPerMin >= 30 AND earlyTradesVolumePerMin >= 3200 AND
earlyTradesActualSpan >= 60 AND walletClusterMaxBlockBuyRatio < 0.15 AND
(walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85) AND
creatorIsNotBadDevWallet >= 1 AND
drawdownFromHighest > -25 AND
earlyTradesCountPerMin < 150
```

**实验2:**
```
holderBlacklistCount <= 5 AND holderWhitelistCount >= holderBlacklistCount * 2 AND
devHoldingRatio <= 15 AND maxHoldingRatio < 18 AND
earlyTradesHighValueCount >= 8 AND earlyTradesHighValuePerMin >= 10 AND
earlyTradesCountPerMin >= 30 AND earlyTradesVolumePerMin >= 3200 AND
earlyTradesActualSpan >= 60 AND walletClusterMaxBlockBuyRatio < 0.15 AND
(walletClusterCount < 4 OR walletClusterTop2Ratio <= 0.85) AND
earlyTradesCountPerMin < 150
```

### 真正的差异

**实验1独有两个条件：**
1. `creatorIsNotBadDevWallet >= 1`
2. `drawdownFromHighest > -25`

**drawdownFromHighest > -25 确实只在 preBuyCheckCondition 中，不在 buyCondition 中。**

### 分析那13个代币被过滤的原因

需要检查这13个代币的：
1. `creatorIsNotBadDevWallet` 的值是多少
2. `drawdownFromHighest` 的值是多少

只有这两个条件才能解释为什么实验1过滤掉了这13个代币。

### 待验证

那13个代币中：
- 有多少个是因为 `creatorIsNotBadDevWallet < 1` 被过滤？
- 有多少个是因为 `drawdownFromHighest <= -25` 被过滤？
- 有多少个是因为两个条件都不满足被过滤？

这需要进一步的因子数据来确认。
