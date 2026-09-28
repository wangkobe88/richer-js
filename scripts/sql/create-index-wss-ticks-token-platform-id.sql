-- wss_price_ticks 复合索引（P2-3，bc4f756e 回测性能案 2026-09-28）
--
-- 支撑 BacktestEngine._loadWssTicks 的 token 集合 + platform + id keyset 分页：
--   .in('token_address', 100 地址/批) + .eq('platform', 单值) + .gt('id', cursor)
--   + order by id 升序
-- 无索引时 keyset 语义仍正确（退化为顺序扫过滤），有索引才拿到分页收益。
--
-- 用 CONCURRENTLY：表是 watcher 每 500ms flush 的热表（300 万+行），普通
-- CREATE INDEX 拿 SHARE 锁阻塞写入（该规模约数十秒），CONCURRENTLY 不阻塞
-- DML。代价：耗时更长 + 不能在事务块内执行（psql 单条执行即可）+ 中途失败
-- 会留 INVALID 索引（重跑本语句前先 DROP INVALID 的：查 pg_index.indisready）。
-- 幂等（IF NOT EXISTS），可重复执行。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wss_ticks_token_platform_id
  ON wss_price_ticks (token_address, platform, id);
