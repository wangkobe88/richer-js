-- 优化时序数据表查询性能的索引
-- 用于解决回测引擎数据加载超时问题

-- 问题分析：
-- 当前查询模式：WHERE experiment_id = ? ORDER BY timestamp LIMIT 100 OFFSET from
-- 使用 range() 分页，每次查询100条数据
-- 超时原因：表数据量大，缺少合适的索引

-- 解决方案：创建复合索引

-- 1. 主要索引：experiment_id + timestamp
-- 覆盖最常用的查询模式
CREATE INDEX IF NOT EXISTS idx_experiment_time_series_experiment_timestamp
ON experiment_time_series_data(experiment_id, timestamp);

-- 2. 扩展索引：experiment_id + timestamp + token_address
-- 当按代币地址过滤时使用
CREATE INDEX IF NOT EXISTS idx_experiment_time_series_experiment_token_timestamp
ON experiment_time_series_data(experiment_id, token_address, timestamp);

-- 3. 覆盖索引：包含常用查询字段
-- 减少回表操作，提升性能
CREATE INDEX IF NOT EXISTS idx_experiment_time_series_covering
ON experiment_time_series_data(experiment_id, timestamp)
INCLUDE (token_address, token_symbol, loop_count, price_usd, price_native, factor_values, blockchain);

-- 4. 部分索引（可选）：只为最近的数据创建索引
-- 如果历史数据很少查询，可以只为最近30天的数据创建索引
-- CREATE INDEX IF NOT EXISTS idx_experiment_time_series_recent
-- ON experiment_time_series_data(experiment_id, timestamp)
-- WHERE timestamp >= NOW() - INTERVAL '30 days';

-- 查看索引使用情况的SQL：
-- EXPLAIN ANALYZE
-- SELECT * FROM experiment_time_series_data
-- WHERE experiment_id = 'xxx'
-- ORDER BY timestamp
-- LIMIT 100;

-- 删除索引的SQL（如果需要）：
-- DROP INDEX IF EXISTS idx_experiment_time_series_experiment_timestamp;
-- DROP INDEX IF EXISTS idx_experiment_time_series_experiment_token_timestamp;
-- DROP INDEX IF EXISTS idx_experiment_time_series_covering;
