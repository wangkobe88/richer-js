# 实盘交易引擎修改方案

## 问题概述

虚拟交易引擎（VirtualTradingEngine）和实盘交易引擎（LiveTradingEngine）在风险控制方面存在严重不一致：

### 关键差异

| 组件 | 虚拟盘 | 实盘 | 严重程度 |
|------|--------|------|----------|
| **PriceHistoryCache** | ✅ 有 | ❌ 无 | 高 |
| **TrendDetector** | ✅ 有 | ❌ 无 | 高 |
| **TokenHolderService** | ✅ 有 | ❌ 无 | 高 |
| **PreBuyCheckService** | ✅ 有 | ❌ 无 | **严重** |
| **预检查执行** | ✅ 完整 | ❌ 无 | **严重** |

### 影响

实盘引擎**完全没有风险控制机制**，可能：
- 购买到 pump-and-dump 代币
- 购买 Dev 持仓过多的代币
- 购买早期交易异常的代币
- 缺少趋势分析和异常检测

---

## 修改方案

### 第一步：修改 _initializeLiveComponents 方法

在 `LiveTradingEngine.js` 的 `_initializeLiveComponents()` 方法中添加风险控制组件：

```javascript
async _initializeLiveComponents() {
  // ... 现有代码 ...

  // ========== 新增：风险控制组件 ==========

  // 1. 初始化价格历史缓存（用于趋势检测）
  const PriceHistoryCache = require('../PriceHistoryCache');
  this._priceHistoryCache = new PriceHistoryCache(15 * 60 * 1000); // 15分钟
  this.logger.info('LiveTradingEngine', 'Initialize', '价格历史缓存初始化完成');
  console.log(`✅ 价格历史缓存初始化完成`);

  // 2. 初始化趋势检测器
  const TrendDetector = require('../TrendDetector');
  this._trendDetector = new TrendDetector({
    minDataPoints: 6,
    maxDataPoints: Infinity,
    cvThreshold: 0.005,
    scoreThreshold: 30,
    totalReturnThreshold: 5,
    riseRatioThreshold: 0.5
  });
  this.logger.info('LiveTradingEngine', 'Initialize', '趋势检测器初始化完成');
  console.log(`✅ 趋势检测器初始化完成`);

  // 3. 初始化持有者服务
  const { TokenHolderService } = require('../holders/TokenHolderService');
  const { dbManager } = require('../../services/dbManager');
  const supabase = dbManager.getClient();
  this._tokenHolderService = new TokenHolderService(supabase, this.logger);
  this.logger.info('LiveTradingEngine', 'Initialize', '持有者服务初始化完成');
  console.log(`✅ 持有者服务初始化完成`);

  // 4. 初始化购买前检查服务
  const { PreBuyCheckService } = require('../pre-check/PreBuyCheckService');

  // 合并配置：外部默认配置 + 实验配置
  const defaultConfig = require('../../../config/default.json');
  const experimentPreBuyConfig = this._experiment?.config?.preBuyCheck || {};
  const preBuyCheckConfig = {
    ...defaultConfig.preBuyCheck,
    ...experimentPreBuyConfig
  };

  this._preBuyCheckService = new PreBuyCheckService(supabase, this.logger, preBuyCheckConfig);
  this.logger.info('LiveTradingEngine', 'Initialize', `购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);
  console.log(`✅ 购买前检查服务初始化完成 (earlyParticipantFilterEnabled=${preBuyCheckConfig.earlyParticipantFilterEnabled})`);

  // ========== 修改 TokenPool 初始化，传入价格历史缓存 ==========
  // 注释掉原来的简单初始化
  // this._tokenPool = new TokenPool(this.logger);
  // 改为带缓存的版本
  this._tokenPool = new TokenPool(this.logger, this._priceHistoryCache);
  await this._tokenPool.initialize();

  // ... 其余代码 ...
}
```

### 第二步：修改 _executeStrategy 方法

在 `LiveTradingEngine.js` 的 `_executeStrategy()` 方法中添加预检查逻辑。在买入策略的 Dev 钱包检查后，添加：

```javascript
async _executeStrategy(strategy, token, factorResults = null) {
  // ... 现有代码 ...

  if (strategy.action === 'buy') {
    if (token.status !== 'monitoring') {
      return failResult(`代币状态不是 monitoring (当前: ${token.status})`);
    }

    // ========== Dev 钱包检查（现有代码保留）==========
    // ... 现有的 Dev 钱包检查代码 ...

    // ========== 新增：综合购买前检查 ==========
    let preCheckPassed = true;
    let blockReason = null;
    let preBuyCheckResult = null;

    if (this._preBuyCheckService) {
      try {
        this.logger.info(this._experimentId, '_executeStrategy',
          `开始购买前检查 | symbol=${token.symbol}, creator=${token.creator_address || 'none'}`);

        // 构建代币信息（用于早期参与者检查）
        const tokenInfo = this._buildTokenInfo(token);

        // 只使用策略级别的预检查条件
        const preBuyCheckCondition = strategy.preBuyCheckCondition || null;

        preBuyCheckResult = await this._preBuyCheckService.performAllChecks(
          token.token,
          token.creator_address || null,
          this._experimentId,
          token.chain || 'bsc',
          tokenInfo,
          preBuyCheckCondition
        );

        if (!preBuyCheckResult.canBuy) {
          this.logger.warn(this._experimentId, '_executeStrategy',
            `购买前检查失败 | symbol=${token.symbol}, holderCanBuy=${preBuyCheckResult.holderCanBuy}, preTraderCanBuy=${preBuyCheckResult.preTraderCanBuy}, ` +
            `reason=${preBuyCheckResult.checkReason}, ` +
            `whitelist=${preBuyCheckResult.holderWhitelistCount}, blacklist=${preBuyCheckResult.holderBlacklistCount}, ` +
            `devHoldingRatio=${(isNaN(preBuyCheckResult.devHoldingRatio) ? 'N/A' : preBuyCheckResult.devHoldingRatio.toFixed(1))}%, maxHoldingRatio=${(isNaN(preBuyCheckResult.maxHoldingRatio) ? 'N/A' : preBuyCheckResult.maxHoldingRatio.toFixed(1))}%`);
          preCheckPassed = false;
          blockReason = preBuyCheckResult.checkReason || 'pre_buy_check_failed';
        } else {
          this.logger.info(this._experimentId, '_executeStrategy',
            `购买前检查通过 | symbol=${token.symbol}, holderCanBuy=${preBuyCheckResult.holderCanBuy}, preTraderCanBuy=${preBuyCheckResult.preTraderCanBuy}, ` +
            `reason=${preBuyCheckResult.checkReason}`);
        }
      } catch (checkError) {
        const errorMsg = checkError?.message || String(checkError);
        this.logger.error(this._experimentId, '_executeStrategy',
          `购买前检查异常: ${token.symbol} - ${errorMsg}`);
        // 检查失败时拒绝购买，保守处理
        preCheckPassed = false;
        blockReason = `购买前检查异常: ${errorMsg}`;
      }
    }

    // 如果预检查失败，返回失败
    if (!preCheckPassed) {
      this.logger.warn(this._experimentId, '_executeStrategy',
        `预检查失败 | symbol=${token.symbol}, reason=${blockReason}`);

      // 记录到 RoundSummary
      if (this._roundSummary) {
        this._roundSummary.recordSignal(token.token, {
          direction: 'BUY',
          action: 'buy',
          confidence: 0,
          reason: `预检查失败: ${blockReason}`
        });
        this._roundSummary.recordSignalExecution(token.token, false, `预检查失败: ${blockReason}`);
      }

      return failResult(`预检查失败: ${blockReason}`);
    }

    // ========== 预检查通过，继续购买流程 ==========

    // ... 现有的信号创建和执行代码 ...
  }
  // ... 卖出逻辑不变 ...
}
```

### 第三步：添加辅助方法

在 `LiveTradingEngine.js` 中添加以下辅助方法（从 VirtualTradingEngine 复制）：

```javascript
/**
 * 构建代币信息（用于早期参与者检查）
 * @private
 * @param {Object} token - 代币数据
 * @returns {Object} 代币信息
 */
_buildTokenInfo(token) {
  return {
    tokenAddress: token.token,
    symbol: token.symbol,
    chain: token.chain || 'bsc',
    createdAt: token.createdAt,
    collectionTime: token.collectionTime || token.addedAt || Date.now(),
    currentPrice: token.currentPrice || 0,
    launchPrice: token.launchPrice || token.collectionPrice || token.currentPrice || 0
  };
}

/**
 * 更新信号元数据
 * @private
 * @param {string} signalId - 信号ID
 * @param {Object} metadata - 元数据
 * @returns {Promise<void>}
 */
async _updateSignalMetadata(signalId, metadata) {
  if (!signalId || !metadata) {
    return;
  }

  try {
    await this.dataService.updateSignalMetadata(signalId, metadata);
  } catch (error) {
    this.logger.error(this._experimentId, '_updateSignalMetadata',
      `更新信号元数据失败 | signalId=${signalId}, error=${error.message}`);
  }
}

/**
 * 更新信号状态
 * @private
 * @param {string} signalId - 信号ID
 * @param {string} status - 状态
 * @param {Object} result - 结果对象
 * @returns {Promise<void>}
 */
async _updateSignalStatus(signalId, status, result = {}) {
  if (!signalId) {
    return;
  }

  try {
    await this.dataService.updateSignalStatus(signalId, status, {
      executed: status === 'executed',
      execution_status: status,
      execution_reason: result.reason || result.message || null,
      executed_at: new Date().toISOString()
    });
  } catch (error) {
    this.logger.error(this._experimentId, '_updateSignalStatus',
      `更新信号状态失败 | signalId=${signalId}, error=${error.message}`);
  }
}
```

### 第四步：修改信号元数据结构

确保实盘信号包含完整的因子数据。在 `_executeStrategy` 的买入部分，修改信号构建：

```javascript
const signal = {
  action: 'buy',
  symbol: token.symbol,
  tokenAddress: token.token,
  chain: token.chain,
  price: latestPrice,
  confidence: 80,
  reason: strategy.name,
  cards: strategy.cards || 1,
  strategyId: strategy.id,
  strategyName: strategy.name,
  cardConfig: positionManagement?.enabled ? {
    totalCards: positionManagement.totalCards || 4,
    perCardMaxBNB: positionManagement.perCardMaxBNB || 0.25
  } : null,
  factors: factorResults ? {
    // 使用 FactorBuilder 构建完整的因子数据
    trendFactors: this._buildTrendFactors(factorResults),
    preBuyCheckFactors: preBuyCheckResult ? this._buildPreBuyCheckFactors(preBuyCheckResult) : null
  } : null
};
```

### 第五步：添加因子构建方法

```javascript
/**
 * 构建趋势因子
 * @private
 * @param {Object} factorResults - 因子计算结果
 * @returns {Object} 趋势因子
 */
_buildTrendFactors(factorResults) {
  const { buildFactorValuesForTimeSeries } = require('../core/FactorBuilder');
  return {
    ...buildFactorValuesForTimeSeries(factorResults),
    // 添加趋势检测相关因子
    trendDataPoints: factorResults.trendDataPoints,
    trendCV: factorResults.trendCV,
    trendPriceUp: factorResults.trendPriceUp,
    trendMedianUp: factorResults.trendMedianUp,
    trendSlope: factorResults.trendSlope,
    trendStrengthScore: factorResults.trendStrengthScore,
    trendTotalReturn: factorResults.trendTotalReturn,
    trendRiseRatio: factorResults.trendRiseRatio,
    trendRecentDownCount: factorResults.trendRecentDownCount,
    trendRecentDownRatio: factorResults.trendRecentDownRatio,
    trendConsecutiveDowns: factorResults.trendConsecutiveDowns
  };
}

/**
 * 构建购买前检查因子
 * @private
 * @param {Object} preBuyCheckResult - 预检查结果
 * @returns {Object} 预检查因子
 */
_buildPreBuyCheckFactors(preBuyCheckResult) {
  const { buildPreBuyCheckFactorValues } = require('../core/FactorBuilder');
  return buildPreBuyCheckFactorValues(preBuyCheckResult);
}
```

---

## 修改优先级

| 优先级 | 修改项 | 严重程度 | 风险 |
|--------|--------|----------|------|
| **P0** | 添加 PreBuyCheckService | 严重 | 高 - 直接影响资金安全 |
| **P0** | 修改 _executeStrategy | 严重 | 高 - 直接影响交易决策 |
| **P1** | 添加 TokenHolderService | 高 | 中 - 影响持有者风险检测 |
| **P1** | 添加 TrendDetector | 高 | 中 - 影响趋势分析 |
| **P1** | 添加 PriceHistoryCache | 高 | 低 - 基础设施 |
| **P2** | 统一信号元数据 | 中 | 低 - 影响数据分析 |

---

## 测试建议

### 1. 单元测试
- 测试 PreBuyCheckService 各个检查项
- 测试 TrendDetector 趋势检测
- 测试因子构建方法

### 2. 集成测试
- 创建测试实验，使用小额资金
- 验证预检查是否正确工作
- 对比虚拟盘和实盘的信号

### 3. A/B 测试
- 先在虚拟盘运行新版本
- 对比新旧版本的差异
- 确认无问题后再上实盘

### 4. 监控指标
- 预检查通过率
- 各类检查项的失败率
- 信号质量变化
- 交易成功率

---

## 回滚计划

如果实盘运行出现问题，需要立即回滚：

1. 停止实盘引擎
2. 回滚到修改前的版本
3. 分析问题原因
4. 修复后重新测试

---

## 注意事项

1. **实盘测试前务必在虚拟盘充分测试**
2. **从小额资金开始，逐步增加**
3. **密切监控前几天的交易**
4. **保留完整的日志用于分析**
5. **设置异常告警机制**
