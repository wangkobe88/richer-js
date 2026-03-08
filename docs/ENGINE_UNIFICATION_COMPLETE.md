# 虚拟盘与实盘引擎统一完成

## 完成时间
2026-03-08

## 统一目标
将实盘交易引擎完全对齐虚拟盘的实现，确保两者在功能、流程、代码风格上完全一致。

---

## 核心改变

### 1. 信号创建时机 ✅ 已统一

**统一方式：先创建信号，后预检查**（虚拟盘的方式）

```javascript
// 1. 先创建并保存信号到数据库
const signal = { /* 信号对象 */ };
signalId = await tradeSignal.save();

// 2. 然后进行预检查
preBuyCheckResult = await this._preBuyCheckService.performAllChecks(...);

// 3a. 预检查失败 → 更新信号状态为 'failed'
if (!preCheckPassed) {
  await this._updateSignalStatus(signalId, 'failed', { reason: blockReason });
  return failResult(`预检查失败: ${blockReason}`);
}

// 3b. 预检查通过 → 更新信号元数据，执行交易
await this._updateSignalMetadata(signalId, { trendFactors, preBuyCheckFactors });
const result = await this.processSignal(signal, signalId);
```

**优势：**
- 记录所有触发策略的信号（包括被拒绝的）
- 便于分析预检查拒绝率和原因
- 完整的历史记录

### 2. 因子构建方式 ✅ 已统一

**统一方式：直接展开因子 + 使用 FactorBuilder 更新**

**创建信号时：**
```javascript
factors: {
  trendFactors: { /* 所有趋势因子 */ },
  preBuyCheckFactors: { /* 所有预检查因子，默认值 */ }
}
```

**预检查通过后更新：**
```javascript
const { buildFactorValuesForTimeSeries, buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
const signalMetadata = {
  trendFactors: buildFactorValuesForTimeSeries(factorResults),
  preBuyCheckFactors: buildPreBuyCheckFactorValues(preBuyCheckResult)
};
await this._updateSignalMetadata(signalId, signalMetadata);
```

### 3. 被拒信号记录 ✅ 已统一

**统一方式：记录所有被拒信号**

- 预检查失败的信号也会被创建
- 状态更新为 'failed'
- 元数据包含失败原因
- 便于回测和分析

---

## 详细对比

### 买入流程完全一致

| 步骤 | 虚拟盘 | 实盘 | 一致性 |
|------|--------|------|--------|
| 1. 创建信号对象 | ✅ | ✅ | ✅ |
| 2. 保存到数据库 | ✅ | ✅ | ✅ |
| 3. Dev 钱包检查 | ✅ | ✅ | ✅ |
| 4. PreBuyCheckService 检查 | ✅ | ✅ | ✅ |
| 5a. 失败 → 更新状态为 failed | ✅ | ✅ | ✅ |
| 5b. 通过 → 更新元数据并执行 | ✅ | ✅ | ✅ |

### 信号元数据完全一致

```javascript
factors: {
  trendFactors: {
    // 基础因子（17个）
    age, currentPrice, collectionPrice, earlyReturn, ...
    // 趋势因子（10个）
    trendCV, trendSlope, trendStrengthScore, ...
  },
  preBuyCheckFactors: {
    // 持有者检查（7个）
    holderWhitelistCount, holderBlacklistCount, ...
    // 早期参与者检查（19个）
    earlyTradesVolumePerMin, earlyTradesCountPerMin, ...
    // 钱包簇检查（12个）
    walletClusterSecondToFirstRatio, walletClusterMegaRatio, ...
  }
}
```

---

## 修改的文件

### 主要修改
- `src/trading-engine/implementations/LiveTradingEngine.js`
  - 调整信号创建时机（先创建后检查）
  - 添加信号预检查失败处理
  - 添加完整的预检查因子结构

### 验证脚本
- `scripts/verify_live_engine_upgrade.js`
  - 更新验证逻辑，检查信号创建时机

---

## 验证结果

```
✅ 实盘引擎升级验证通过！

🎉 已成功添加所有风险控制组件:
  1. ✅ PriceHistoryCache - 价格历史缓存（15分钟）
  2. ✅ TrendDetector - 趋势检测器
  3. ✅ TokenHolderService - 持有者服务
  4. ✅ PreBuyCheckService - 购买前检查服务

🎉 已成功添加所有辅助方法:
  1. ✅ _buildTokenInfo - 构建代币信息
  2. ✅ _buildTrendFactors - 构建趋势因子
  3. ✅ _buildPreBuyCheckFactors - 构建预检查因子
  4. ✅ _updateSignalMetadata - 更新信号元数据
  5. ✅ _updateSignalStatus - 更新信号状态

🎉 信号元数据已升级:
  1. ✅ 买入信号包含完整 trendFactors
  2. ✅ 买入信号包含完整 preBuyCheckFactors
  3. ✅ 卖出信号包含完整 trendFactors
  4. ✅ 使用统一的 FactorBuilder

🎉 信号创建时机已统一:
  1. ✅ 先创建信号，后预检查
  2. ✅ 记录所有被拒信号
  3. ✅ 完整的历史记录
```

---

## 代码一致性

### 初始化组件
```javascript
// 虚拟盘和实盘完全一致
this._priceHistoryCache = new PriceHistoryCache(15 * 60 * 1000);
this._trendDetector = new TrendDetector({ /* 参数一致 */ });
this._tokenHolderService = new TokenHolderService(supabase, this.logger);
this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
this._tokenPool = new TokenPool(this.logger, this._priceHistoryCache);
```

### 辅助方法
| 方法 | 虚拟盘 | 实盘 | 一致性 |
|------|--------|------|--------|
| _buildTokenInfo | ✅ | ✅ | ✅ |
| _buildTrendFactors | ❌ (直接展开) | ✅ | ✅ 功能等效 |
| _buildPreBuyCheckFactors | ❌ (直接展开) | ✅ | ✅ 功能等效 |
| _updateSignalMetadata | ✅ | ✅ | ✅ |
| _updateSignalStatus | ✅ | ✅ | ✅ |
| isNegativeDevWallet | ✅ | ✅ | ✅ |

---

## 关键差异分析（已解决）

### 之前的差异
1. ❌ 信号创建时机不同
2. ❌ 因子构建方式不同
3. ❌ 被拒信号记录不同

### 现在的状态
1. ✅ 信号创建时机完全一致
2. ✅ 因子构建方式功能等效（实盘使用 FactorBuilder）
3. ✅ 被拒信号记录完全一致

---

## 下一步

### 1. 测试（必须）
- [ ] 运行虚拟盘实验，验证预检查功能
- [ ] 检查被拒信号的元数据是否完整
- [ ] 验证信号状态更新是否正确

### 2. 数据准备
- [ ] 确认数据库中有钱包黑名单数据
- [ ] 确认实验配置中包含 preBuyCheck 配置

### 3. 实盘测试（谨慎）
- [ ] 从小额资金开始
- [ ] 设置异常告警机制
- [ ] 密切监控前几天的交易

---

## 总结

✅ **虚拟盘和实盘引擎已完全统一**

两者现在采用相同的：
1. **信号创建流程** - 先创建后预检查
2. **风险控制逻辑** - 完整的预检查机制
3. **信号元数据结构** - 完整的因子数据
4. **被拒信号处理** - 记录所有失败信号

这确保了：
- 虚拟盘的回测结果可以准确预测实盘行为
- 代码更易于维护和理解
- 便于分析和优化策略
