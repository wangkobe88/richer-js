-- 外部资源缓存表（2026-10-24 补录自活库快照）
--
-- ⚠️ 活库快照勿重复执行（CREATE TABLE IF NOT EXISTS 幂等，仅供从零重建）。
-- resource_type 为值域而非分表：tweet_image / tweet_image_raw /
-- user_info / user_tweets / ...:ca:<addr>（CA 惰性早停专属 key）/
-- twitter_account 等（见 src/narrative/db/cache-ttl-config.mjs）。
-- UNIQUE(url, resource_type) 按 ExternalResourceCache.mjs upsert
-- onConflict='url,resource_type' 实证。
--
-- 列清单/类型/默认值来自活库 OpenAPI 定义（2026-10-24）；RLS 状态未核实。

CREATE TABLE IF NOT EXISTS public.external_resource_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL,
  resource_type text NOT NULL,
  content jsonb,
  status text DEFAULT 'pending',
  error_message text,
  metadata jsonb,
  cached_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT external_resource_cache_url_resource_type_key UNIQUE (url, resource_type)
);

-- 过期清理扫描用（活库现状未核实，幂等补齐无害；E2 TTL 分层依赖）
CREATE INDEX IF NOT EXISTS idx_external_resource_cache_expires_at
  ON public.external_resource_cache (expires_at) WHERE expires_at IS NOT NULL;
