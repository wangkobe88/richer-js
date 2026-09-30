-- ============================================================
-- news-monitor 建表脚本（news_monitor 项目收编进 richer-js，2026-09-30）
-- Supabase SQL Editor 一次执行。表结构原样继承独立项目 db.sql，
-- 仅两处适配：① RLS enable + 无 policy（service key only，richer-js 口径，
-- 不再建 anon full access）；② 30 天清理从 pg_cron 改为 daemon 每小时任务
-- （store.purgeOldEvents），本脚本不含 cron。
-- 表全局无 experiment 维度（同 wss_events 口径），不挂 CASCADE。
-- ⚠️ 部署红线：表必须先于新 web-server / news-daemon 重启存在。
-- 体量估算：88 账号过滤后约 1k-20k 行/天，content 裁剪后单行 0.5-2KB，
-- 30 天 < 300MB。
-- ============================================================

-- ============ watch_accounts（Sheet 镜像 + 同步状态） ============
create table if not exists public.watch_accounts (
  handle          text primary key,         -- 小写 handle（事件侧 join 键）
  handle_raw      text not null,            -- Sheet 原样大小写（调 6551 API 用）
  display_name    text,                     -- Sheet 名字列
  tier            text not null default 'normal' check (tier in ('core','normal')),
  in_watch_list   boolean not null default true,   -- 最近一次同步是否确认在服务端
  sheet_synced_at timestamptz,
  created_at      timestamptz not null default now()
);

-- ============ twitter_events（daemon 单写者） ============
create table if not exists public.twitter_events (
  id              bigserial primary key,    -- 单调游标：报告取材/分页全靠它
  source_event_id text unique,              -- 服务端 params.id，断线重推去重
  event_type      text not null,            -- NEW_TWEET / CA / ... 原枚举
  tw_account      text not null,            -- 小写 handle
  tw_user_name    text,
  tweet_id        text,                     -- 推文类事件取 content.id
  content         jsonb,                    -- 裁剪后（见 news-monitor/ingest.js trimContent）
  ca              text,
  is_core         boolean not null default false,
  event_time      timestamptz,              -- 服务端 createdAt；解析失败置 null
  created_at      timestamptz not null default now()
);
create index if not exists idx_events_account_id on public.twitter_events(tw_account, id desc);
-- 不建 created_at/event_time 索引：本模块按 id 游标，不做时间过滤大表

-- ============ hourly_reports（daemon 单写者，永久保留） ============
create table if not exists public.hourly_reports (
  id             bigserial primary key,
  window_start   timestamptz not null unique,  -- 幂等键：重试/并窗防重
  window_end     timestamptz not null,
  first_event_id bigint,                   -- 本报告覆盖的 id 区间（关联事件查询用）
  last_event_id  bigint,                   -- 也是下一窗的游标基准
  report_md      text not null,
  event_count    int not null default 0,
  llm_called     boolean not null default false,  -- 0 事件窗口不调 LLM
  model          text,
  input_tokens   int,
  output_tokens  int,
  created_at     timestamptz not null default now()
);

-- ============================================================
-- RLS：enable + 无 policy——仅 service key（dbManager）可读写，
-- anon 被静默过滤（richer-js 既有表口径）
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array['watch_accounts','twitter_events','hourly_reports']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
