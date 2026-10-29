-- 禁止买入锁（token-returns 手动操作批，2026-10-29；与 add_manual_trade_cards_and_sell_lock.sql 同构）
--
-- manual_buy_locked（experiment_tokens）：per-token 禁止买入锁（web 写、引擎 2s 轮询读）。
--   true = 引擎一切自动买入（策略买腿/repeat-buy 再入场/叙事触发轮后续买点）全部拦截；
--   手动队列买入不受限（手动意志最高，与停止卖出锁同语义）。
--   不自动解除（清仓/换轮后残留=持续禁买正是语义，UI 🚫 徽章 + 恢复按钮保证可感知）。
--
-- nullable/DEFAULT（PG 不重写表），旧引擎/旧路由零破坏。

ALTER TABLE public.experiment_tokens ADD COLUMN IF NOT EXISTS manual_buy_locked boolean NOT NULL DEFAULT false;

-- 锁态刷新轮询支撑（每 2s 查 experiment_id=X AND manual_buy_locked=true）
CREATE INDEX IF NOT EXISTS idx_experiment_tokens_buy_lock
  ON public.experiment_tokens (experiment_id) WHERE manual_buy_locked;
