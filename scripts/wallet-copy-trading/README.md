# 钱包跟单分析 - CCCCQCrL6z

分析 Solana Pumpfun 高收益钱包 `CCCCQCrL6zVjnDeucDzcxJgxAs5ahNmrhw1CDexPhqrd` 的交易行为，设计跟单实验方案。

## 文件说明

| 文件 | 用途 |
|------|------|
| `config.js` | 共享配置：GMGN API、Supabase、钱包地址 |
| `01-fetch-wallet-trades.js` | 获取钱包近24h交易记录，构建交易对，保存到 `data/wallet-trades.json` |
| `02-compare-with-experiment.js` | 与运行中实验对比（信号、预检查、时序数据），保存到 `data/comparison-report.json` |
| `03-trade-pattern-summary.js` | 汇总分析，生成可读报告 `data/analysis-summary.md` |
| `04-create-copy-experiments.js` | 创建3个回测实验（方案A/B/C），不同预检查条件 |
| `data/` | 分析数据输出目录 |

## 运行顺序

```bash
node scripts/wallet-copy-trading/01-fetch-wallet-trades.js
node scripts/wallet-copy-trading/02-compare-with-experiment.js
node scripts/wallet-copy-trading/03-trade-pattern-summary.js
# 04 等回测引擎改进完成后运行
node scripts/wallet-copy-trading/04-create-copy-experiments.js
```

## 钱包画像

- **地址**: `CCCCQCrL6zVjnDeucDzcxJgxAs5ahNmrhw1CDexPhqrd`
- **日均交易**: ~168 笔
- **单笔金额**: 固定 ~$129 (CV=0.15)
- **持仓中位数**: 41 秒
- **胜率**: 45%
- **盈亏比**: 2.17
- **止盈**: 无固定阈值，ROI 从 3.5% 到 1251.8%，用回撤触发卖出
- **止损**: 中位数 -12%，33秒内割肉

## 分析结论

### 系统覆盖率

| 层级 | 数量 | 占比 |
|------|------|------|
| 进入监控池 | 66/72 | 91.7% |
| 触发买入信号 | 58/72 | 80.6% |
| **通过预检查** | **7/72** | **9.7%** |
| 实际执行买入 | 1/72 | 1.4% |

**核心瓶颈是预检查拒绝了 70.8% 的信号（51/72）**，不是监控覆盖率问题。

### 预检查失败原因

| 因子 | 中位数 | 当前阈值 | 差距 |
|------|--------|----------|------|
| earlyTraderBlacklistCount | 31 | ≤ 4 | 差 8 倍 |
| earlyTradesCountPerMin | 332 | < 100 | 差 3 倍 |
| earlyTradesDrawdownFromHighest | -6.15% | > -5% | 差 1.2 倍 |

### 三个回测方案

#### 方案 A：保守调整
- `earlyTradesTotalCount >= 10 AND earlyTradesCountPerMin < 500 AND earlyTradesDrawdownFromHighest > -15`
- 去掉黑名单限制，放宽交易速率和跌幅

#### 方案 B：激进调整
- `earlyTradesTotalCount >= 5 AND earlyTradesDrawdownFromHighest > -30`
- 只保留最小流动性和极端跌幅保护

#### 方案 C：只保留防骗
- `creatorIsNotBadDevWallet === 1`
- 只排除 bad dev 钱包创建的代币

### 卖出策略

基于源实验的**回撤止盈** + 新增**快速止损**：

| 优先级 | 条件 | 说明 |
|--------|------|------|
| P1 | profitPercent ≤ -12 AND holdDuration 15-60s | 快速止损（匹配钱包33秒割肉） |
| P2 | holder回撤 ≤ -15% 或 价格回撤 ≤ -30%, 持仓 < 180s | 回撤止盈，让利润奔跑 |
| P3 | holder回撤 ≤ -12% 或 价格回撤 ≤ -25%, 持仓 180-300s | 中期保护 |
| P4 | holder回撤 ≤ -10% 或 价格回撤 ≤ -20%, 持仓 ≥ 300s | 后期保护 |
| P5 | trendCV < 0.005 | 趋势死亡 |

## 已创建实验

| 方案 | 实验ID | 名称 |
|------|--------|------|
| A | `f26617c1-4761-4670-89d8-108bbc119760` | 钱包跟单-A保守 |
| B | `ced55aa9-5142-4af2-8e64-bc638d3beda8` | 钱包跟单-B激进 |
| C | `7be0c1b2-39d8-47c3-9e3f-a7347cbe389b` | 钱包跟单-C防骗 |

源实验: `609c9d93-c37f-4bd8-90e4-c300971f4711`（虚拟-90秒窗口测试）
