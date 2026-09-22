-- =====================================================================
-- 新表：market_regime_snapshots（pumpfun 回迁批 2.6 市场截面观察版）
--
-- WSS 引擎 60s 计时器把 FA.computeMarketSnapshot() 落表（纯观察通道）：
--   ts                = 分钟桶键（minuteKey*60000 的 ISO）→ PK，计时器抖动/重启
--                       同分钟覆写幂等，≈1440 行/天
--   source            = 实验 id（区分载体实验）
--   cohort_n          = cohort 分母（< marketMinCohort=30 时三个率列为 null）
--   fed_age_ms        = feed 起播后经过的毫秒（warmup 诊断）
--   flow_buy/sell_bnb = 10 分钟分钟环 Σ买/Σ卖（BNB；pumpfun 的 sol 列 BSC 化）
--
-- ★红线：market* 因子是观察版，任何交易策略 condition 不得引用
-- （audit-strategy-factor-keys.js 对引用报错 exitCode 3）。
-- BacktestEngine 不落表（回测不污染观察史）。
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS market_regime_snapshots (
    ts TIMESTAMPTZ NOT NULL PRIMARY KEY,
    newborn_count_1h BIGINT,
    rocket_rate_30m DOUBLE PRECISION,
    young_mean_ret_30m DOUBLE PRECISION,
    death_rate_30m DOUBLE PRECISION,
    flow_bs_ratio_10m DOUBLE PRECISION,
    cohort_n INTEGER,
    flow_buy_bnb DOUBLE PRECISION,
    flow_sell_bnb DOUBLE PRECISION,
    fed_age_ms BIGINT,
    source TEXT
);

CREATE INDEX IF NOT EXISTS idx_market_regime_snapshots_source_ts
    ON market_regime_snapshots (source, ts DESC);

ALTER TABLE market_regime_snapshots ENABLE ROW LEVEL SECURITY;

-- 服务端读写策略（对齐 pumpfun 逐字：引擎写入与 web 观察页读取都走 dbManager，
-- 其密钥优先级 SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY——anon 无策略则静默空集，
-- 同 wss_price_ticks 现状，不另开 anon 口）
DROP POLICY IF EXISTS service_all ON market_regime_snapshots;
CREATE POLICY service_all ON market_regime_snapshots
    FOR ALL TO service_role USING (true) WITH CHECK (true);
