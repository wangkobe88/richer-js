# 状态控制移除完成

## 完成时间
2026-03-09

## 修改目标

移除代币状态对买卖行为的控制，将买卖行为控制权完全交给卡牌管理器。状态仅用于代币生命周期管理（淘汰机制）。

---

## 核心原则

### 职责分离

| 机制 | 职责 | 实现方式 |
|------|------|----------|
| **卡牌管理器** | 控制买卖行为 | BNB卡数量 → 买入能力<br>代币卡数量 → 卖出能力 |
| **状态** | 控制代币淘汰 | `sold` 状态30分钟后移除<br>`monitoring` 超时移除 |

---

## 修改内容

### 1. BacktestEngine.js

**移除买入状态检查**（第 900-905 行）
```diff
if (strategy.action === 'buy') {
- // 只排除 sold 状态（已完全卖出的代币）
- // bought 状态允许再次买入（通过卡牌机制控制，有BNB卡就能买）
- if (tokenState.status === 'sold') {
-   return;
- }
+ // 买入行为完全由卡牌管理器控制，无需状态检查
}
```

### 2. VirtualTradingEngine.js

**移除 ProcessToken 中的买入状态检查**（第 923-930 行）
```diff
if (strategy.action === 'buy') {
- // 只排除 sold 状态（已完全卖出的代币）
- // bought 状态允许再次买入（通过卡牌机制控制，有BNB卡就能买）
- if (token.status === 'sold') {
-   this.logger.debug(this._experimentId, 'ProcessToken',
-     `${token.symbol} 买入策略跳过 (状态: ${token.status}，已完全卖出)`);
-   return;
- }
+ // 买入行为完全由卡牌管理器控制，无需状态检查
}
```

**移除 _executeStrategy 中的买入状态检查**（第 1196-1201 行）
```diff
if (strategy.action === 'buy') {
- // 状态检查 - 只排除 sold 状态（已完全卖出的代币）
- // bought 状态允许再次买入（通过卡牌机制控制）
- if (token.status === 'sold') {
-   return failResult(`代币状态为 sold (已完全卖出，无法再次买入)`);
- }
-
+ // 买入行为完全由卡牌管理器控制，无需状态检查
  // 先创建并保存信号到数据库
```

### 3. LiveTradingEngine.js

**移除 ProcessToken 中的买入状态检查**（第 1307-1313 行）
```diff
if (strategy.action === 'buy') {
- // 只排除 sold 状态（已完全卖出的代币）
- // bought 状态允许再次买入（通过卡牌机制控制，有BNB卡就能买）
- if (token.status === 'sold') {
-   this.logger.debug(this._experimentId, 'ProcessToken', `${token.symbol} 买入策略跳过 (状态: ${token.status}，已完全卖出)`);
-   return;
- }
+ // 买入行为完全由卡牌管理器控制，无需状态检查
}
```

**移除 _executeStrategy 中的买入状态检查**（第 1459-1464 行）
```diff
if (strategy.action === 'buy') {
- // 状态检查 - 只排除 sold 状态（已完全卖出的代币）
- // bought 状态允许再次买入（通过卡牌机制控制）
- if (token.status === 'sold') {
-   return failResult(`代币状态为 sold (已完全卖出，无法再次买入)`);
- }
-
+ // 买入行为完全由卡牌管理器控制，无需状态检查
  // 验证 creator_address
```

### 4. token-pool.js

**无需修改** - 淘汰机制已经正确实现：
- `getMonitoringTokens()` 包含 `sold` 状态
- `getTokensToRemove()` 正确实现30分钟观察期后移除 `sold` 状态代币

---

## 修改后的行为

### 场景1：买入 → 部分卖出 → 再次买入

```
初始: BNB卡=4, 代币卡=0, 状态=monitoring
买入2卡: BNB卡=2, 代币卡=2, 状态=bought ✅
卖出1卡: BNB卡=3, 代币卡=1, 状态=bought ✅
再次买入: BNB卡=2, 代币卡=2, 状态=bought ✅
```

### 场景2：买入 → 全部卖出 → 观察期内再次买入

```
初始: BNB卡=4, 代币卡=0, 状态=monitoring
买入4卡: BNB卡=0, 代币卡=4, 状态=bought ✅
全部卖出: BNB卡=4, 代币卡=0, 状态=sold ✅
再次买入: BNB卡=3, 代币卡=1, 状态=bought ✅
         ↑ 允许买入！观察期内可交易
30分钟后: 状态=removed (从池子移除)
```

### 场景3：无BNB卡时无法买入

```
状态=sold, BNB卡=4, 代币卡=0
买入1卡 → ✅ 成功（calculateBuyAmount返回0.25）

状态=bought, BNB卡=0, 代币卡=4
买入1卡 → ❌ 失败（calculateBuyAmount返回0）
```

---

## 验证结果

```
✅ 测试总结:
1. ✅ 全部卖出后状态=sold，但仍可买入（观察期内）
2. ✅ 买入行为完全由卡牌管理器控制
3. ✅ 状态不干预买卖决策，只用于淘汰管理
4. ✅ 无BNB卡时自然无法买入，无需状态检查
```

---

## 优势

1. **单一职责**: 卡牌管理器控制买卖，状态控制生命周期
2. **支持多轮交易**: 全部卖出后观察期内仍可再次买入
3. **逻辑清晰**: 状态不干预交易决策，只表示代币所处阶段
4. **自然控制**: 无BNB卡时 `calculateBuyAmount()` 返回0，自然阻止买入
5. **配置灵活**: 通过调整卡牌配置即可控制仓位

---

## 状态定义（最终版）

| 状态 | 含义 | 买卖能力 | 淘汰条件 |
|------|------|----------|----------|
| `monitoring` | 正在监控，尚未买入 | ✅ 可买 ❌ 不可卖 | 30分钟无交易 |
| `bought` | 已买入，持有中 | ✅ 可买 ✅ 可卖 | 不淘汰 |
| `sold` | 已全部卖出，观察期 | ✅ 可买 ❌ 不可卖 | 30分钟后移除 |
| `removed` | 已从池子移除 | ❌ 不可交易 | 已移除 |

**注意**: 买卖能力由卡牌管理器决定，状态仅表示代币生命周期阶段。
