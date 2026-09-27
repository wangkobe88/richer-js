-- =====================================================================
-- 新表：token_position_analyses（pumpfun 回迁批 4 TPA 落库）
--
-- TokenPositionAnalyzer（src/services/TokenPositionAnalyzer.js）触发分析结果：
-- as-of 持仓画像 verdict + TPAPre_* 因子快照。一个 token 在生命周期内
-- write-once（v1 trigger_no 恒 1），每次触发一行。回测与 live 都写本表，
-- experiment_id 区分。子页面 /experiment/:id/position-analysis 读它展示。
--
-- 与母版差异：
--   1. 去掉 category / wallet_profiles 两列——母版现行 _persist（2026-08-23 起）
--      已不写这两列（画像明细收口 wallet_offline_profiles），richer-js 以代码为准
--   2. experiment_id 挂 ON DELETE CASCADE——对齐 richer-js 实验删除级联语义
--      （experiment-owned 表统一，见 migrate-experiment-cascade-delete.sql）
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS token_position_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  token_address text NOT NULL,
  trigger_no int NOT NULL DEFAULT 1,          -- 第几次触发（预留多次刷新；v1=1）
  as_of timestamptz NOT NULL,                  -- as-of 时间（live=触发当下；backtest=回测 tick 时间，防 label leak）
  trigger_snapshot jsonb,                      -- {ageSeconds, tradeCount(raw), buyBnb(raw,BNB), blockNumber, currentPriceUsd}
  verdict text NOT NULL,                       -- approve | block
  block_reasons text[],                        -- verdict=block 时命中的门，如 ['tokenScore<=2（实际 1.5）']
  holding_factors jsonb,                       -- 触发时算出的持仓因子快照（TPAPre_* 17 键 + 分析元数据）
  enforce boolean NOT NULL DEFAULT false,      -- 写入时模块是否处于拦截模式（shadow=false / enforce=true），便于 A/B 区分
  created_at timestamptz DEFAULT now(),
  UNIQUE(experiment_id, token_address, trigger_no)
);

-- 索引：按实验 + token 查（子页面主力查询）
CREATE INDEX IF NOT EXISTS idx_tpa_experiment_token ON token_position_analyses(experiment_id, token_address);
-- 按 verdict 统计（A/B 评估）
CREATE INDEX IF NOT EXISTS idx_tpa_experiment_verdict ON token_position_analyses(experiment_id, verdict);

-- 服务端读写策略（对齐 token_profiles / wallet_offline_profiles）
ALTER TABLE token_position_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON token_position_analyses;
CREATE POLICY service_all ON token_position_analyses
    FOR ALL TO service_role USING (true) WITH CHECK (true);
