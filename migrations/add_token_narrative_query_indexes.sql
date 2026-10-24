-- token_narrative 查询索引（2026-10-24，叙事 DB 适配批次 C）
--
-- 前两个修实证全表扫（代码零改动，索引即修复）：
--   - PrecheckFailRetryService：gt(analyzed_at) + order by analyzed_at desc（行 158）
--   - NarrativeRepository.findAll：order by created_at desc 深页
-- 后两个为投影列 SQL 分析（partial，写放大≈0，日千级 upsert 无感）。
--
-- 在 B2 投影列之后执行；若跑回填脚本，回填之后建最优。

CREATE INDEX IF NOT EXISTS idx_token_narrative_analyzed_at
  ON public.token_narrative (analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_narrative_created_at
  ON public.token_narrative (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_narrative_rating
  ON public.token_narrative (final_rating, analyzed_at DESC) WHERE final_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_narrative_blocked
  ON public.token_narrative (block_stage, block_reason) WHERE block_reason IS NOT NULL;
