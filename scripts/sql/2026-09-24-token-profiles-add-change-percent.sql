-- =====================================================================
-- token_profiles 增列：max_change_percent / final_change_percent（2026-09-24）
--
-- 页面「涨幅分析」（TokenAnalysisService + experiment_time_series_data 30s 快照 →
-- experiment_tokens.analysis_results）退役，涨幅指标融合进离线分类管线
-- （build-token-profiles.cjs / OnlineProfileBuilder 顺带产出）。
--
-- 口径（token-classifier.js computeTickMetrics，BNB 计价与比率族原则一致）：
--   base  = 首个可用价 tick 的 priceBnb（可用价 = priceReliable && bnb>=0.002 && px>0）
--   max_change_percent   = (可用价峰 - base) / base * 100   （恒 >= 0）
--   final_change_percent = (可用价末 - base) / base * 100   （可为负）
--   无可用价 tick（尘票/全离群/无 tick）→ NULL
--
-- 冗余列而非仅 profile JSONB：时序压缩要按涨幅批量过滤（PostgREST 不支持
-- JSONB 路径过滤）；peak_mcap_usd 同款先例。字段名沿用旧 analysis_results 键名。
-- classifier_version 'bsc-v2' 起携带本列（v1 分类判定不变，仅增涨幅）。
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

ALTER TABLE token_profiles ADD COLUMN IF NOT EXISTS max_change_percent DOUBLE PRECISION;
ALTER TABLE token_profiles ADD COLUMN IF NOT EXISTS final_change_percent DOUBLE PRECISION;

COMMENT ON COLUMN token_profiles.max_change_percent IS
    '(可用价峰-基准)/基准*100，BNB 计价，base=首个可用价 tick；NULL=无可用价 tick。bsc-v2 起';
COMMENT ON COLUMN token_profiles.final_change_percent IS
    '(可用价末-基准)/基准*100，BNB 计价，base=首个可用价 tick；NULL=无可用价 tick。bsc-v2 起';
