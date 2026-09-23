-- 批 3.2 聪明钱挖掘：wss_price_ticks 复合游标分页索引
-- 消费方：scripts/smart-wallet-mining/lib/data-fetcher.js（(received_at,id) 复合游标分页）
--   与 pickSources 的 tick 存在性探测（experiment_id + received_at desc limit 1）。
-- 既有索引（experiment_id, tx_hash, log_index）不含 received_at，分页需额外排序。
-- CONCURRENTLY：不锁表在线建（Supabase SQL Editor 直接跑；事务外单语句执行）。
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wss_price_ticks_exp_recv_id
  ON wss_price_ticks (experiment_id, received_at, id);
