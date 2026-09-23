# 回测迭代记录（源实验 572033ad，flap 平台 79k ticks，2026-09-23）

每轮：策略 JSON 在 strategies/，实验跑在 182（`node main.js start-experiment -e <id> -f`），
分析 `node scripts/backtest-loop/analyze-backtest.cjs --experiment <id>`。
ΣPnL 均为含费口径（每腿 0.5%，与余额账对账一致）。

## 轮 0 基线（bc15aa2c）
- 策略：`tradeCount >= 3` 买 / `>15 OR <-15` 卖
- 结果：100 → 98.0516（**-1.95%**）| 1135 轮 | 胜率 28.3% | 36 轮 ≤-20% 贡献全部亏损
- 发现：差票买点 firstBlockBuyShare P50=1（同块脉冲）、bigHolderPresent P50=1；P50 持仓 9h（±15 不触发捏到强平）

## 轮 1 买侧双门（2a5a3583）
- 策略：买 `tradeCount >= 3 AND firstBlockBuyShare < 0.85 AND bigHolderPresent == 0`，卖不动
- 结果：100 → 99.8751（**-0.12%**）| 470 轮 | 胜率 31.7%（含费）| ΣPnL -0.1053 | 差票 36→7
- 出场结构：强平 n=349 Σ-0.70（峰值 P50=0%，死票阴 bleed）vs ±15 腿 n=121 Σ+0.59
- 卖点反事实（tick 级模拟，锚=买 trade unit_price）：bailM/trail(P,D) 及组合**全部跑不赢 ±15 基线**（卖飞后续 +15 抵消捕获）→ 卖侧叠加腿搁置

## 轮 2 买侧追高过滤（f17b5459）❌ 回退
- 策略：轮 1 + `earlyReturn < 20`
- 结果：ΣPnL **-0.2872**（比轮 1 差 -0.18）| 465 轮 | 强平 362 Σ-0.76 | 策略腿 103 Σ+0.47
- 失败归因：尾部差票样本（n=7）设计的门=小样本过拟合——earlyReturn 16~20 区间藏 18 笔赢家；
  门删 5 笔买入但买入延迟位移使 13 笔从止盈变强平
- 教训：门槛设计必须用死票/活票全量分布 + 单门预筛 Σ，回放只验证粗筛为正的候选
