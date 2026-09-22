-- =====================================================================
-- 2026-09-22 一次性清理：删除 BSC-only 转向前的全部旧实验（虚拟/回测/live）
--
-- 范围：created_at < 572033ad-831e-4f60-9985-f6e4f63739c1（flap虚拟-复制 Phase7，
-- 创建于 2026-09-20T12:04:23.246181+00:00）的全部实验，含 5 个 live/solana。
-- 预期 24 行（此前应用层已删 7 个）；数据由 FK ON DELETE CASCADE 连带清除。
-- 这些实验不拥有任何 wss_price_ticks（归属实验已在第一轮删除，ticks 终值 82030）。
--
-- ⚠️ 前置：先执行 migrate-experiment-cascade-delete.sql（索引 + FK）。
-- 备份：182:/home/ubuntu/db-backups/pre-bsc-purge-20260922/（实验行 + ticks + live 交易）。
-- =====================================================================

-- 执行前先核对将删除的行（预期 24 行，全部为 solana/早期实验）：
SELECT id, experiment_name, trading_mode, blockchain, status, created_at
FROM experiments
WHERE created_at < '2026-09-20T12:04:23.246181+00:00'
ORDER BY created_at;

-- 确认无误后执行删除（级联清除所有子表数据）：
DELETE FROM experiments
WHERE created_at < '2026-09-20T12:04:23.246181+00:00';

-- 删除后校验（预期分别返回 0 行、13 行）：
SELECT count(*) AS remaining_old FROM experiments
WHERE created_at < '2026-09-20T12:04:23.246181+00:00';
SELECT count(*) AS total_experiments FROM experiments;
