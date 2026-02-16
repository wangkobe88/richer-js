-- ============================================
-- experiment_tokens 表添加实时价格字段
-- ============================================
-- 用途：添加实时价格相关字段，用于页面刷新时获取最新价格
--
-- 新增字段：
-- - current_price_usd: 实时价格（独立存储便于查询和排序）
-- - price_updated_at: 价格更新时间戳
-- ============================================

-- 添加 current_price_usd 字段（实时价格，独立存储便于查询）
ALTER TABLE experiment_tokens
ADD COLUMN IF NOT EXISTS current_price_usd DECIMAL(38,18);

-- 添加 price_updated_at 字段（价格更新时间戳）
ALTER TABLE experiment_tokens
ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP WITH TIME ZONE;

-- ============================================
-- 创建索引
-- ============================================

-- 为 current_price_usd 创建索引（用于按价格排序）
CREATE INDEX IF NOT EXISTS idx_experiment_tokens_current_price
ON experiment_tokens(current_price_usd);

-- 为 price_updated_at 创建索引（用于查询最近更新的价格）
CREATE INDEX IF NOT EXISTS idx_experiment_tokens_price_updated_at
ON experiment_tokens(price_updated_at);

-- ============================================
-- 添加注释
-- ============================================

COMMENT ON COLUMN experiment_tokens.current_price_usd IS '当前实时价格（USD），独立存储便于查询和排序';
COMMENT ON COLUMN experiment_tokens.price_updated_at IS '价格最后更新时间';

-- ============================================
-- 示例查询
-- ============================================

-- 查询实验中所有代币的当前价格及更新时间
-- SELECT token_symbol, current_price_usd, price_updated_at
-- FROM experiment_tokens
-- WHERE experiment_id = 'xxx'
-- ORDER BY price_updated_at DESC;

-- 计算早期收益率（使用 raw_api_data 中的 launch_price）
-- SELECT
--   token_symbol,
--   (raw_api_data->>'launch_price')::DECIMAL(38,18) as launch_price,
--   current_price_usd,
--   price_updated_at,
--   CASE
--     WHEN (raw_api_data->>'launch_price')::DECIMAL(38,18) > 0
--     THEN ((current_price_usd - (raw_api_data->>'launch_price')::DECIMAL(38,18)) / (raw_api_data->>'launch_price')::DECIMAL(38,18) * 100)
--     ELSE 0
--   END as early_return_percent
-- FROM experiment_tokens
-- WHERE experiment_id = 'xxx'
--   AND raw_api_data->>'launch_price' IS NOT NULL;
