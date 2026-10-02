-- =====================================================================
-- 策略库初始化数据 v1（2026-09-28）
--
-- 源：51ea69e7-499b-416d-b652-075ea7e6b627（7-双平台虚拟-V2策略+TPA-tokenScore2.2-0928）
-- 实跑 19 腿导出（buy 1 + sell 18），cycle 数字标注已转 groups 表达式
-- （cycle==N，与 loadStrategies normalizeGroups 单点转换同语义）。
-- 幂等：ON CONFLICT (name) DO NOTHING——重跑不覆盖手工修改。
-- ⚠️ 前置：create-strategy-library.sql 已执行（表存在）。
-- =====================================================================

-- buy-v2（1 腿）
INSERT INTO strategy_library (name, description, side, legs) VALUES (
  'buy-v2',
  'V2 买门（51ea69e7 实跑口径）：量价门 + TPA 反作弊门 tokenScore>2.2 + 叙事门评级∈{2,3}',
  'buy',
  '[{"cards":4,"priority":1,"condition":"buyVolumeBnb >= 1.5 AND age < 30 AND holders > 5 AND TPAPre_tokenScore > 2.2","description":"买腿：量价门 + TPA 反作弊门 TPAPre_tokenScore > 2.2（fail-closed）+ 叙事门 narrativeRating ∈ {2,3}；反作弊类 pre-buy 检查（同名市值/净买比/均匀簇）已移除（2026-09-28 裁定：反作弊职责移交 TPA）","maxExecutions":1,"preBuyCheckCondition":"(narrativeRating == 2 OR narrativeRating == 3)","narrativeCallCondition":"buyVolumeBnb >= 1.5 AND age < 30 AND holders > 5"}]'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- sell-hot-v1（9 腿）
INSERT INTO strategy_library (name, description, side, legs) VALUES (
  'sell-hot-v1',
  '热桶卖侧 9 腿（cycle==3，P1-P9）：硬底/针臂两档/毕业臂两档/RSI 三互斥带/大浮盈快速止盈，全部去抖旁路',
  'sell',
  '[{"cards":1,"priority":1,"condition":"graduationProgress < 0.05 AND profitPercent < 0","description":"硬底（E5c，用户裁定：不用下跌幅度止损——osbook 峰值 96.8% 被 -50% 回撤硬底卖在 -2.7%）：内盘市值跌破毕业锚 5%（≈3.6 BNB）且低于成本 → 全清防归零；建仓瞬间价格≈成本不误触；冲高回落票豁免（交给毕业臂/针臂/冻结）","maxExecutions":1,"bypassDebounce":true,"sellPercentage":1,"groups":"cycle==3"},{"cards":1,"priority":2,"condition":"riseVel5m > 8 AND risePct5m > 15 AND (rsi9Bar5mRt IS NULL OR rsi9Bar5mRt > 60) AND graduationProgress >= 0.6667","description":"针臂猛档：速度>8%/min 且 5min 涨幅>15%，RSI 门 IS NULL 宽容（warmup 期可用），市值门≥毕业 2/3（早期拉升针不卖），全清","maxExecutions":1,"bypassDebounce":true,"sellPercentage":1,"groups":"cycle==3"},{"cards":1,"priority":3,"condition":"graduationProgress >= 0.9","description":"毕业臂①：可靠价市值达 毕业锚 72 BNB 的 90%，卖半（起步 0.9 留尘价余量）","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.5,"groups":"cycle==3"},{"cards":1,"priority":4,"condition":"riseVel5m > 5 AND risePct5m > 15 AND (rsi9Bar5mRt IS NULL OR rsi9Bar5mRt > 50) AND graduationProgress >= 0.6667","description":"针臂普通档：速度>5%/min 且 5min 涨幅>15%，市值门≥毕业 2/3，卖半","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.5,"groups":"cycle==3"},{"cards":1,"priority":5,"condition":"rsi9Bar5mRt > 85 AND risePct5m >= 5","description":"RSI T85：5m RSI9 实时口径>85 且 5min 涨幅≥5，卖 40%","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.4,"groups":"cycle==3"},{"cards":1,"priority":6,"condition":"rsi9Bar5mRt > 78 AND rsi9Bar5mRt <= 85 AND risePct5m >= 5","description":"RSI T78：互斥带 (78,85]，防连续 tick 级联打光三档（冷却=RSI 降温穿带），卖 30%","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.3,"groups":"cycle==3"},{"cards":1,"priority":7,"condition":"rsi9Bar5mRt > 75 AND rsi9Bar5mRt <= 78 AND risePct5m >= 5","description":"RSI T75：互斥带 (75,78]，卖 25%","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.25,"groups":"cycle==3"},{"cards":1,"priority":8,"condition":"graduationProgress >= 0.98","description":"毕业臂②：≥0.98 再卖半（若①已触发余半仓的 50%）","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.5,"groups":"cycle==3"},{"cards":1,"priority":9,"condition":"profitPercent > 100 AND drawdownFromHighestSinceLastBuy <= -8","description":"热桶大浮盈快速止盈（v2 2026-10-02 用户裁定）：浮盈>100% 后自买后高点回撤≥8% 卖 1 卡——热桶票 8% 回撤是噪音、30% 浮盈是主升浪起点（d46b1b6c 实证 96 票卖飞 35 张再涨≥100%，top 612%），只在超大浮盈做深保护落袋；30-100% 区间交给针臂/毕业臂/周期降档后中桶腿","maxExecutions":1,"bypassDebounce":true,"sellPercentage":0.5,"groups":"cycle==3"}]'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- sell-mid-v1（5 腿）
INSERT INTO strategy_library (name, description, side, legs) VALUES (
  'sell-mid-v1',
  '中桶卖侧 5 腿（cycle==2，P10-P14）：TP1(20%)/TP2(60%)/移动止盈/保本/时间衰减，走去抖',
  'sell',
  '[{"cards":1,"priority":10,"condition":"profitPercent >= 20","cooldownSec":600,"description":"中桶TP1：浮盈≥20% 卖 1 卡（10min 冷却防连环）","maxExecutions":1,"groups":"cycle==2"},{"cards":1,"priority":11,"condition":"profitPercent >= 60","description":"中桶TP2：浮盈≥60% 再卖 1 卡","maxExecutions":1,"groups":"cycle==2"},{"cards":"all","priority":12,"condition":"peakProfitPct >= 40 AND drawdownFromHighestSinceLastBuy <= -15","description":"中桶移动止盈：峰值浮盈≥40% 后回撤≥15% 全清","maxExecutions":1,"groups":"cycle==2"},{"cards":"all","priority":13,"condition":"peakProfitPct >= 15 AND profitPercent <= 2","description":"中桶保本：峰值≥15% 回落到≤2% 全清","maxExecutions":1,"groups":"cycle==2"},{"cards":"all","priority":14,"condition":"holdDuration > 2700 AND profitPercent < 10 AND profitPercent > -8","description":"中桶时间衰减：持有>45min 横盘（-8~10%）全清","maxExecutions":1,"groups":"cycle==2"}]'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- sell-cold-v1（4 腿）
INSERT INTO strategy_library (name, description, side, legs) VALUES (
  'sell-cold-v1',
  '冷桶卖侧 4 腿（cycle==1，P15-P18）：紧移动止盈/保本/时间衰减两档，低热度票回落即走',
  'sell',
  '[{"cards":"all","priority":15,"condition":"peakProfitPct >= 15 AND drawdownFromHighestSinceLastBuy <= -10","description":"冷桶紧移动止盈：峰值≥15% 回撤≥10% 全清（低热度票回落即走）","maxExecutions":1,"groups":"cycle==1"},{"cards":"all","priority":16,"condition":"peakProfitPct >= 8 AND profitPercent <= 1","description":"冷桶保本：峰值≥8% 回落到≤1% 全清","maxExecutions":1,"groups":"cycle==1"},{"priority":17,"condition":"holdDuration > 1200 AND profitPercent < 5","description":"冷桶时间衰减①：持有>20min 浮盈<5% 卖半（比例模式，不占卡）","maxExecutions":1,"sellPercentage":0.5,"groups":"cycle==1"},{"cards":"all","priority":18,"condition":"holdDuration > 2400 AND profitPercent < 5","description":"冷桶时间衰减②：持有>40min 仍<5% 全清","maxExecutions":1,"groups":"cycle==1"}]'::jsonb
) ON CONFLICT (name) DO NOTHING;
