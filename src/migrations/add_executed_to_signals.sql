-- 添加 executed 列到 strategy_signals 表
-- 用于记录信号是否已被成功执行

-- 添加列（如果不存在）
ALTER TABLE strategy_signals
ADD COLUMN IF NOT EXISTS executed BOOLEAN DEFAULT false;

-- 为现有数据设置默认值
UPDATE strategy_signals
SET executed = false
WHERE executed IS NULL;

-- 创建索引以加快查询
CREATE INDEX IF NOT EXISTS idx_strategy_signals_executed
ON strategy_signals(experiment_id, executed);

-- 添加注释
COMMENT ON COLUMN strategy_signals.executed IS '信号是否已成功执行';
