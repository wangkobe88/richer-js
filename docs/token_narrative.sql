create table public.token_narrative (
  id uuid not null default gen_random_uuid (),
  token_address text not null,
  token_symbol text null,
  platform text null,
  blockchain text null,
  raw_api_data jsonb null,
  extracted_info jsonb null,
  twitter_info jsonb null,
  prompt_version text null default 'V9.0'::text,
  is_valid boolean null default true,
  created_at timestamp with time zone null default now(),
  analyzed_at timestamp with time zone null,
  experiment_id text null,
  prompt_type text null,
  analysis_stage integer null,
  classified_urls jsonb null,

  -- ====== 分析结果（统一 *_result 格式） ======

  -- 预检查结果（规则引擎，无LLM）
  pre_check_result jsonb null,

  -- Prestage LLM（账号/社区分析）
  prestage_result jsonb null,
  prestage_prompt text null,
  prestage_raw_output text null,

  -- Stage 1 LLM（事件预处理）
  stage1_result jsonb null,
  stage1_prompt text null,
  stage1_raw_output text null,

  -- Stage 2 LLM（分类评分）
  stage2_result jsonb null,
  stage2_prompt text null,
  stage2_raw_output text null,

  -- Stage 3 LLM（代币分析）
  stage3_result jsonb null,
  stage3_prompt text null,
  stage3_raw_output text null,

  -- 最终算分（代码聚合）
  stage_final_result jsonb null,

  -- ====== Debug/支持字段 ======
  data_fetch_results jsonb null,
  url_extraction_result jsonb null,
  task_id uuid null,

  constraint token_narrative_pkey primary key (id),
  constraint token_narrative_address_unique unique (token_address),
  constraint token_narrative_task_id_fkey foreign KEY (task_id) references narrative_analysis_tasks (id)
) TABLESPACE pg_default;

-- ====== 索引 ======

create index IF not exists idx_token_narrative_analysis_stage on public.token_narrative using btree (analysis_stage) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_symbol on public.token_narrative using btree (token_symbol) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_created_at on public.token_narrative using btree (created_at desc) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_address_experiment on public.token_narrative using btree (token_address, experiment_id) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_experiment_id on public.token_narrative using btree (experiment_id) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_prompt_type on public.token_narrative using btree (prompt_type) TABLESPACE pg_default;

-- JSONB GIN 索引
create index IF not exists idx_token_narrative_pre_check_result on public.token_narrative using gin (pre_check_result) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_prestage_result on public.token_narrative using gin (prestage_result) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_stage1_result on public.token_narrative using gin (stage1_result) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_stage2_result on public.token_narrative using gin (stage2_result) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_stage3_result on public.token_narrative using gin (stage3_result) TABLESPACE pg_default;

-- 最终评级快速查询
create index IF not exists idx_token_narrative_final_rating on public.token_narrative using btree ((stage_final_result->>'rating')) TABLESPACE pg_default;

-- Debug 索引
create index IF not exists idx_token_narrative_data_fetch on public.token_narrative using gin (data_fetch_results) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_url_extraction on public.token_narrative using gin (url_extraction_result) TABLESPACE pg_default;
create index IF not exists idx_token_narrative_task_id on public.token_narrative using btree (task_id) TABLESPACE pg_default;
