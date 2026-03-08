# 策略优化实施指南

## 一、核心发现总结

### 1.1 购买前检查因子

| 因子 | 分离度 | 当前阈值 | 建议阈值 | 状态 |
|------|--------|----------|----------|------|
| earlyTradesUniqueWallets | 1.25 | 未设置 | >= 60 | **新增** |
| holderWhitelistCount | 1.10 | >= 黑名单*2 | >= 22 | 优化 |
| earlyTradesWalletsPerMin | 1.10 | 未设置 | 可选 | 新增 |
| earlyTradesCountPerMin | 1.00 | >= 30 | >= 90 | 大幅提高 |
| earlyTradesVolumePerMin | 0.85 | >= 4000 | >= 7000 | 大幅提高 |

### 1.2 趋势因子

| 因子 | 分离度 | 当前阈值 | 建议阈值 | 状态 |
|------|--------|----------|----------|------|
| tvl | 1.70 | 未设置 | >= 5000 | **新增** |
| earlyReturn | 1.54 | > 15 | > 80 | 大幅提高 |
| fdv | 1.46 | 未设置 | >= 8000 | **新增** |
| holders | 1.15 | 未设置 | >= 30 | **新增** |
| drawdownFromHighest | 1.10 | > -25 | >= -10 | 收紧 |

### 1.3 策略效果对比

| 策略 | 精确率 | 召回率 | F1 | 假正率 |
|------|--------|--------|-----|--------|
| 当前策略 | 34.9% | 93.8% | 50.8% | 100% |
| 优化方案A（平衡） | 61.1% | 68.8% | 64.7% | 25% |
| 优化方案B（高召回） | 44.4% | 75.0% | 55.8% | 42% |
| 优化方案C（高精度） | 100% | 43.8% | 60.9% | 0% |

---

## 二、推荐配置

### 2.1 平衡优化版（推荐）

```
// 购买前检查条件
preBuyCheckCondition = "
  holderBlacklistCount <= 5 AND
  holderWhitelistCount >= 22 AND
  devHoldingRatio < 15 AND
  maxHoldingRatio < 18 AND
  earlyTradesCountPerMin >= 90 AND
  earlyTradesVolumePerMin >= 7000 AND
  earlyTradesUniqueWallets >= 60
"

// 趋势条件（配合使用）
trendCondition = "
  earlyReturn > 80 AND
  drawdownFromHighest >= -10 AND
  tvl >= 5000 AND
  holders >= 30 AND
  fdv >= 8000
"
```

**效果**：
- 精确率：61.1%
- 召回率：68.8%
- F1分数：64.7%
- 误判率降低75%

---

## 三、遗漏与误判分析

### 3.1 遗漏的高质量代币特征

遗漏的5个高质量代币全部因以下三个条件被拒绝：
- `earlyTradesCountPerMin >= 90`：100%被此条件阻挡
- `earlyTradesVolumePerMin >= 7000`：100%被此条件阻挡
- `earlyTradesUniqueWallets >= 60`：100%被此条件阻挡

遗漏代币均值 vs 通过代币均值：
| 指标 | 遗漏均值 | 通过均值 |
|------|----------|----------|
| 交易数/分钟 | 53.04 | 167.01 |
| 交易量/分钟 | 4659.65 | 14228.85 |
| 独立钱包数 | 43.20 | 110.82 |

### 3.2 误判的低质量代币特征

7个误判的低质量代币共同特征：
- 早期收益率平均：89.47%（表现良好）
- TVL平均：4431.55（中等偏低）
- 从最高点回撤：部分代币有较大回撤

**建议**：这些代币需要结合趋势条件进一步过滤，特别是 `drawdownFromHighest` 和 `tvl` 指标。

---

## 四、实施步骤

### 4.1 立即实施（高优先级）

1. **添加新特征**：
   ```javascript
   // 在 PreBuyCheckService 中添加
   earlyTradesUniqueWallets
   tvl
   fdv
   holders
   ```

2. **调整现有阈值**：
   ```javascript
   // 配置文件更新
   earlyTradesCountPerMin: 30 → 90
   earlyTradesVolumePerMin: 4000 → 7000
   holderWhitelistCount: 相对值 → 22（绝对值）
   earlyReturn: 15 → 80
   ```

### 4.2 验证测试

1. 在回测环境运行，对比新旧策略效果
2. 检查遗漏的高质量代币是否在可接受范围内
3. 确认误判的低质量代币显著减少

### 4.3 逐步上线

1. 先用虚拟交易模式运行1-2天
2. 监控通过率、精确率等关键指标
3. 确认稳定后切换到实盘

---

## 五、监控指标

### 5.1 核心指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 精确率 | > 60% | 通过检查中高质量代币的比例 |
| 召回率 | > 65% | 高质量代币被正确识别的比例 |
| 通过率 | 20-30% | 不应过高或过低 |
| 假正率 | < 30% | 低质量代币被误判的比例 |

### 5.2 持续优化

- 每周积累新的人工标注数据
- 每月重新评估阈值配置
- 根据市场环境调整参数

---

## 六、风险提示

1. **样本量限制**：高质量样本仅2个，统计结果可能不够稳健
2. **市场环境变化**：不同市场环境可能需要不同参数
3. **过度拟合风险**：建议在多个时间段验证策略效果

---

## 七、相关脚本

以下脚本可用于后续分析和调整：

- `scripts/analyze_human_judgment_summary.js` - 购买前检查因子分析
- `scripts/analyze_trend_factors.js` - 趋势因子分析
- `scripts/analyze_combined_strategies.js` - 策略组合评估
- `scripts/find_optimal_thresholds.js` - 寻找最优阈值
- `scripts/analyze_token_details.js` - 遗漏与误判分析
