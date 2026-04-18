-- 实验事件监控表
-- 存储实验引擎产生的重要事件（买入/卖出信号等），替代 Telegram 通知

create table public.experiment_events (
  id uuid not null default gen_random_uuid(),
  experiment_id text not null,
  experiment_name text,
  experiment_mode text,              -- 'virtual' / 'live'
  token_address text not null,
  token_symbol text,
  action text not null,              -- 'buy' / 'sell' / 自定义事件类型
  executed boolean not null default false,
  chain text default 'bsc',
  created_at timestamp with time zone not null default now(),

  -- 事件摘要（结构化数字，便于筛选和卡片展示）
  summary jsonb default '{}',
  -- 示例内容（买入信号场景）：
  -- {
  --   "signalIndex": 3,
  --   "marketCap": 1500000,
  --   "earlyReturn": 95.5,
  --   "profitPercent": 32.1,
  --   "holdDuration": 3600000,
  --   "narrativeRating": "high",
  --   "narrativeNumericRating": 3,
  --   "narrativeScore": 7.8,
  --   "cards": "all"
  -- }

  -- 事件详情（文本/结构化信息，用于展开查看）
  details jsonb default '{}',
  -- 示例内容（买入信号场景）：
  -- {
  --   "narrativeReason": "...",
  --   "stageSummaries": { ... },
  --   "executionReason": "Pre-buy check rejected: ...",
  --   "gmgnUrl": "https://gmgn.ai/...",
  --   "signalsUrl": "http://localhost:3010/..."
  -- }

  constraint experiment_events_pkey primary key (id)
);

-- 按创建时间倒序查询（监控页面主查询）
create index idx_experiment_events_created_at on public.experiment_events (created_at desc);
-- 按实验ID筛选
create index idx_experiment_events_experiment_id on public.experiment_events (experiment_id);
-- GIN 索引支持 JSONB 内字段查询
create index idx_experiment_events_summary on public.experiment_events using gin (summary);

-- === Supabase Realtime 配置 ===
-- 1. 开启 RLS（Postgres Changes 要求）
alter table public.experiment_events enable row level security;
-- 2. 允许 anon 角色读取和写入
create policy "Allow anonymous read" on public.experiment_events for select to anon using (true);
create policy "Allow anonymous insert" on public.experiment_events for insert to anon with check (true);
-- 3. 将表加入 Realtime 发布
alter publication supabase_realtime add table public.experiment_events;
