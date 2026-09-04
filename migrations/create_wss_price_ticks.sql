-- wss_price_ticks：four.meme BSC 内盘成交 tick 原始留存表
-- 数据源：FourMemeAnkrWsCollector 解码 TokenManager2 的 TokenPurchase/TokenSale 事件
-- 模式对齐 pumpfun-wss-trader 的 wss_price_ticks（批量缓冲写 + UNIQUE 幂等）
-- 多实验并发时同一 tick 首写者拥有（ignoreDuplicates），读侧按 experiment_id 过滤
-- ⚠️ 已产生数据的实验行绝不可删（experiment_id 级联会永久丢 tick，用户裁定 08-27）

CREATE TABLE IF NOT EXISTS wss_price_ticks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  token_address TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INT NOT NULL,
  trade_type TEXT NOT NULL,               -- 'buy' | 'sell'（TokenPurchase | TokenSale）
  trader_address TEXT,
  price_bnb NUMERIC NOT NULL,             -- 成交价（BNB/token）
  price_usd NUMERIC,
  bnb_amount NUMERIC,                     -- BNB 计价成交量（非 wei）
  token_amount NUMERIC,
  price_outlier BOOLEAN DEFAULT false,    -- FA 离群价剔除标记（落表但不作价）
  block_number BIGINT,
  block_time TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_wss_ticks_exp_time ON wss_price_ticks(experiment_id, block_time);
CREATE INDEX IF NOT EXISTS idx_wss_ticks_token_time ON wss_price_ticks(token_address, block_time);
CREATE INDEX IF NOT EXISTS idx_wss_ticks_exp_recv ON wss_price_ticks(experiment_id, received_at);
