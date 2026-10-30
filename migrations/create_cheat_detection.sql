-- 作弊盘检测（CD1 立项案：ZERODAY 0x23f1c4af…7777，flap，2026-10-30 用户裁定）
--
-- 用途：Jev 驱动的盘面健康检测（三分类 cheat/unhealthy/healthy + unclear/error/timeout）
-- 落库行。每次分析 = 一个 as-of 切片（anchor_tick_count 锚），**多行历史刻意非
-- upsert 单行**——盘面性质随时点演化（用户裁定：不健康↔健康可相互转化，买点不同
-- 性质可能不同），转化轨迹本身是回归研究数据。
--
-- 访问口径：引擎写/工具读一律 dbManager service key（anon 无 policy，RLS enabled）。
-- 刻意无 UNIQUE：① 同 token 多 as-of 切片留史；② 跨实验进程并发双跑数据无害
-- （配额由进程内 maxAnalysesPerToken 顶帽兜底，残余竞态=接受）。
-- 刻意不挂实验 FK：token 级全局资产（学 ave_same_name_snapshots）——实验 stop
-- 不清理行、实验删除不级联（source_experiment_id 仅 provenance）。
-- jev_prompt 仅每 (token_address, question_version) 首行落全文——多行历史下全文
-- 落每行=热票数百行×20KB 无界增长（token_narrative 落全文是单行 upsert 才可行）。
-- is_valid 首期无写入者（单题集版本）：将来题集断代脚本按 question_version 窗口
-- 批量置 false（invalidate-*-window 先例），届时缓存复用自动失效。
--
-- 执行状态：2026-10-30 用户已在 Supabase SQL 编辑器手工执行。
CREATE TABLE IF NOT EXISTS public.cheat_detection (
  id bigserial PRIMARY KEY,
  token_address text NOT NULL,
  platform text,
  question_version text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('cheat','unhealthy','healthy','unclear','error','timeout')),
  cheat_prob numeric(5,4),
  pattern_type text,
  retail_participation numeric(4,2),
  answers_raw jsonb,          -- Jev 完整 answers（含 probabilities，断代对拍证据）
  jev_prompt text,            -- state 全文（仅每 token+question_version 首行落）
  snapshot_digest jsonb,      -- 输入摘要：tickCount/买卖量/钱包数/截断说明
  anchor_tick_count int,
  fail_reason text,           -- error/timeout 行的失败上下文（GMGN failReason 先例）
  source_experiment_id uuid,  -- provenance，不挂 experiments FK
  analyzed_at timestamptz DEFAULT now(),
  is_valid boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_cheat_detection_token
  ON public.cheat_detection(token_address, analyzed_at DESC);

ALTER TABLE public.cheat_detection ENABLE ROW LEVEL SECURITY;
