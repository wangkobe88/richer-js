-- wallets 表多链支持 + 钱包画像字段
-- 1. 添加 chain 字段，修改唯一约束为 (address, chain)
-- 2. 添加 GMGN 钱包画像核心字段
-- 3. 添加 details JSONB 存储完整画像数据

-- Step 1: 添加 chain 字段（现有数据默认 bsc）
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS chain text NOT NULL DEFAULT 'bsc';

-- Step 2: 添加钱包画像字段
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}';
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS nickname varchar;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS twitter varchar;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS winrate numeric;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS realized_profit numeric;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS buy_count integer;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS sell_count integer;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS token_count integer;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS wallet_created_at timestamp with time zone;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS avg_holding_period integer;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS details jsonb DEFAULT '{}';
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();

-- Step 3: 修改唯一约束 (address) → (address, chain)
ALTER TABLE public.wallets DROP CONSTRAINT IF EXISTS wallets_address_key;
ALTER TABLE public.wallets ADD CONSTRAINT wallets_address_chain_key UNIQUE (address, chain);
