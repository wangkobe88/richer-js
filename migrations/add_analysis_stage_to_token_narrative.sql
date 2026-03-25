-- 添加分析阶段字段到叙事分析表
-- 用于标识分析结果是在哪个阶段产生的（两阶段架构）

-- 添加 analysis_stage 字段
ALTER TABLE token_narrative
  ADD COLUMN IF NOT EXISTS analysis_stage INTEGER DEFAULT 2;

-- 添加注释
COMMENT ON COLUMN token_narrative.analysis_stage IS '分析阶段: 0=单阶段模式(V7.23及以前), 1=Stage1检测出低质量, 2=Stage2详细评分';

-- 创建索引（用于加速查询）
CREATE INDEX IF NOT EXISTS idx_token_narrative_analysis_stage
  ON token_narrative(analysis_stage);

-- 更新现有记录的 analysis_stage 值
-- 对于 V7.23 及以前的记录，设置为 0（单阶段模式）
UPDATE token_narrative
SET analysis_stage = 0
WHERE analysis_stage IS NULL
  AND (prompt_version < 'V8.0' OR prompt_version IS NULL);
