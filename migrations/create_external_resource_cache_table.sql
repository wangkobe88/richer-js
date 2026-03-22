-- 创建外部资源缓存表
CREATE TABLE IF NOT EXISTS external_resource_cache (
  -- 主键
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 资源标识
  url TEXT NOT NULL,
  resource_type TEXT NOT NULL,

  -- 缓存内容
  content JSONB,

  -- 获取状态
  status TEXT DEFAULT 'pending',
  error_message TEXT,

  -- 元数据
  metadata JSONB,

  -- 时间戳
  cached_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,

  -- 约束
  CONSTRAINT external_resource_cache_url_unique UNIQUE (url, resource_type)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_external_resource_cache_url ON external_resource_cache(url);
CREATE INDEX IF NOT EXISTS idx_external_resource_cache_type ON external_resource_cache(resource_type);
CREATE INDEX IF NOT EXISTS idx_external_resource_cache_status ON external_resource_cache(status);
CREATE INDEX IF NOT EXISTS idx_external_resource_cache_expires_at ON external_resource_cache(expires_at);

-- 添加注释
COMMENT ON TABLE external_resource_cache IS '外部资源缓存表（推特、微博、抖音等）';
COMMENT ON COLUMN external_resource_cache.url IS '资源URL';
COMMENT ON COLUMN external_resource_cache.resource_type IS '资源类型：tweet, weibo, website, douyin, tiktok等';
COMMENT ON COLUMN external_resource_cache.content IS '缓存的内容（JSON格式）';
COMMENT ON COLUMN external_resource_cache.status IS '获取状态：success, failed, pending';
COMMENT ON COLUMN external_resource_cache.expires_at IS '过期时间，NULL表示永不过期';
COMMENT ON COLUMN external_resource_cache.metadata IS '元数据：API调用信息、响应时间等';

-- 创建部分索引：只索引有效的缓存（不使用NOW()函数）
CREATE INDEX IF NOT EXISTS idx_external_resource_cache_valid
  ON external_resource_cache(url, resource_type)
  WHERE status = 'success' AND expires_at IS NULL;
