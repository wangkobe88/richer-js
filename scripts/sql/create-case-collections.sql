-- =====================================================================
-- Case 集合管理系统（2026-11-20 用户需求：多层面问题 Case 资产统一维护+独立
-- 持久化+按集合回测）
--
-- 四表：
--   case_collections        集合（name UNIQUE；全局资产不挂 experiment FK）
--   case_collection_tokens  集合成员代币（token 元信息快照+复制同步状态+双水位）
--   case_ticks              wss_price_ticks 行的集合专属副本（快照语义：
--                           原 wss_price_ticks 行被清理/删实验级联后不受影响）
--   case_events             wss_events 该 token 低频事件行镜像
--                           （token_create/graduation/token_quote_set——回放自包含）
--
-- 核心设计裁定（详见实施计划，勿随意改动）：
--   1. case_ticks 复合主键 (collection_id, id)，id=IDENTITY 新分配（非源 id）。
--      源 id 作 BacktestTickCache 增量游标会在「token 后补」场景永久静默漏行
--      （token A 先复制源 id 1..100 → 缓存 maxId=100；token B 后补源 id 50..200
--      → B 的 ≤100 行在 gt(100) 区间结构性不可达）。case 自有 id 严格插入序
--      单调是缓存 STALE/delta 协议的唯一正确游标；源 id 仅存 source_tick_id 审计。
--   2. 同一集合的复制必须严格串行（进程内全局串行队列）：并发插入时 IDENTITY
--      分配序≠提交序，回测 headAnchor 闭区间封闭后 id<anchor 的行永久漏。
--   3. 复合外键 (collection_id, token_address) → case_collection_tokens
--      ON DELETE CASCADE：删单 token 原子级联删该票 ticks+events；删集合链式清空
--      （删除语义=用户裁定「级联删除副本」，前端 confirm 显示规模）。
--   4. 同一代币可进入多个集合：所有唯一约束均为 (collection_id, …) 维度，
--      各集合独立副本互不影响；缓存目录 case-<collectionId>/ 按集合隔离。
--   5. GENERATED ALWAYS（非 BY DEFAULT）防代码误写 id。
--
-- ⚠️ 部署红线：本文件必须先于新 web-server / 引擎代码在 182 执行
--     （新 routes / 引擎 _initializeDataSources 启动即查询本组表）。
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（幂等，可重复执行）。
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) 集合表
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                      -- 人读名（UNIQUE；引用走 id）
  description text DEFAULT '',             -- 人读说明（集合用途，如「Burst 案例」「强庄模式」）
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()     -- 代码维护，不建 trigger（对齐惯例）
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_case_collections_name ON case_collections(name);

-- ─────────────────────────────────────────────────────────────────────
-- 2) 集合成员代币表（快照语义：token_meta=wss_events token_create 原始
--    payload 冻结副本——experiment_tokens 随实验删除级联消失，此处不受影响）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_collection_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES case_collections(id) ON DELETE CASCADE,
  token_address text NOT NULL,             -- 小写
  platform text NOT NULL,                  -- 'fourmeme' | 'flap' | 'gang'（token_create 行 platform 列）
  note text DEFAULT '',                    -- 人读备注（该票为何入选）
  token_meta jsonb NOT NULL,               -- token_create 原始 payload 快照 + blockTimeIso（装载时经
                                           -- token-create-meta.js 纯函数映射七键，与窗口通道逐字节同映射）
  sync_state text NOT NULL DEFAULT 'pending'
    CHECK (sync_state IN ('pending', 'syncing', 'synced', 'failed')),
  sync_error text,                         -- failed 原因
  sync_started_at timestamptz,             -- 租约锚（syncing 超 10min 视为陈旧可接管）
  tick_count bigint DEFAULT 0,             -- case_ticks 实数（收尾 count 对账回写）
  event_count bigint DEFAULT 0,            -- case_events 实数
  tick_watermark_id bigint NOT NULL DEFAULT 0,   -- wss_price_ticks 源 id 复制水位（幂等增量）
  event_watermark_id bigint NOT NULL DEFAULT 0,  -- wss_events 源 id 复制水位（与 tick 水位分属两表 id 序）
  last_synced_at timestamptz,
  added_at timestamptz DEFAULT now(),
  UNIQUE (collection_id, token_address)    -- 同集合幂等；跨集合允许同 token（独立副本）
);

CREATE INDEX IF NOT EXISTS idx_case_col_tokens_col ON case_collection_tokens(collection_id);

-- ─────────────────────────────────────────────────────────────────────
-- 3) 集合 ticks 副本表（wss_price_ticks 装载列镜像 + 集合维度）
--    列类型逐列对齐 migrations/create_wss_price_ticks.sql + 三个 ALTER
--    （sender_address/quote_token/platform）；不镜像源 experiment_id
--    （语义=采集时归属实验，与 Case 跨实验资产无关）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_ticks (
  id bigint GENERATED ALWAYS AS IDENTITY,  -- case 自有 id：复合 PK 一翼 + 缓存增量游标（裁定 1）
  source_tick_id bigint,                   -- 源 wss_price_ticks.id 审计溯源
  collection_id uuid NOT NULL,
  token_address text NOT NULL,
  tx_hash text NOT NULL,
  log_index int NOT NULL,
  trade_type text NOT NULL,                -- 'buy' | 'sell'
  trader_address text,
  sender_address text,
  price_bnb numeric NOT NULL,
  price_usd numeric,
  bnb_amount numeric,
  token_amount numeric,
  price_outlier boolean DEFAULT false,
  block_number bigint,
  block_time timestamptz NOT NULL,
  received_at timestamptz,                 -- 源行到达时刻（保真快照；装载不读）
  platform text NOT NULL DEFAULT 'fourmeme',
  quote_token text,
  PRIMARY KEY (collection_id, id),
  UNIQUE (collection_id, tx_hash, log_index),          -- 幂等复制支撑（upsert ignoreDuplicates）
  FOREIGN KEY (collection_id, token_address)
    REFERENCES case_collection_tokens (collection_id, token_address)
    ON DELETE CASCADE                                   -- 删票/删集合原子级联（裁定 3）
);

-- 装载查询形状支撑：.eq(collection_id).eq(platform).in(token_address,批50)
--   + .gt/.lte(id) 无序锚定拉取（BacktestEngine._fetchPlatformTicksRows 同形状）
CREATE INDEX IF NOT EXISTS idx_case_ticks_col_platform_token_id
  ON case_ticks(collection_id, platform, token_address, id);

-- ─────────────────────────────────────────────────────────────────────
-- 4) 集合事件镜像表（wss_events 低频事件：token_create/graduation/
--    token_quote_set——graduation 回放自包含，防源表未来清理/裁剪）
--    无唯一约束照抄源表（读方去重）；IDENTITY id 同裁定 1（插入序游标）
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  source_event_id bigint,                  -- 源 wss_events.id 审计溯源
  collection_id uuid NOT NULL,
  token_address text NOT NULL,
  kind text NOT NULL,                      -- 'token_create' | 'graduation' | 'token_quote_set'
  platform text NOT NULL,
  payload jsonb NOT NULL,                  -- 源 payload 原样快照
  block_time timestamptz,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (collection_id, id),
  FOREIGN KEY (collection_id, token_address)
    REFERENCES case_collection_tokens (collection_id, token_address)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_case_events_col_kind_token
  ON case_events(collection_id, kind, token_address);

-- ─────────────────────────────────────────────────────────────────────
-- 5) RLS：四表一律 service_role-only（对齐 strategy_library / wss_events；
--    routes/引擎一律 dbManager.getClient() service key）
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE case_collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON case_collections;
CREATE POLICY service_all ON case_collections
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE case_collection_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON case_collection_tokens;
CREATE POLICY service_all ON case_collection_tokens
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE case_ticks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON case_ticks;
CREATE POLICY service_all ON case_ticks
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE case_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON case_events;
CREATE POLICY service_all ON case_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
