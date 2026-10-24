-- token_narrative 投影列（2026-10-24，叙事 DB 适配批次 B2）
--
-- 评估链三段判断/拦截信封/评分从 jsonb 提升为 SQL 可查一等投影列。
-- 真相源仍是各信封 jsonb（event_result/event_score_result/relation_result/
-- final_result/pre_check_result/prestage_result）；投影由 NarrativeRepository
-- projectColumns() 派生（final_rating 复用 resolveFinalRating 六列顺序链），
-- 与回填脚本共用同一纯函数。
--
-- 默认不回填：历史行新列恒 null，`WHERE final_rating IS NOT NULL` 分代；
-- 可选回填脚本 scripts/narrative/backfill-projection-columns.mjs（182 跑，
-- 幂等 WHERE final_rating IS NULL）。索引在回填之后建最优。
--
-- 与 rename_token_narrative_stage_columns.sql 同窗口一次执行（DDL 先于新代码 worker 启动，红线 4）。

BEGIN;

ALTER TABLE public.token_narrative
  ADD COLUMN IF NOT EXISTS final_rating     text CHECK (final_rating IN ('high', 'mid', 'low', 'unrated')),
  ADD COLUMN IF NOT EXISTS block_reason     text,
  ADD COLUMN IF NOT EXISTS block_stage      text CHECK (block_stage IN ('precheck', 'mapper')),
  ADD COLUMN IF NOT EXISTS analysis_path    text CHECK (analysis_path IN ('standard', 'prestage', 'precheck_terminal')),
  ADD COLUMN IF NOT EXISTS total_score      numeric(6,2),
  ADD COLUMN IF NOT EXISTS event_score      numeric(6,2),   -- = final_result.details.eventCompositeScore（事件契合分）
  ADD COLUMN IF NOT EXISTS relevance_score  numeric(6,2),
  ADD COLUMN IF NOT EXISTS quality_score    numeric(6,2),
  ADD COLUMN IF NOT EXISTS event_category   varchar(1) CHECK (event_category IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'W')),
  ADD COLUMN IF NOT EXISTS jev_version      text,
  ADD COLUMN IF NOT EXISTS prestage_version text;

COMMENT ON COLUMN public.token_narrative.final_rating IS 'resolveFinalRating 六列顺序链派生（precheck→prestage→event→event_score→relation→final）';
COMMENT ON COLUMN public.token_narrative.block_reason IS '拦截原因（mapper 门链 blockReason 或 precheck ruleName）';
COMMENT ON COLUMN public.token_narrative.block_stage IS '拦截层：precheck=规则前置拒 / mapper=评估门链拦（prestage 定档 low 是评级非拦截，不落）';
COMMENT ON COLUMN public.token_narrative.analysis_path IS 'standard=标准路径 / prestage=prestage 定档 / precheck_terminal=precheck 终态';
COMMENT ON COLUMN public.token_narrative.event_category IS '事件分类 A~W；仅非拦截票落（拦截票 category 被 mapper 改写为掷骰值不可信，C184 快狗案）';

COMMIT;
