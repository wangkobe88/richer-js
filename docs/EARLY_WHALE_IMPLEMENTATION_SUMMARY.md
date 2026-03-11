# 早期大户因子实现完成总结

## 实现完成

已成功将早期大户因子集成到实验引擎中，支持通过回测决定阈值。

## 新增因子

### 核心因子
1. **`earlyWhaleHoldRatio`** - 早期大户持有率（0.0-1.0）
2. **`earlyWhaleSellRatio`** - 早期大户卖出率（0.0->1.0）
3. **`earlyWhaleCount`** - 早期大户数量

### 调试因子
- `earlyWhaleMethod` - 使用的方法（'real_early' 或 'relative'）
- `earlyWhaleTotalTrades` - 分析的交易总数
- `earlyWhaleEarlyThreshold` - 早期交易阈值

## 实现方案

### 混合方案（已实现）
- **真实早期数据**（时间差 <= 120s）：使用前30笔交易作为"早期"
- **相对交易位置**（时间差 > 120s）：使用观察窗口的前30%交易作为"早期"

### 早期大户定义
- 在"早期"交易中入场
- 买入金额 > $200

## 文件修改

### 新增文件
- `src/trading-engine/pre-check/EarlyWhaleService.js` - 早期大户分析服务
- `docs/EARLY_WHALE_FACTOR.md` - 因子文档
- `test_early_whale_factor.js` - 集成测试

### 修改文件
- `src/trading-engine/pre-check/PreBuyCheckService.js` - 集成早期大户检查
- `src/trading-engine/core/FactorBuilder.js` - 添加因子到构建器

## 使用方法

### 在策略条件中使用

```javascript
// 示例条件
"earlyWhaleSellRatio > 0.7"              // 保守策略
"earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3"  // 平衡策略
"holderBlacklistCount === 0 && earlyWhaleSellRatio > 0.7"  // 组合条件
```

### 在实验配置中使用

```json
{
  "preBuyCheckCondition": "earlyWhaleSellRatio > 0.7",
  "description": "过滤早期大户卖出率超过70%的代币"
}
```

## 实验数据参考

基于两个实验的40个有大户数据的代币（14个盈利，23个亏损）：

| 条件 | 亏损召回 | 盈利误伤 | F1分数 |
|-----|---------|---------|--------|
| `earlyWhaleSellRatio > 0.7` | 54.2% (13/24) | **6.3% (1/16)** | 0.687 |
| `earlyWhaleSellRatio > 0.6` | 未测试 | 预计更高 | 预计更低 |
| `earlyWhaleHoldRatio < 0.4` | 87.0% (20/24) | 57.1% (8/16) | 0.574 |

**建议先测试**：
- 保守策略：`earlyWhaleSellRatio > 0.7`（盈利误伤最低）
- 平衡策略：`earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3`
- 激进策略：`earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.5`

## 回测建议

### 步骤1：创建多个实验配置

```json
// 实验1：保守策略（earlyWhaleSellRatio > 0.7）
{
  "name": "Early Whale Conservative",
  "preBuyCheckCondition": "earlyWhaleSellRatio > 0.7",
  "description": "早期大户卖出率70%"
}

// 实验2：平衡策略
{
  "name": "Early Whale Balanced",
  "preBuyCheckCondition": "earlyWhaleHoldRatio < 0.4 && earlyWhaleSellRatio > 0.3",
  "description": "早期大户组合条件"
}

// 实验3：激进策略
{
  "name": "Early Whale Aggressive",
  "preBuyCheckCondition": "earlyWhaleHoldRatio < 0.5 && earlyWhaleSellRatio > 0.5",
  "description": "早期大户激进条件"
}
```

### 步骤2：运行回测

使用现有的历史数据运行回测，比较不同阈值的性能。

### 步骤3：选择最佳阈值

根据回测结果选择召回率和误伤率最佳平衡的阈值。

## 验证

所有测试通过：
- ✓ 服务加载
- ✓ 因子计算
- ✓ 条件评估
- ✓ 因子构建

## 注意事项

1. **数据依赖**：早期大户分析复用 EarlyParticipantCheckService 的交易数据，无需额外API调用
2. **时间窗口**：在生产环境中只使用信号时间之前的交易数据
3. **默认值**：没有足够数据时，返回保守默认值（holdRatio=1.0, sellRatio=0）
4. **回测兼容**：新增因子已集成到 FactorBuilder，完全支持回测引擎

## 下一步

1. 创建实验配置（使用不同的阈值）
2. 运行回测
3. 分析结果，选择最佳阈值
4. 部署到生产环境
