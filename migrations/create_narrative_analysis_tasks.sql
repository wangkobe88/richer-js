-- 叙事分析任务队列表（2026-10-24 补录自活库快照）
--
-- ⚠️ 活库快照勿重复执行（CREATE TABLE IF NOT EXISTS 幂等，仅供从零重建）。
-- 半退役状态：worker 队列消费链路已基本由引擎内嵌直调取代（C84），web 路由
-- 仍有建任务/列表端点在用（narrative.routes.js），表保留。
--
-- 列清单/类型/默认值来自活库 OpenAPI 定义（2026-10-24）；RLS 状态未核实。

CREATE TABLE IF NOT EXISTS public.narrative_analysis_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address text NOT NULL,
  token_symbol text,
  triggered_by_experiment_id text,
  status text NOT NULL DEFAULT 'pending',
  priority int DEFAULT 50,
  current_stage int DEFAULT 0,
  narrative_id uuid,                         -- 指向 token_narrative.id
  error_message text,
  retry_count int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);
