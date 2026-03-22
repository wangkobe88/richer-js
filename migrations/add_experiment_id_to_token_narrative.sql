-- 添加实验ID字段到叙事分析表
-- 用于标识分析结果是在哪个实验中产生的

-- 添加 experiment_id 字段
ALTER TABLE token_narrative
  ADD COLUMN IF NOT EXISTS experiment_id TEXT;

-- 添加注释
COMMENT ON COLUMN token_narrative.experiment_id IS '标识分析结果是在哪个实验中产生的（用于缓存优化）';

-- 创建索引（用于加速查询）
CREATE INDEX IF NOT EXISTS idx_token_narrative_address_experiment
  ON token_narrative(token_address, experiment_id);
