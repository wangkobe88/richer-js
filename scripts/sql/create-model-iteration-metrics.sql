-- =====================================================================
-- 新表：model_iteration_metrics（daily-model-update 例行画像维护流程指标）
--
-- scripts/daily-model-update/run-daily.js 断点续跑状态机 + /model-metrics 页面数据源
-- （迁自 pumpfun-wss-trader 同名表，2026-09-27；母版无版本化 DDL，本文件自建）。
--
-- 与母版差异：
--   1. 去 model_path 列（ML 时代遗留，richer-js 无 ML，迁移裁定排除）
--   2. old/new_experiment_id 原口径保留但 richer-js 无 step1 轮换，恒 NULL（监控兼容）
--   3. + UNIQUE(iteration_no)——nextIterationNo 是 max+1 读改写非原子，并发双建
--      显式失败而非静默双行（flock 之外的第二道防线）
--   4. 无 status CHECK 约束（母版同；resumeOrStart 对任意非 completed 状态宽容续跑）
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS model_iteration_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iteration_no int NOT NULL,
  trigger_time timestamptz NOT NULL,
  old_experiment_id uuid,                 -- 原口径保留；richer-js 流程恒 NULL（无 step1 轮换）
  new_experiment_id uuid,                 -- 同上
  status text NOT NULL DEFAULT 'running', -- running | completed | failed
  current_step text NOT NULL DEFAULT 'step3',
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()    -- 代码维护（nowIso），不建 trigger（母版同款）
);

-- 并发双建防线（见头注差异 3）
CREATE UNIQUE INDEX IF NOT EXISTS idx_mim_iteration_no ON model_iteration_metrics(iteration_no);
-- /api/model-metrics 主查询：status 过滤 + iteration_no 倒序分页
CREATE INDEX IF NOT EXISTS idx_mim_status_iter ON model_iteration_metrics(status, iteration_no DESC);

-- 服务端读写策略（对齐 token_position_analyses / token_profiles 惯例；182 SERVICE_KEY=service_role）
ALTER TABLE model_iteration_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON model_iteration_metrics;
CREATE POLICY service_all ON model_iteration_metrics
    FOR ALL TO service_role USING (true) WITH CHECK (true);
