-- =====================================================================
-- 新表：wallet_offline_profiles（pumpfun 回迁批 4 TPA 离线底座）
--
-- 高频钱包（tick >= threshold，默认 3）全历史预计算 profile。
-- build-wallet-profiles.cjs（step4）两阶段聚合写入；实时 TokenPositionAnalyzer
-- 命中此表则用（fresh）或增量合并（stale），未命中（小钱包）走实时全量。
--
-- 设计原则（母版对齐，用户 2026-08-04 指令）：只留查询/索引/派生切换必需的
-- 核心列，所有统计量塞进单个 profile JSONB。增删统计字段只改
-- src/services/wallet-profile-builder.js 的 buildProfileFromTicks /
-- mergeOfflineProfile，不动本 DDL。
--
-- ⚠️ isSniper 不落表（母版用户指令：所有钱包统一处理，不做 sniper 特殊处理）：
--   无 is_sniper 列、profile JSONB 无 isSniper 键。使用点从
--   profile.tokenCount >= 200（HIGH_FREQ_THRESHOLD）现算
--   （见 scripts/shared/wallet-category.js）。
--
-- profile JSONB 内容（buildProfileFromTicks 产出，camelCase；BNB 浮点口径）：
--   基础统计(BNB): totalBnb, tickCount, tokenCount(=rawTotal), buyCount, sellCount,
--       largeTradeCount, avgBnb
--   持仓时间: avgHoldSeconds, medianHoldSeconds, firstSeenMs
--   bad_action(全历史累积, 靶向率口径): badBuyCount, badSellCount,
--       earlyLargeBuyCount(分母), crashLargeSellCount(分母),
--       badCount14d(参考), badBuyRatio, badSellRatio, badRatio,
--       badAction(24h 布尔, 离线恒 false)
--   金额分桶(0.0004/0.02/0.2/0.8 BNB): buckets{total,dust,tiny,small,medium,big},
--       dustRatio, lowRatio, lowTinyRatio
--   ★无 perToken（落表体积过大已移除）：mergeOfflineProfile 标量累加核心维度 +
--     buckets/持仓用 offline 全历史值
--
-- 跨平台全局：无 platform 列——钱包质量是地址属性，four.meme/flap 共用
-- （step4 构建与 TPA 实时查询均不带 platform 过滤，三路径与离线表严格同构）。
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS wallet_offline_profiles (
  address TEXT PRIMARY KEY,
  data_through TIMESTAMPTZ NOT NULL,              -- 增量合并判据（asOf vs data_through）：该钱包 ticks 的 max(block_time)
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- 计算时间（新鲜度判断）
  profile JSONB NOT NULL,                          -- buildProfileFromTicks 完整输出（camelCase）
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- fresh/stale 路径切换的批量预载排序键
CREATE INDEX IF NOT EXISTS idx_wop_data_through ON wallet_offline_profiles(data_through);

-- 写时刷 updated_at（upsert 覆写行时维护，对齐 token_profiles）
DROP TRIGGER IF EXISTS trg_wop_updated_at ON wallet_offline_profiles;
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_wop_updated_at
    BEFORE UPDATE ON wallet_offline_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 服务端读写策略（对齐 token_profiles / wss_price_ticks 现状：引擎写入与
-- web 观察读取都走 dbManager，密钥 SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY——
-- anon 无策略则静默空集，不另开 anon 口）
ALTER TABLE wallet_offline_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON wallet_offline_profiles;
CREATE POLICY service_all ON wallet_offline_profiles
    FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE wallet_offline_profiles IS '高频钱包(tick>=threshold)全历史预计算 profile（BNB 口径，跨平台全局）；实时 TPA 查此表命中则用/增量合并，未命中(小钱包)走实时全量。isSniper 不落表，使用点从 profile->>tokenCount 现算。';
