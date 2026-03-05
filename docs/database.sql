-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.admin_operation_logs (
  id integer NOT NULL DEFAULT nextval('admin_operation_logs_id_seq'::regclass),
  wallet_address character varying NOT NULL,
  operation_type character varying NOT NULL,
  operation_details jsonb,
  ip_address character varying,
  user_agent text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT admin_operation_logs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.admin_wallets (
  id integer NOT NULL DEFAULT nextval('admin_wallets_id_seq'::regclass),
  wallet_address character varying NOT NULL UNIQUE,
  admin_level character varying DEFAULT 'admin'::character varying,
  admin_name character varying,
  created_at timestamp without time zone DEFAULT now(),
  updated_at timestamp without time zone DEFAULT now(),
  is_active boolean DEFAULT true,
  last_login_at timestamp without time zone,
  login_count integer DEFAULT 0,
  CONSTRAINT admin_wallets_pkey PRIMARY KEY (id)
);
CREATE TABLE public.analysis_cache (
  id bigint NOT NULL DEFAULT nextval('analysis_cache_id_seq'::regclass),
  token_address text NOT NULL,
  chain_id text NOT NULL,
  language text NOT NULL CHECK (language = ANY (ARRAY['English'::text, 'Chinese'::text])),
  step_name text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analysis_cache_pkey PRIMARY KEY (id)
);
CREATE TABLE public.analysis_cache_test (
  id bigint NOT NULL DEFAULT nextval('analysis_cache_id_seq'::regclass),
  token_address text NOT NULL,
  chain_id text NOT NULL,
  language text NOT NULL CHECK (language = ANY (ARRAY['English'::text, 'Chinese'::text])),
  step_name text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT analysis_cache_test_pkey PRIMARY KEY (id)
);
CREATE TABLE public.analysis_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  token_address text NOT NULL,
  chain_id text NOT NULL,
  language text NOT NULL,
  status text NOT NULL,
  error_message text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  source text,
  CONSTRAINT analysis_tasks_pkey PRIMARY KEY (id)
);
CREATE TABLE public.analysis_tasks_test (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  token_address text NOT NULL,
  chain_id text NOT NULL,
  language text NOT NULL,
  status text NOT NULL,
  error_message text,
  created_at timestamp with time zone NOT NULL,
  updated_at timestamp with time zone NOT NULL,
  source text,
  CONSTRAINT analysis_tasks_test_pkey PRIMARY KEY (id)
);
CREATE TABLE public.experiment_time_series_data (
  id bigint NOT NULL DEFAULT nextval('experiment_time_series_data_id_seq'::regclass),
  experiment_id uuid NOT NULL,
  token_address character varying NOT NULL,
  token_symbol character varying NOT NULL,
  timestamp timestamp with time zone NOT NULL,
  loop_count integer NOT NULL,
  price_usd numeric,
  price_native numeric,
  factor_values jsonb,
  signal_type character varying,
  signal_executed boolean,
  execution_reason character varying,
  blockchain character varying,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT experiment_time_series_data_pkey PRIMARY KEY (id)
);
CREATE TABLE public.experiment_tokens (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  experiment_id uuid NOT NULL,
  token_address text NOT NULL,
  token_symbol text,
  blockchain text NOT NULL,
  discovered_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'monitoring'::text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  raw_api_data jsonb,
  contract_risk_raw_ave_data jsonb,
  creator_address text,
  current_price_usd numeric,
  price_updated_at timestamp with time zone,
  platform character varying DEFAULT 'fourmeme'::character varying,
  analysis_results jsonb,
  human_judges jsonb,
  CONSTRAINT experiment_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT experiment_tokens_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(id)
);
CREATE TABLE public.experiments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_name character varying NOT NULL,
  experiment_description text,
  status character varying NOT NULL DEFAULT 'initializing'::character varying,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  trading_mode character varying NOT NULL CHECK (trading_mode::text = ANY (ARRAY['virtual'::character varying, 'live'::character varying, 'backtest'::character varying]::text[])),
  strategy_type character varying NOT NULL DEFAULT 'fourmeme_earlyreturn'::character varying,
  blockchain character varying NOT NULL DEFAULT 'bsc'::character varying,
  kline_type character varying NOT NULL DEFAULT '1m'::character varying,
  started_at timestamp with time zone,
  stopped_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT experiments_pkey PRIMARY KEY (id)
);
CREATE TABLE public.membership_permissions (
  id integer NOT NULL DEFAULT nextval('membership_permissions_id_seq'::regclass),
  user_id integer NOT NULL,
  membership_type character varying NOT NULL,
  information_level character varying NOT NULL,
  daily_analysisTimes integer NOT NULL DEFAULT 0,
  total_analysisTimes integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  daily_analysisTimes_quota integer NOT NULL DEFAULT 0,
  total_analysisTimes_quota integer NOT NULL DEFAULT 0,
  CONSTRAINT membership_permissions_pkey PRIMARY KEY (id),
  CONSTRAINT membership_permissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_wallets(id)
);
CREATE TABLE public.membership_plans (
  id integer NOT NULL DEFAULT nextval('membership_plans_id_seq'::regclass),
  type character varying NOT NULL UNIQUE,
  cost bigint NOT NULL,
  information_level character varying NOT NULL,
  daily_analysisTimes integer NOT NULL DEFAULT 0,
  total_analysisTimes integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT membership_plans_pkey PRIMARY KEY (id)
);
CREATE TABLE public.messages (
  chain text NOT NULL,
  message_id bigint NOT NULL,
  date timestamp with time zone,
  text text,
  media_path text,
  text_json jsonb,
  token_address text,
  CONSTRAINT messages_pkey PRIMARY KEY (chain, message_id)
);
CREATE TABLE public.payment_transactions (
  id integer NOT NULL DEFAULT nextval('payment_transactions_id_seq'::regclass),
  user_wallet_address character varying NOT NULL,
  payment_type character varying NOT NULL CHECK (payment_type::text = ANY (ARRAY['sol'::character varying, 'spl'::character varying]::text[])),
  amount numeric NOT NULL,
  token_address character varying,
  target_wallet character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['pending'::character varying, 'completed'::character varying, 'failed'::character varying]::text[])),
  transaction_signature character varying,
  created_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT payment_transactions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.portfolio_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL,
  snapshot_time timestamp with time zone NOT NULL,
  total_value numeric DEFAULT 0,
  total_value_change numeric DEFAULT 0,
  total_value_change_percent numeric DEFAULT 0,
  cash_balance numeric DEFAULT 0,
  cash_native_balance numeric DEFAULT 0,
  total_portfolio_value_native numeric DEFAULT 0,
  token_positions jsonb DEFAULT '[]'::jsonb,
  positions_count integer DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT portfolio_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT fk_experiment_portfolio_snapshots FOREIGN KEY (experiment_id) REFERENCES public.experiments(id)
);
CREATE TABLE public.recharge_record (
  id integer NOT NULL DEFAULT nextval('recharge_record_id_seq'::regclass),
  signature character varying NOT NULL UNIQUE,
  from_address character varying NOT NULL,
  to_address character varying NOT NULL,
  value bigint NOT NULL,
  verify boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT recharge_record_pkey PRIMARY KEY (id)
);
CREATE TABLE public.strategy_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL,
  token_address character varying NOT NULL,
  token_symbol character varying,
  chain character varying,
  signal_type character varying NOT NULL CHECK (signal_type::text = ANY (ARRAY['BUY'::character varying, 'SELL'::character varying]::text[])),
  action character varying NOT NULL CHECK (action::text = ANY (ARRAY['buy'::character varying, 'sell'::character varying, 'hold'::character varying]::text[])),
  confidence numeric,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  executed boolean,
  CONSTRAINT strategy_signals_pkey PRIMARY KEY (id),
  CONSTRAINT fk_experiment_signals FOREIGN KEY (experiment_id) REFERENCES public.experiments(id)
);
CREATE TABLE public.telegram_group_tiers (
  rank integer NOT NULL,
  group_name text NOT NULL,
  score numeric NOT NULL,
  latest_recommendations integer NOT NULL,
  activity_tier character NOT NULL,
  activity_tier_description text NOT NULL,
  score_efficiency numeric NOT NULL,
  quality_tier character NOT NULL,
  quality_tier_description text NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT telegram_group_tiers_pkey PRIMARY KEY (rank)
);
CREATE TABLE public.token_analysis (
  id bigint NOT NULL DEFAULT nextval('token_analysis_id_seq'::regclass),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  token_address text NOT NULL,
  chain_id text NOT NULL,
  market_data jsonb,
  twitter_data jsonb,
  llm_analysis_data jsonb,
  price_usd numeric,
  market_cap_usd numeric,
  volume_24h_usd numeric,
  liquidity_usd numeric,
  twitter_followers_count integer,
  hours_since_last_tweet numeric,
  last_tweet_time timestamp with time zone,
  categories ARRAY,
  score numeric,
  score_breakdown jsonb,
  analysis_version text,
  analysis_language text DEFAULT 'Chinese'::text,
  error_log jsonb,
  twitter_handle text,
  website text,
  market_data_updated_at timestamp with time zone,
  twitter_data_updated_at timestamp with time zone,
  llm_analysis_data_updated_at timestamp with time zone,
  CONSTRAINT token_analysis_pkey PRIMARY KEY (id)
);
CREATE TABLE public.token_holders (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  token_address text NOT NULL,
  experiment_id text,
  holder_data jsonb NOT NULL,
  checked_at timestamp without time zone DEFAULT now(),
  snapshot_id text,
  created_at timestamp without time zone DEFAULT now(),
  CONSTRAINT token_holders_pkey PRIMARY KEY (id)
);
CREATE TABLE public.token_positions (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  token_address text NOT NULL,
  entry_price numeric NOT NULL,
  entry_amount numeric NOT NULL,
  entry_time timestamp with time zone NOT NULL,
  token_amount numeric NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['active'::text, 'closed'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  token_symbol text,
  CONSTRAINT token_positions_pkey PRIMARY KEY (id)
);
CREATE TABLE public.token_trades (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  position_id bigint,
  token_address text NOT NULL,
  trade_type text NOT NULL CHECK (trade_type = ANY (ARRAY['buy'::text, 'sell'::text])),
  price numeric NOT NULL,
  amount_usd numeric NOT NULL,
  token_amount numeric NOT NULL,
  pnl numeric,
  trade_time timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  token_symbol text,
  CONSTRAINT token_trades_pkey PRIMARY KEY (id),
  CONSTRAINT token_trades_position_id_fkey FOREIGN KEY (position_id) REFERENCES public.token_positions(id)
);
CREATE TABLE public.tokens (
  chain text NOT NULL,
  token_symbol text,
  contract text NOT NULL,
  message_id bigint,
  market_cap numeric,
  market_cap_formatted text,
  first_market_cap numeric,
  promotion_count integer,
  likes_count integer,
  telegram_url text,
  twitter_url text,
  website_url text,
  latest_update timestamp with time zone,
  first_update timestamp with time zone,
  name text,
  description text,
  image text,
  holders integer,
  top_holders jsonb,
  CONSTRAINT tokens_pkey PRIMARY KEY (chain, contract)
);
CREATE TABLE public.trades (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL,
  token_symbol character varying NOT NULL,
  token_address character varying NOT NULL,
  token_id character varying,
  trade_direction character varying NOT NULL CHECK (trade_direction::text = ANY (ARRAY['buy'::character varying, 'sell'::character varying]::text[])),
  trade_status character varying DEFAULT 'pending'::character varying,
  input_currency character varying NOT NULL,
  output_currency character varying NOT NULL,
  input_amount numeric NOT NULL,
  output_amount numeric,
  unit_price numeric,
  success boolean DEFAULT false,
  is_virtual_trade boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  executed_at timestamp with time zone,
  signal_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT trades_pkey PRIMARY KEY (id),
  CONSTRAINT trades_experiment_id_fkey FOREIGN KEY (experiment_id) REFERENCES public.experiments(id),
  CONSTRAINT trades_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.strategy_signals(id)
);
CREATE TABLE public.twitter_account_analysis (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  twitter_handle text NOT NULL,
  quality_score integer,
  metrics jsonb,
  factors jsonb,
  reasoning text,
  timestamp timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT twitter_account_analysis_pkey PRIMARY KEY (id)
);
CREATE TABLE public.twitter_accounts (
  id integer NOT NULL DEFAULT nextval('twitter_accounts_id_seq'::regclass),
  twitter_url text,
  twitter_name text,
  twitter_id text UNIQUE,
  ecosystem text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  twitter_account text,
  twitter_type text,
  level integer,
  description text,
  CONSTRAINT twitter_accounts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.twitter_accounts_duplicate (
  id integer NOT NULL DEFAULT nextval('twitter_accounts_id_seq'::regclass),
  twitter_url text,
  twitter_name text,
  twitter_id text UNIQUE,
  ecosystem text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  twitter_account text,
  twitter_type text,
  level integer,
  description text,
  CONSTRAINT twitter_accounts_duplicate_pkey PRIMARY KEY (id)
);
CREATE TABLE public.txs (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  account text NOT NULL,
  token_in_address text NOT NULL,
  token_in_amount numeric NOT NULL,
  token_out_address text NOT NULL,
  token_out_amount numeric NOT NULL,
  timestamp bigint NOT NULL,
  signature text NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  source text,
  CONSTRAINT txs_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_wallets (
  id integer NOT NULL DEFAULT nextval('user_wallets_id_seq'::regclass),
  wallet_address character varying NOT NULL UNIQUE,
  is_member boolean DEFAULT false,
  membership_expiry_date timestamp with time zone,
  nickname character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_wallets_pkey PRIMARY KEY (id)
);
CREATE TABLE public.wallet_holdings (
  address text NOT NULL,
  total_tokens integer NOT NULL,
  last_updated timestamp with time zone NOT NULL,
  raw_data jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT wallet_holdings_pkey PRIMARY KEY (address)
);
CREATE TABLE public.wallet_profiles (
  wallet_address text NOT NULL,
  blockchain text NOT NULL DEFAULT 'bsc'::text,
  total_participations integer DEFAULT 0,
  early_trade_count integer DEFAULT 0,
  holder_count integer DEFAULT 0,
  categories jsonb DEFAULT '{}'::jsonb,
  dominant_category text,
  tokens jsonb DEFAULT '[]'::jsonb,
  label text,
  label_confidence numeric,
  label_reason text,
  synced boolean DEFAULT false,
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT wallet_profiles_pkey PRIMARY KEY (wallet_address, blockchain)
);
CREATE TABLE public.wallets (
  id integer NOT NULL DEFAULT nextval('wallets_id_seq'::regclass),
  address text NOT NULL UNIQUE,
  name text,
  category character varying,
  CONSTRAINT wallets_pkey PRIMARY KEY (id)
);
CREATE TABLE public.web3_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  timestamp timestamp with time zone NOT NULL,
  type character varying NOT NULL CHECK (type::text = ANY (ARRAY['key_finding'::character varying, 'trend'::character varying, 'opportunity'::character varying, 'risk'::character varying]::text[])),
  title text NOT NULL,
  description text,
  importance integer CHECK (importance >= 1 AND importance <= 5),
  source text,
  tags ARRAY,
  relative_tweets ARRAY,
  raw_analysis text,
  created_at timestamp with time zone DEFAULT now(),
  ecosystem text,
  related_projects text,
  CONSTRAINT web3_insights_pkey PRIMARY KEY (id)
);