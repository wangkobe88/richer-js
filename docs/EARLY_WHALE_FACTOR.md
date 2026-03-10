# 早期大户因子 - 实现文档

## 概述

新增三个早期大户因子，用于检测拉砸代币的"早期大户抛售"特征。

## 新增因子

### 1. `earlyWhaleHoldRatio`
- **定义**：早期大户中未卖出任何代币的比例
- **范围**：0.0 - 1.0（0% - 100%）
- **含义**：
  - 高值（>0.5）：早期大户多数持有，正常代币
  - 低值（<0.3）：早期大户多数卖出，拉砸代币

### 2. `earlyWhaleSellRatio`
- **定义**：早期大户的卖出比例（总卖出代币数 / 总买入代币数）
- **范围**：0.0 - >1.0
- **含义**：
  - 低值（<0.5）：早期大户卖出较少，正常代币
  - 高值（>0.7）：早期大户大量卖出，拉砸代币

### 3. `earlyWhaleCount`
- **定义**：早期大户的数量
- **含义**：早期参与的大户数量

## 早期大户定义

**早期大户**：满足以下条件的钱包
1. 在"早期"交易中入场
2. 买入金额 > $200

**"早期"的定义**（混合方案）：
- **真实早期数据**（时间差 <= 120秒）：前30笔交易（或前20%）
- **相对交易位置**（时间差 > 120秒）：观察窗口的前30%交易

## 使用方法

### 在策略条件中使用

```javascript
// 示例：过滤早期大户大量卖出的代币
const condition = "earlyWhaleSellRatio > 0.7";

// 或使用组合条件
const condition = "earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3";

// 或与其他因子组合
const condition = "holderBlacklistCount === 0 && earlyWhaleSellRatio > 0.7";
```

### 在实验配置中使用

```json
{
  "preBuyCheckCondition": "earlyWhaleSellRatio > 0.7",
  "description": "过滤早期大户卖出率超过70%的代币"
}
```

## 数据来源

### 交易数据
早期大户分析复用 `EarlyParticipantCheckService` 获取的交易数据，无需额外API调用。

### 时间信息
- `tokenCreateTime`：代币创建时间（从 tokenInfo.tokenCreatedAt 获取）
- `checkTime`：信号时间/检查时间（从 options.checkTime 或当前时间获取）
- `windowStart`：观察窗口起始时间（从早期参与者检查结果获取）

## 回测支持

新增因子已集成到 `FactorBuilder.buildPreBuyCheckFactorValues()`，支持在回测引擎中使用。

## 调试信息

除了核心因子外，还提供以下调试信息：

- `earlyWhaleMethod`：使用的方法（'real_early' 或 'relative'）
- `earlyWhaleTotalTrades`：分析的交易总数
- `earlyWhaleEarlyThreshold`：早期交易阈值

## 实验结果

基于两个实验的40个有大户数据的代币（14个盈利，23个亏损）：

| 条件 | 亏损召回 | 盈利误伤 | F1分数 |
|-----|---------|---------|--------|
| `earlyWhaleSellRatio > 0.7` | 54.2% (13/24) | **6.3% (1/16)** | 0.687 |
| `earlyWhaleHoldRatio < 0.4` | 87.0% (20/24) | 57.1% (8/16) | 0.574 |

**推荐阈值**：`earlyWhaleSellRatio > 0.7`
- 盈利误伤最低（6.3%）
- 综合性能良好（F1=0.687）

## 文件修改清单

1. **新增文件**：
   - `src/trading-engine/pre-check/EarlyWhaleService.js` - 早期大户分析服务

2. **修改文件**：
   - `src/trading-engine/pre-check/PreBuyCheckService.js` - 集成早期大户检查
   - `src/trading-engine/core/FactorBuilder.js` - 添加早期大户因子到构建器

3. **文档**：
   - `docs/EARLY_WHALE_FACTOR.md` - 本文档

## 下一步

通过回测实验确定最佳阈值：
1. 创建多个实验配置，使用不同的阈值
2. 运行回测，比较性能
3. 选择最佳阈值用于生产环境

## 示例条件表达式

```javascript
// 保守策略（低误伤）
"earlyWhaleSellRatio > 0.7"

// 平衡策略
"earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3"

// 激进策略（高召回）
"earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.5"

// 与其他因子组合
"holderBlacklistCount === 0 && earlyWhaleSellRatio > 0.7"

// 多重条件
"holderBlacklistCount === 0 && walletClusterSecondToFirstRatio > 0.3 && earlyWhaleSellRatio > 0.7"
```
