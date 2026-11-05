-- 买入点位分析（BP1/BP2：信号源门链引擎融合，2026-11-05 用户裁定）
--
-- 用途：Jev 驱动的入场时机判定（综合题 buy_point_assessment 四桶
-- good/neutral/poor/insufficient + 七维度档位）落库行。每次分析 = 一个
-- as-of 切片（anchor_tick_count 锚），多行历史刻意非 upsert 单行——
-- 同 token 不同点位结论不同，轨迹本身是校准研究数据（学 cheat_detection）。
--
-- verdict 域：'assessed'（Jev 正常出综合判定）/ 'error'（链路错，fail_reason
-- 留上下文）/ 'timeout'（gate.awaitMs 竞速超时，late 链落行）。**无 cheat/
-- healthy 等盘面性质域**——本模块只判点位不判性质（判断一律 Jev，代码纯透传）。
--
-- 访问口径：引擎写/工具读一律 dbManager service key（anon 无 policy，RLS enabled）。
-- 刻意无 UNIQUE：① 同 token 多 as-of 切片留史；② 跨实验进程并发双跑数据无害
-- （配额由 T110 买信号节流+signalGate maxTriggers 顶帽兜底，残余竞态=接受）。
-- 刻意不挂实验 FK：token 级全局资产——实验 stop 不清理行、实验删除不级联
-- （source_experiment_id/signal_id 仅 provenance）。
-- jev_prompt 仅每 (token_address, question_version) 首行落全文——多行历史下
-- 全文落每行=热票数百行×20KB 无界增长。
--
-- 执行状态：2026-11-05 待 182 Supabase SQL 编辑器手工执行（DDL 先于进程重启红线）。
CREATE TABLE IF NOT EXISTS public.buy_point_analyses (
  id bigserial PRIMARY KEY,
  token_address text NOT NULL,
  platform text,
  question_version text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('assessed','error','timeout')),
  assessment text CHECK (assessment IN ('good','neutral','poor','insufficient')),
  dimensions jsonb,           -- 七维度档位 {id:{bucket,prob}}（缺席 null）
  answers_raw jsonb,          -- Jev 完整 answers（含 probabilities，断代对拍证据）
  jev_prompt text,            -- state 全文（仅每 token+question_version 首行落）
  snapshot_digest jsonb,      -- 输入摘要：tickCount/买卖量/钱包数/截断说明
  anchor_tick_count int,
  fail_reason text,           -- error/timeout 行的失败上下文
  signal_id uuid,             -- provenance：触发本分析的买信号行（不挂 FK）
  source_experiment_id uuid,  -- provenance，不挂 experiments FK
  analyzed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buy_point_analyses_token
  ON public.buy_point_analyses(token_address, analyzed_at DESC);

ALTER TABLE public.buy_point_analyses ENABLE ROW LEVEL SECURITY;
