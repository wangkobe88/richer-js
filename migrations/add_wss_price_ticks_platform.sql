-- wss_price_ticks 增加 platform 列：区分内盘 tick 源（fourmeme | flap）
-- 存量行全部为 four.meme 采集，DEFAULT 即正确回填，无需 UPDATE
-- UNIQUE(tx_hash, log_index) 保持不变：一条 log 只可能由一个合约地址 emit，
-- 两个 collector 各按合约地址订阅（TokenManager2 / Portal），即使一笔 tx 同时调用
-- 两个平台，其事件的 logIndex（receipt 内全局编号）必然不同——跨平台不可能碰撞
-- flap 与 four.meme 代币地址来自不同工厂、天然不重叠，读侧按 token_address 的
-- market-wide 查询（K线/最新价/预检）天然隔离，platform 列仅用于展示与过滤
-- PG 11+ 的 ADD COLUMN ... DEFAULT 为元数据操作不重写表（低峰执行，短 AccessExclusive 锁）
-- ⚠️ 已产生数据的实验行绝不可删（experiment_id 级联会永久丢 tick，用户裁定 08-27）

ALTER TABLE wss_price_ticks
  ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'fourmeme';

CREATE INDEX IF NOT EXISTS idx_wss_ticks_exp_platform
  ON wss_price_ticks(experiment_id, platform);
