-- =====================================================================
-- 新表：wss_events（WSS watcher 架构：低频事件通道）
--
-- watcher 常驻进程（src/watcher/）写；实验进程 SharedTickConsumer 增量消费。
-- 承载 token 发现（token_create）与毕业（graduation）两类低频事件——
-- 它们不产生 tick 行，必须有独立通道才能与 wss_price_ticks 一起被实验消费。
-- kind='heartbeat' 为 watcher 60s 心跳行（人工查活 + 实验侧断供判据），7 天清理。
--
-- token 级全局表，★故意不挂 experiment 维度（同 token_profiles 裁定）：
--   1. 事件是市场级资产，多个实验共享同一份流
--   2. 免疫 experiment ON DELETE CASCADE
--
-- payload 存 collector 回调 info 原始形态（camelCase 原样，消费侧零字段映射）：
--   fourmeme token_create: {creator,token,requestId,name,symbol,totalSupply,
--                           blockNumber,blockTimeMs,txHash}
--   flap token_create:     {eventTsSec,creator,nonce,token,name,symbol,meta,
--                           taxToken,blockNumber,blockTimeMs,txHash}
--   fourmeme graduation:   {token,offers,quote,fundsBnb,blockNumber,blockTimeMs,txHash}
--   flap graduation:       {token,dexPool,tokenAmount,fundsBnb,blockNumber,blockTimeMs,txHash}
--   heartbeat:             {fourmeme:{lastMessageAt,stats},flap:{lastMessageAt,stats}}
--
-- 幂等：watcher 单实例（pid 锁）单写者，不加唯一约束；消费侧 saveToken/_seenTokens
-- 去重。id 为消费 watermark 游标（bigserial 分配序≠提交序，消费侧带去重集，
-- 见 src/trading-engine/core/SharedTickConsumer.js）。
--
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS wss_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind TEXT NOT NULL,                  -- 'token_create' | 'graduation' | 'heartbeat'
    platform TEXT NOT NULL,              -- 'fourmeme' | 'flap'（heartbeat 行为 'watcher'）
    token_address TEXT,                  -- heartbeat 行为 NULL
    payload JSONB NOT NULL,
    block_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- token 事件查询（按 token 回看发现/毕业时刻）
CREATE INDEX IF NOT EXISTS idx_wss_events_token
    ON wss_events (token_address);

-- 服务端读写策略（对齐 token_profiles / wss_price_ticks 现状：watcher 写入与
-- 实验/web 消费都走 dbManager，密钥 SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY——
-- anon 无策略则静默空集，不另开 anon 口）
ALTER TABLE wss_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON wss_events;
CREATE POLICY service_all ON wss_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
