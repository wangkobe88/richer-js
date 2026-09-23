-- 批 3.3 名单因子：wallets.token_count（钱包参与 token 数）
-- 写入方：scripts/smart-wallet-mining/mine-smart-wallets.cjs --apply（入榜钱包 rawTotalRun；
--   upsert onConflict 'address,chain' 只更新送入列，未入榜既有行不受影响）
-- 消费方：FourMemeFactorAggregator.loadSniperWallets
--   （chain='bsc' AND token_count >= 50 → sniperHolderShare 因子原料，fail-closed null 语义）
-- 依赖：无（wallets 表已存在；本列后加，幂等可重跑）
-- Supabase SQL Editor 直接执行。
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS token_count INT;

-- 语义说明：已有行默认 NULL——NULL 不命中 >= 50（SQL 三值逻辑），名单为空 =
-- sniperHolderShare 恒 null = 引用键的门不放行（fail-closed 方向一致，无"缺数据放行"风险）。
