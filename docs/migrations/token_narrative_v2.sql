-- ============================================================
-- token_narrative 表结构重构：统一 result 编码
-- 删除 ~40 列 → 新增 14 列（6 JSONB + 4×2 text）
-- 无需兼容设计（系统未发布）
-- ============================================================

-- ============================================================
-- 第零步：删除依赖旧字段的视图
-- ============================================================

DROP VIEW IF EXISTS v_token_narrative_with_duration;

-- ============================================================
-- 第一步：删除旧列
-- ============================================================

-- 预检查（2列）
ALTER TABLE token_narrative DROP COLUMN IF EXISTS pre_check_category;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS pre_check_reason;

-- Prestage LLM（9列）
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_category;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_model;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_prompt;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_raw_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_parsed_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_started_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_finished_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_success;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_prestage_error;

-- Stage 1 LLM（9列）
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_category;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_model;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_prompt;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_raw_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_parsed_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_started_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_finished_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_success;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage1_error;

-- Stage 2 LLM（9列）
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_category;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_model;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_prompt;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_raw_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_parsed_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_started_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_finished_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_success;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage2_error;

-- Stage 3 LLM（9列）
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_category;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_model;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_prompt;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_raw_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_parsed_output;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_started_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_finished_at;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_success;
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage3_error;

-- 最终算分（1列）
ALTER TABLE token_narrative DROP COLUMN IF EXISTS llm_stage_final_result;

-- ============================================================
-- 第二步：删除旧索引
-- ============================================================

DROP INDEX IF EXISTS idx_token_narrative_pre_check_category;
DROP INDEX IF EXISTS idx_token_narrative_pre_check_reason;
DROP INDEX IF EXISTS idx_token_narrative_pre_check_result;
DROP INDEX IF EXISTS idx_token_narrative_pre_check_category_created;
DROP INDEX IF EXISTS idx_token_narrative_stage1_category;
DROP INDEX IF EXISTS idx_token_narrative_stage1_model;
DROP INDEX IF EXISTS idx_token_narrative_stage1_started_at;
DROP INDEX IF EXISTS idx_token_narrative_stage1_success;
DROP INDEX IF EXISTS idx_token_narrative_stage2_category;
DROP INDEX IF EXISTS idx_token_narrative_stage2_model;
DROP INDEX IF EXISTS idx_token_narrative_stage2_started_at;
DROP INDEX IF EXISTS idx_token_narrative_stage2_success;
DROP INDEX IF EXISTS idx_token_narrative_stage2_category_created;

-- ============================================================
-- 第三步：新增列
-- ============================================================

-- Prestage（3列）
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS prestage_result jsonb;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS prestage_prompt text;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS prestage_raw_output text;

-- Stage 1（3列）
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage1_result jsonb;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage1_prompt text;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage1_raw_output text;

-- Stage 2（3列）
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage2_result jsonb;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage2_prompt text;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage2_raw_output text;

-- Stage 3（3列）
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage3_result jsonb;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage3_prompt text;
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage3_raw_output text;

-- Stage Final（1列）
ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS stage_final_result jsonb;

-- ============================================================
-- 第四步：新增索引
-- ============================================================

-- GIN 索引（JSONB 查询）
CREATE INDEX IF NOT EXISTS idx_token_narrative_pre_check_result ON token_narrative USING gin (pre_check_result);
CREATE INDEX IF NOT EXISTS idx_token_narrative_prestage_result ON token_narrative USING gin (prestage_result);
CREATE INDEX IF NOT EXISTS idx_token_narrative_stage1_result ON token_narrative USING gin (stage1_result);
CREATE INDEX IF NOT EXISTS idx_token_narrative_stage2_result ON token_narrative USING gin (stage2_result);
CREATE INDEX IF NOT EXISTS idx_token_narrative_stage3_result ON token_narrative USING gin (stage3_result);

-- 最终评级快速查询（最常用查询）
CREATE INDEX IF NOT EXISTS idx_token_narrative_final_rating ON token_narrative USING btree ((stage_final_result->>'rating'));

-- 时间排序索引（调试用）
CREATE INDEX IF NOT EXISTS idx_token_narrative_stage1_finished_at ON token_narrative USING btree ((stage1_result->>'finishedAt') DESC) WHERE stage1_result IS NOT NULL;
