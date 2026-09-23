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

## 轮 3 稳定+动量地板（b8f4c466）
- 策略：买 `tradeCount>=3 AND firstBlockBuyShare<0.85 AND bigHolderPresent==0 AND maxBlockDropPct<3 AND earlyReturn>1`，卖不动
- 结果：100 → 100.1244（**+0.12%**）| 82 轮 | 胜率 41.5% | ΣPnL +0.1244
- 发现：死票画像=flat 无量（earlyReturn/riseSpeed P50≈0、txVol 23 vs 368、holders 1 vs 3）
  ——上限门方向反了，死票要的是**地板**（动量/量/holder 下限），不是上限

## 轮 4 对倒过滤+水下止损（1db56d05）✅ 当前最优
- 策略：轮 3 买门 + `counterpartyOverlapRate < 0.35`；卖加腿 2 `holdDuration > 300 AND profitPercent < 0`
- 结果：100 → 100.2215（**+0.22%**）| 58 轮 | 胜率 44.8% | ΣPnL +0.2215 | 死票池 29→2 | 强平 3
- 反事实自校验：模拟基线 0.1998 vs 实际 0.2215（残差 -0.02，可信）

## 轮 5 收敛检验（不新增策略）
- **阈值网格（反事实）**：bail4 +0.001 / bail5 -0.005 / bail3 -0.005 / bail2 -0.03 / take12 -0.07 /
  take18/20 -0.005 / stop8/10/12 全负 / trail 全负 —— **全部在噪声内或更差**
  （58 轮上 ±0.005=噪声；按轮 2 教训不追）→ 卖侧收敛于 ±15 + bail5min
- **半窗稳健性（05f57be5 / bb44799d）**：窗口 09-20 12:04 → 09-21 03:02 UTC，中点 19:33 切分，
  同轮 4 策略各自回放：前半 +0.2195（44 轮/胜率 50%）、后半 +0.0859（26 轮/胜率 42.3%）
  ——**两半独立为正**，非单段行情；收益前重后轻但方向一致，配置稳健性通过

## 总结
- 基线 -1.95%（1135 轮）→ 轮 4 **+0.22%**（58 轮）；胜率 28.3%→44.8%；死票池 349→2
- 有效买门：firstBlockBuyShare<0.85（杀同块脉冲）+ bigHolderPresent==0 + maxBlockDropPct<3 +
  earlyReturn>1（动量地板）+ counterpartyOverlapRate<0.35（杀对倒）——全部死/活票全量分布设计
- 有效卖腿：±15 止盈止损 + 水下 5min 时间止损；trail/bail 微调均无增益
- **注意事项**：单数据集 in-sample（flap 平台一个 15h 窗口）；58 轮终样本小；强平按 FA 冻价
  （死票实际归零，live 现实更差）；预筛 Δ 是乐观上界（买入延迟位移），回放才是真值

