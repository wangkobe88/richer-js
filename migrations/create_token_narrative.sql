-- 叙事分析结果表（2026-10-24 补录自活库快照 + 同日列名重构/投影列批次终态）
--
-- ⚠️ 活库快照勿在已有该表的环境重复执行（本件是从零重建用终态形状；存量库
-- 迁移走 rename_token_narrative_stage_columns.sql + add_token_narrative_projection_columns.sql
-- + add_token_narrative_query_indexes.sql 三个增量件）。
--
-- 列名语义对齐当前评估链（precheck 纯规则前置 → 事件判定 → 事件评分 →
-- 关系+代币 → 终局）：stage1/2/3_* 旧三阶段生成式管线列名已于 2026-10-24
-- RENAME；jev_prompt/jev_raw_output = Jev 完整输入输出单份真源；legacy_*
-- 四列 = 旧管线时代的独立调用真输出（历史保留，新行停写）。
--
-- 列清单/类型/默认值来自活库 OpenAPI 定义（2026-10-24）；PK/UNIQUE 按 upsert
-- 冲突键实证（NarrativeRepository onConflict='token_address'）。RLS 状态未核实
-- ——anon key 实证可读写（NarrativeRepository 历来直连），故本件不含 RLS 语句。

CREATE TABLE IF NOT EXISTS public.token_narrative (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_address text NOT NULL UNIQUE,
  token_symbol text,
  platform text,
  blockchain text,
  raw_api_data jsonb,
  extracted_info jsonb,
  twitter_info jsonb,
  prompt_version text DEFAULT 'V9.0',        -- 兼容保留列；单列双格式问题由 jev_version/prestage_version 终结
  is_valid boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  analyzed_at timestamptz,
  experiment_id text,                        -- 死列（历史遗留，保留不删）
  prompt_type text,
  analysis_stage integer,
  classified_urls jsonb,
  pre_check_result jsonb,                    -- precheck 结果信封（纯规则前置）
  data_fetch_results jsonb,
  url_extraction_result jsonb,
  task_id uuid,                              -- 死列（历史遗留，保留不删）
  prestage_result jsonb,                     -- prestage 定档信封（账号/社区/项目币路径）
  prestage_prompt text,                      -- prestage 独立 Jev 调用（3 题）完整输入
  prestage_raw_output text,
  -- ── 评估链三段（2026-10-24 RENAME：真相源 jsonb，内容形状不变） ──
  event_result jsonb,                        -- 事件判定：分类 A~W/影响力档/时效/改道审计（原 stage1_result）
  event_score_result jsonb,                  -- 事件评分：契合分/W 数学/量级门/蓝筹去重拦截（原 stage2_result）
  relation_result jsonb,                     -- 关系+代币段：relevance/quality/总分聚合/名字门豁免审计（原 stage3_result）
  final_result jsonb,                        -- 终局信封 rating/score/details（原 stage_final_result）
  jev_prompt text,                           -- Jev 标准调用完整输入 60k（原 stage1_prompt，校准红线逐字复用）
  jev_raw_output text,                       -- Jev 标准调用完整响应（原 stage1_raw_output，题集断代对拍唯一可回放证据）
  -- ── 旧三阶段管线遗留（RENAME legacy_*；旧管线时代=三段独立 LLM 调用真输出，新行停写） ──
  legacy_stage2_prompt text,
  legacy_stage3_prompt text,
  legacy_stage2_raw_output text,
  legacy_stage3_raw_output text,
  gmgn_info jsonb,
  token_category text,
  -- ── 投影列（2026-10-24 B2：真相源=上方各信封 jsonb，projectColumns 派生） ──
  final_rating text CHECK (final_rating IN ('high', 'mid', 'low', 'unrated')),
  block_reason text,
  block_stage text CHECK (block_stage IN ('precheck', 'mapper')),
  analysis_path text CHECK (analysis_path IN ('standard', 'prestage', 'precheck_terminal')),
  total_score numeric(6,2),
  event_score numeric(6,2),                  -- = final_result.details.eventCompositeScore（事件契合分）
  relevance_score numeric(6,2),
  quality_score numeric(6,2),
  event_category varchar(1) CHECK (event_category IN ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'W')),
  jev_version text,
  prestage_version text
);

-- 查询索引（同 add_token_narrative_query_indexes.sql）
CREATE INDEX IF NOT EXISTS idx_token_narrative_analyzed_at
  ON public.token_narrative (analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_narrative_created_at
  ON public.token_narrative (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_narrative_rating
  ON public.token_narrative (final_rating, analyzed_at DESC) WHERE final_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_token_narrative_blocked
  ON public.token_narrative (block_stage, block_reason) WHERE block_reason IS NOT NULL;
