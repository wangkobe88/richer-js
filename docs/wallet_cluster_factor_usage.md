# 钱包簇因子使用说明

## 概述

钱包簇因子用于检测拉砸（Pump & Dump）代币的"钱包簇"特征。

### 核心原理

- **拉砸代币**：少数大型"钱包簇"无间隔时间一起行动，第2簇远小于第1簇
- **正常代币**：多个小簇或簇大小分布更均匀

---

## 可用因子

| 因子名称 | 类型 | 说明 | 示例值 | 拉砸特征 |
|---------|------|------|--------|---------|
| **核心特征** | | | | |
| `walletClusterSecondToFirstRatio` | float | 第2簇/第1簇比值 | 0.15 | **< 0.3** |
| `walletClusterMegaRatio` | float | 超大簇占比（>100笔） | 0.55 | **> 0.4** |
| `walletClusterTop2Ratio` | float | 前2簇占比 | 0.86 | **> 0.8** |
| **簇规模** | | | | |
| `walletClusterCount` | int | 簇数量 | 5 | 较少 |
| `walletClusterMaxSize` | int | 最大簇大小 | 203 | **> 100** |
| `walletClusterSecondSize` | int | 第2簇大小 | 8 | 较小 |
| `walletClusterAvgSize` | float | 平均簇大小 | 42.5 | - |
| `walletClusterMinSize` | int | 最小簇大小 | 2 | - |
| **集中度** | | | | |
| `walletClusterMegaCount` | int | 超大簇数量 | 1 | ≥ 1 |
| `walletClusterMaxClusterWallets` | int | 最大簇钱包数 | 80 | - |
| **其他** | | | | |
| `walletClusterIntervalMean` | float | 簇间平均间隔（秒） | 5.2 | - |
| `walletClusterThreshold` | float | 簇识别时间阈值 | 2 | - |

> **注意**：总钱包数请使用 `earlyTradesUniqueWallets`（不重复提供）

---

## 条件表达式示例

### 1. 推荐规则（过滤拉砸代币）

```javascript
// 规则：第2簇/第1簇 >= 0.3 且 超大簇占比 < 40%
walletClusterSecondToFirstRatio > 0.3 && walletClusterMegaRatio < 0.4
```

### 2. 严格规则

```javascript
// 更严格的阈值
walletClusterSecondToFirstRatio > 0.2 && walletClusterMegaRatio < 0.3
```

### 3. 组合早期参与者因子

```javascript
// 同时检查交易活跃度和簇特征
earlyTradesCountPerMin >= 10.6 AND walletClusterSecondToFirstRatio > 0.3
```

### 4. 单特征过滤

```javascript
// 只检查超大簇占比
walletClusterMegaRatio < 0.4

// 只检查第2簇/第1簇
walletClusterSecondToFirstRatio > 0.3

// 只检查前2簇占比
walletClusterTop2Ratio < 0.8
```

### 5. 自定义组合

```javascript
// 多条件组合
walletClusterSecondToFirstRatio > 0.25
AND walletClusterMegaRatio < 0.5
AND walletClusterTop2Ratio < 0.85
```

---

## 性能指标

基于12个样本（6个拉砸 + 6个非拉砸）的测试结果：

**推荐规则**：`第2簇/第1簇 >= 0.3 且 超大簇占比 < 40%`
- 准确率：83.3%
- 精确率：75.0%
- 召回率：100%（不漏任何拉砸）
- F1分数：0.86

---

## 注意事项

1. **自动执行**：钱包簇因子与早期参与者因子一样，总是计算并可用
2. **数据复用**：使用早期参与者检查的交易数据，无额外API调用
3. **性能影响**：计算开销极小（毫秒级）
4. **钱包数**：使用 `earlyTradesUniqueWallets` 获取总钱包数（不重复提供）

---

## 因子对比

| 场景 | 推荐因子组合 |
|-----|-------------|
| 过滤拉砸 | `walletClusterSecondToFirstRatio > 0.3 && walletClusterMegaRatio < 0.4` |
| 高召回率 | `walletClusterSecondToFirstRatio > 0.2` |
| 高精确率 | `walletClusterSecondToFirstRatio > 0.4 && walletClusterMegaRatio < 0.3` |
| 组合检查 | `earlyTradesCountPerMin >= 10.6 && walletClusterSecondToFirstRatio > 0.3` |
