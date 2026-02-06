# 数据库索引优化建议

## 时序数据查询优化

`experiment_time_series_data` 表是回测引擎的核心数据源，查询量大且容易超时。以下是优化建议：

## 建议的索引

### 1. 实验ID + 时间戳索引（最重要）

```sql
-- 复合索引，用于按实验查询并按时间排序
CREATE INDEX IF NOT EXISTS idx_experiment_timestamp
ON experiment_time_series_data(experiment_id, timestamp ASC);

-- 如果使用 Supabase/PostgreSQL，可以添加 INCLUDE 优化
CREATE INDEX IF NOT EXISTS idx_experiment_timestamp_include
ON experiment_time_series_data(experiment_id, timestamp ASC)
INCLUDE (token_address, token_symbol, loop_count, price_usd, price_native, factor_values, signal_type, signal_executed, execution_reason);
```

### 2. 实验ID + 代币地址索引

```sql
-- 用于查询特定实验的特定代币数据
CREATE INDEX IF NOT EXISTS idx_experiment_token
ON experiment_time_series_data(experiment_id, token_address);
```

### 3. 轮次计数索引（可选）

```sql
-- 如果经常按 loop_count 查询
CREATE INDEX IF NOT EXISTS idx_experiment_loop
ON experiment_time_series_data(experiment_id, loop_count);
```

## 在 Supabase 中执行索引

1. 登录 Supabase 控制台
2. 进入 SQL Editor
3. 执行上述 SQL 语句

## 验证索引是否生效

```sql
-- 查看表的索引
SELECT
    indexname,
    indexdef
FROM
    pg_indexes
WHERE
    tablename = 'experiment_time_series_data';

-- 查看索引大小
SELECT
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
FROM
    pg_stat_user_indexes
WHERE
    tablename = 'experiment_time_series_data'
ORDER BY
    pg_relation_size(indexrelid) DESC;
```

## 代码层面的优化（已完成）

1. **减小分页大小**：从 500 降到 100（首次）和 50（重试时）
2. **缩短超时时间**：首次 30 秒，重试时减少到 10 秒
3. **添加重试机制**：最多重试 3 次，每次等待 2 秒
4. **连续错误检测**：连续 3 次错误则停止查询
5. **只选择需要的字段**：使用 `select()` 明确指定字段而不是 `select('*')`

## 其他建议

### 1. 定期清理旧数据

```sql
-- 删除超过 30 天的旧实验数据
DELETE FROM experiment_time_series_data
WHERE created_at < NOW() - INTERVAL '30 days';
```

### 2. 数据归档

考虑将历史实验数据迁移到归档表：

```sql
-- 创建归档表
CREATE TABLE experiment_time_series_data_archive AS
SELECT * FROM experiment_time_series_data
WHERE created_at < NOW() - INTERVAL '30 days';

-- 删除已归档的数据
DELETE FROM experiment_time_series_data
WHERE id IN (SELECT id FROM experiment_time_series_data_archive);
```

### 3. 分区表（高级）

如果数据量持续增长，考虑使用 PostgreSQL 分区表：

```sql
-- 按实验ID哈希分区
CREATE TABLE experiment_time_series_data_partitioned (
    -- 与原表相同的结构
) PARTITION BY HASH (experiment_id);

-- 创建多个分区
CREATE TABLE ts_data_part_0 PARTITION OF experiment_time_series_data_partitioned
    FOR VALUES WITH (MODULUS 4, REMAINDER 0);
CREATE TABLE ts_data_part_1 PARTITION OF experiment_time_series_data_partitioned
    FOR VALUES WITH (MODULUS 4, REMAINDER 1);
-- ...
```
