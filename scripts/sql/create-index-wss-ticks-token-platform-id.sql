-- wss_price_ticks 复合索引（P2-3，bc4f756e 回测性能案 2026-09-28）
--
-- 支撑 BacktestEngine._loadWssTicks 的 token 集合 + platform + id keyset 分页：
--   .in('token_address', 100 地址/批) + .eq('platform', 单值) + .gt('id', cursor)
--   + order by id 升序
-- 无索引时 keyset 语义仍正确（退化为顺序扫过滤），有索引才拿到分页收益；
-- 幂等 DDL，可重复执行。
--
-- 在 182（或任何有 service 权限的 psql/客户端）执行：
--   CREATE INDEX IF NOT EXISTS idx_wss_ticks_token_platform_id
--     ON wss_price_ticks (token_address, platform, id);
CREATE INDEX IF NOT EXISTS idx_wss_ticks_token_platform_id
  ON wss_price_ticks (token_address, platform, id);
