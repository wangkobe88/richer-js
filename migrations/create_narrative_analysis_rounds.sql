-- 叙事分析轮次表（C84 买腿重构，2026-10-17：叙事分析发起条件 + 单一购买条件）
--
-- 新模型腿（携带 narrativeTriggerCondition 的买腿）后台叙事分析的轮次留痕：
-- 引擎触发状态机每发起一轮 insert 一行（trigger_reason='condition' 首轮 /
-- 'retry' 账号型重试轮），完成时回填 completed_at/rating/from_cache/error。
-- 观测 fail-open（写失败 catch+warn 不中断交易链），交易门在单一买条件内
-- fail-closed（narrativeRating==2 OR ==3）——两口径刻意分离。
--
-- rounds 计数按进程计（重启后首 tick 重走 round 1，缓存秒回 from_cache=true 留痕）
-- → 刻意无 (experiment_id, token_address, round_no) UNIQUE 约束，防 --force 重启
-- 后同轮号插行失败污染日志。
--
-- 访问：引擎写/路由读均 dbManager service key（同 manual_trade_requests），anon
-- 无 policy。

CREATE TABLE IF NOT EXISTS public.narrative_analysis_rounds (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  token_address varchar NOT NULL,
  round_no int NOT NULL,                       -- 进程内轮次（1 起）
  trigger_reason varchar NOT NULL CHECK (trigger_reason IN ('condition', 'retry')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  rating int,                                  -- 1/2/3/9；null=未完成或不可归一
  from_cache boolean,                          -- 完成轮：分析是否缓存命中
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_narrative_rounds_exp_token_round
  ON public.narrative_analysis_rounds (experiment_id, token_address, round_no);

ALTER TABLE public.narrative_analysis_rounds ENABLE ROW LEVEL SECURITY;
