# 移除状态对买卖行为的控制

## 背景

当前实现中，代币状态（`monitoring`, `bought`, `sold`）被用于控制买卖行为。但这与卡牌管理机制的功能重复，导致逻辑混乱。

## 问题分析

### 当前实现的重复控制

1. **卡牌管理器**已经能够控制：
   - 买入：BNB卡数量 = 0 → 无法买入
   - 卖出：代币卡数量 = 0 → 无法卖出

2. **状态控制**也在做同样的事：
   - `sold` 状态 → 阻止买入
   - `monitoring` 状态 → 阻止卖出

### 问题示例

```javascript
// 当前逻辑（重复控制）
if (tokenState.status === 'sold') {
  return; // 状态阻止买入
}

const buyAmount = cardManager.calculateBuyAmount(cards);
if (buyAmount <= 0) {
  return; // 卡牌管理器也阻止买入
}
```

## 正确的架构

### 职责分离

| 机制 | 职责 | 控制方式 |
|------|------|----------|
| **卡牌管理器** | 控制买卖能力 | BNB卡数量 → 买入能力<br>代币卡数量 → 卖出能力 |
| **状态** | 控制代币生命周期 | `monitoring` → 监控中<br>`bought` → 已买入<br>`sold` → 已卖出（观察期）<br>`removed` → 已移除 |

### 状态定义（重构后）

- **`monitoring`**: 正在监控，尚未买入
- **`bought`**: 已买入，持有中
- **`sold`**: 已全部卖出，进入30分钟观察期
- **`removed`**: 已从监控池移除

状态**不控制买卖行为**，只表示代币的生命周期阶段。

## 修改方案

### 1. BacktestEngine.js

#### 移除买入状态检查

```diff
  if (strategy) {
    if (strategy.action === 'buy') {
-     // 只排除 sold 状态（已完全卖出的代币）
-     // bought 状态允许再次买入（通过卡牌机制控制，有BNB卡就能买）
-     if (tokenState.status === 'sold') {
-       return;
-     }
+     // 买入行为完全由卡牌管理器控制
+     // 无需状态检查
    } else if (strategy.action === 'sell' && tokenState.status !== 'bought') {
      return;
    }
```

#### 简化卖出状态更新

```diff
  if (result && result.success) {
    tokenState.strategyExecutions[strategy.id].count++;
    tokenState.strategyExecutions[strategy.id].lastExecution = timestamp.getTime();

-   // 检查是否全部卖出，更新状态
-   const holding = this._getHolding(tokenState.token);
-   const isAllSold = (cards === 'all') || !holding || holding.amount <= 0;
-
-   if (isAllSold) {
-     // 全部卖出，状态更新为 'sold'
-     tokenState.status = 'sold';
-     tokenState.soldAt = timestamp.getTime();
-   } else {
-     // 部分卖出，状态保持 'bought'
-   }
+   // 更新状态：全部卖出后进入观察期
+   const holding = this._getHolding(tokenState.token);
+   if (!holding || holding.amount <= 0 || cards === 'all') {
+     tokenState.status = 'sold';
+     tokenState.soldAt = timestamp.getTime();
+   }

    if (this._roundSummary) {
      this._roundSummary.recordSignalExecution(tokenState.token, true, null);
    }

    return true;
  }
```

### 2. VirtualTradingEngine.js

#### 移除买入状态检查

```diff
  if (strategy) {
    if (strategy.action === 'buy') {
-     // 只排除 sold 状态（已完全卖出的代币）
-     // bought 状态允许再次买入（通过卡牌机制控制）
-     if (token.status === 'sold') {
-       this.logger.debug(this._experimentId, 'ProcessToken',
-         `${token.symbol} 买入策略跳过 (状态: ${token.status}，已完全卖出)`);
-       return;
-     }
+     // 买入行为完全由卡牌管理器控制
    }
    if (strategy.action === 'sell' && token.status !== 'bought') {
      this.logger.debug(this._experimentId, 'ProcessToken',
        `${token.symbol} 卖出策略跳过 (状态: ${token.status})`);
      return;
    }
```

#### 移除 _executeStrategy 中的买入状态检查

```diff
  if (strategy.action === 'buy') {
-   // 状态检查 - 只排除 sold 状态（已完全卖出的代币）
-   // bought 状态允许再次买入（通过卡牌机制控制）
-   if (token.status === 'sold') {
-     return failResult(`代币状态为 sold (已完全卖出，无法再次买入)`);
-   }
-
    // 卡牌管理器检查
    if (!cardManager) {
      return failResult('卡牌管理器未初始化');
    }
```

### 3. LiveTradingEngine.js

#### 移除买入状态检查

```diff
  if (strategy.action === 'buy') {
-   // 只排除 sold 状态（已完全卖出的代币）
-   // bought 状态允许再次买入（通过卡牌机制控制，有BNB卡就能买）
-   if (token.status === 'sold') {
-     this.logger.debug(this._experimentId, 'ProcessToken',
-       `${token.symbol} 买入策略跳过 (状态: ${token.status}，已完全卖出)`);
-     return;
-   }
+   // 买入行为完全由卡牌管理器控制
  }
```

#### 移除 _executeStrategy 中的买入状态检查

```diff
  if (strategy.action === 'buy') {
-   // 状态检查
-   if (token.status === 'sold') {
-     return failResult(`代币状态为 sold (已完全卖出，无法再次买入)`);
-   }
-
    // 卡牌管理器检查
    if (!cardManager) {
      return failResult('卡牌管理器未初始化');
    }
```

### 4. token-pool.js (确保淘汰机制正确)

#### 确保 sold 状态的代币仍然被监控

```javascript
getMonitoringTokens() {
  return this.getAllTokens().filter(t =>
    t.status === 'monitoring' ||
    t.status === 'bought' ||
    t.status === 'sold' ||  // ✅ 继续监控 sold 状态
    t.status === 'bad_holder' ||
    t.status === 'negative_dev'
  );
}
```

#### 确保 sold 状态30分钟后移除

```javascript
getTokensToRemove() {
  const now = Date.now();
  const POST_SALE_OBSERVATION_TIME = 30 * 60 * 1000; // 30分钟

  return this.getAllTokens().filter(token => {
    // ... 其他移除条件 ...

    // 全部卖出后30分钟移除
    if (token.status === 'sold') {
      if (token.soldAt && (now - token.soldAt) >= POST_SALE_OBSERVATION_TIME) {
        return true;
      }
    }
  });
}
```

## 修改后的行为

### 场景1：买入 → 部分卖出 → 再次买入

```
初始: BNB卡=4, 代币卡=0, 状态=monitoring
买入1卡: BNB卡=3, 代币卡=1, 状态=bought ✅
卖出1卡: BNB卡=4, 代币卡=0, 状态=bought ✅
再次买入: BNB卡=3, 代币卡=1, 状态=bought ✅
```

### 场景2：买入 → 全部卖出 → 尝试买入

```
初始: BNB卡=4, 代币卡=0, 状态=monitoring
买入4卡: BNB卡=0, 代币卡=4, 状态=bought ✅
全部卖出: BNB卡=4, 代币卡=0, 状态=sold ✅
尝试买入: BNB卡=3, 代币卡=1, 状态=sold ✅
         ↑ 允许买入！卡牌管理器控制
30分钟后: 状态=removed (从池子移除)
```

### 场景3：无BNB卡时无法买入

```
状态=sold, BNB卡=4, 代币卡=0
买入1卡 → ✅ 成功（BNB卡充足）

状态=sold, BNB卡=0, 代币卡=4
买入1卡 → ❌ 失败（无BNB卡）
```

## 优势

1. **单一职责**: 卡牌管理器控制买卖，状态控制生命周期
2. **支持多轮交易**: 全部卖出后仍可再次买入（观察期内）
3. **逻辑清晰**: 状态不干预交易决策，只表示代币所处阶段
4. **灵活性高**: 通过调整卡牌配置即可控制仓位，无需修改状态逻辑

## 注意事项

1. **虚拟盘的 token.markAsSold()** 需要保留，因为它触发30分钟观察期
2. **卖出后的状态更新** 需要保留，用于淘汰机制
3. **卡牌管理器的自然控制** 是主要的买卖行为控制
