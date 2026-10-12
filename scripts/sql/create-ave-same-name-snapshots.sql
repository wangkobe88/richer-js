-- =====================================================================
-- 新表：ave_same_name_snapshots（AVE 同名检查 as-of 历史快照）
--
-- 2026-10-12 用户裁定（SI 0xbc97c27f 对拍事故）：SameNameTokenService 数据源
-- 是 AVE API 实时搜索——「当前快照」无 as-of 语义，回测两次运行间 AVE 索引漂移
-- 会翻转 preBuy 决策（v0 wall 00:58 同名簇≥3 放行 vs 旧 perf 臂 wall 07:04 簇 2
-- 拦下，同虚拟时刻）。三条裁定：
--   1. 虚拟/实盘引擎实时调 AVE 成功后把结果保存下来（append 写本表）；
--   2. 回测以本表 searched_at <= asOf 最近快照为主数据源，实时调用仅作兜底；
--   3. 兜底实时调用的行必须过滤到被检测代币发布之前（service 侧行级过滤）。
--
-- 表级全局资产（★故意不挂 experiment FK）：删实验不级联——快照是全市场级
-- as-of 数据，供未来任意回测使用；source_experiment_id 仅 provenance。
-- external_resource_cache 不可复用：upsert 语义丢历史，as-of 查询需要保留
-- 每次真实搜索的时序行。
--
-- 行量控制：写入端进程内 6h 节流（同 chain+search_term）；results 每行裁剪
-- 7 字段（token/name/symbol/fdv/tvl/tx_volume_u_24h/created_at），典型
-- 300 行搜索 ~36KB jsonb（TOAST 压缩后 ~6KB）。
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS ave_same_name_snapshots (
    id BIGSERIAL PRIMARY KEY,
    chain TEXT NOT NULL,
    search_term TEXT NOT NULL,          -- 归一化 symbol（SameNameTokenService._normalizeName 同口径）
    searched_at TIMESTAMPTZ NOT NULL,   -- 实时实验墙钟（as-of 数据新鲜度锚）
    row_count INT NOT NULL,             -- 原始搜索结果行数（strictSameNameSearchCount 因子保真）
    results JSONB NOT NULL,             -- 裁剪行数组（7 字段/行，见上）
    source_experiment_id UUID,          -- provenance；刻意无 FK（删实验不级联）
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 回测装载查询：(chain, search_term) 桶内取 searched_at <= asOf 最近一条
CREATE INDEX IF NOT EXISTS idx_ave_sn_chain_term_ts
    ON ave_same_name_snapshots (chain, search_term, searched_at DESC);

-- 服务端读写策略（对齐 token_profiles / wss_price_ticks 现状：引擎写入与回测
-- 装载都走 dbManager service key；anon 无策略=静默空集，不另开 anon 口）
ALTER TABLE ave_same_name_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON ave_same_name_snapshots;
CREATE POLICY service_all ON ave_same_name_snapshots
    FOR ALL TO service_role USING (true) WITH CHECK (true);
