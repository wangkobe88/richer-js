-- =====================================================================
-- 新表：token_profiles（pumpfun 回迁批 3.1 代币分类画像）
--
-- OnlineProfileBuilder（source='online'）写入；离线批量重写/校准管线后续批次接入。
-- token 级全局表（token_address 主键）——★故意不挂 experiment 维度：
--   1. 防 experiment ON DELETE CASCADE 级联删（分类画像是市场级资产，非实验数据）
--   2. 防前视生命周期独立管理（category_visible_at 单列，晚于决策点的分类读不到）
--
-- 列说明：
--   category             wash / high_mcap_wash / pump_dump / quality / high_mcap /
--                        normal / low_quality / low_activity
--   source               'online'（OPB 实时）| 'offline'（后续离线管线）
--   classifier_version   'bsc-v1'（token-classifier.js CLASSIFIER_VERSION）
--   classified_at        本次分类时刻
--   category_visible_at  分类信息可见时刻（在线=写入时刻；离线 daily=firstIdle 口径，
--                        重写保最早——防前视消费口径，见 token-classifier.computeFirstIdleVisibleAt）
--   peak_mcap_usd        峰值市值（= profile.max_market_cap_usd 冗余列，供索引/分位校准）
--   max_change_percent   最高涨幅 %（(可用价峰-基准)/基准*100，BNB 计价，base=首个可用价
--                        tick；NULL=无可用价 tick。bsc-v2 起携带，冗余列供批量过滤，
--                        见 2026-09-24-token-profiles-add-change-percent.sql）
--   final_change_percent 最终涨幅 %（(可用价末-基准)/基准*100，同上口径）
--   profile              完整 JSONB（class_info/config_snapshot/flash_crash_period/
--                        violent_crash_blocks/first_tick_time/last_tick_time/reason/conflict）
--   conflict             离线重写与已有分类不一致时的冲突记录（pending_review；
--                        online 覆盖 online 不记冲突——母版同口径）
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS token_profiles (
    token_address TEXT NOT NULL PRIMARY KEY,
    category TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'online',
    classifier_version TEXT NOT NULL,
    classified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    category_visible_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    peak_mcap_usd DOUBLE PRECISION,
    max_change_percent DOUBLE PRECISION,
    final_change_percent DOUBLE PRECISION,
    profile JSONB NOT NULL,
    conflict JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 分类筛选（挖掘脚本按类别取票；低选择性但小表，普通索引足够）
CREATE INDEX IF NOT EXISTS idx_token_profiles_category
    ON token_profiles (category);

-- 写时刷 updated_at（upsert 覆写行时维护）
DROP TRIGGER IF EXISTS trg_token_profiles_updated_at ON token_profiles;
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_token_profiles_updated_at
    BEFORE UPDATE ON token_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 服务端读写策略（对齐 market_regime_snapshots / wss_price_ticks 现状：引擎写入与
-- web 观察读取都走 dbManager，密钥 SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY——
-- anon 无策略则静默空集，不另开 anon 口）
ALTER TABLE token_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON token_profiles;
CREATE POLICY service_all ON token_profiles
    FOR ALL TO service_role USING (true) WITH CHECK (true);
