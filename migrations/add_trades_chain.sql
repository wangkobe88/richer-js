-- trades 表多链支持：添加 chain 字段
-- 现有数据默认 bsc

ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'bsc';
