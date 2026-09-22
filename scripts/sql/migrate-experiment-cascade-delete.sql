-- =====================================================================
-- 迁移：实验删除改为数据库层 FK ON DELETE CASCADE（对齐 pumpfun-wss-trader）
-- 删除 experiments 行即自动连带删除所有实验数据，应用层不再逐表清理。
--
-- ⚠️ 执行要求：
--   1. 等 2026-09-22 旧实验清理脚本（v3）跑完后再执行（大表已瘦身，FK 校验快）
--   2. 第 1 段的 CREATE INDEX CONCURRENTLY 不能在事务里跑 —— 在 Supabase SQL Editor
--      里逐条单独执行；第 2、3 段可整段执行
--   3. 执行完成后，web 端删除实验走纯级联路径（见 web-server.js DELETE /api/experiment/:id）
--
-- wss_price_ticks 已有 experiment_id → experiments(id) ON DELETE CASCADE（勿重复加），
-- 这里只补索引。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 第 1 段：experiment_id 索引（逐条单独执行；CONCURRENTLY 不锁写入）
-- ---------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_strategy_signals_experiment ON strategy_signals(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trades_experiment ON trades(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_token_holders_experiment ON token_holders(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_early_participant_trades_experiment ON early_participant_trades(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_events_experiment ON experiment_events(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_tokens_experiment ON experiment_tokens(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_portfolio_snapshots_experiment ON portfolio_snapshots(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_time_series_experiment ON experiment_time_series_data(experiment_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wss_price_ticks_experiment ON wss_price_ticks(experiment_id);

-- ---------------------------------------------------------------------
-- 第 2 段：清理历史孤儿行（此前 app 层删除漏删 experiment_events 等造成；
-- FK 建立要求子表无悬空 experiment_id）
-- ---------------------------------------------------------------------
DELETE FROM strategy_signals t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM trades t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM token_holders t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM early_participant_trades t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM experiment_events t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM experiment_tokens t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM portfolio_snapshots t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);
DELETE FROM experiment_time_series_data t WHERE t.experiment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.id = t.experiment_id);

-- ---------------------------------------------------------------------
-- 第 3 段：外键 ON DELETE CASCADE（幂等：已存在同名约束则跳过）
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_strategy_signals_experiment') THEN
    ALTER TABLE strategy_signals ADD CONSTRAINT fk_strategy_signals_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_trades_experiment') THEN
    ALTER TABLE trades ADD CONSTRAINT fk_trades_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_token_holders_experiment') THEN
    ALTER TABLE token_holders ADD CONSTRAINT fk_token_holders_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_early_participant_trades_experiment') THEN
    ALTER TABLE early_participant_trades ADD CONSTRAINT fk_early_participant_trades_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_experiment_events_experiment') THEN
    ALTER TABLE experiment_events ADD CONSTRAINT fk_experiment_events_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_experiment_tokens_experiment') THEN
    ALTER TABLE experiment_tokens ADD CONSTRAINT fk_experiment_tokens_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_portfolio_snapshots_experiment') THEN
    ALTER TABLE portfolio_snapshots ADD CONSTRAINT fk_portfolio_snapshots_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_experiment_time_series_experiment') THEN
    ALTER TABLE experiment_time_series_data ADD CONSTRAINT fk_experiment_time_series_experiment
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE;
  END IF;
END $$;
