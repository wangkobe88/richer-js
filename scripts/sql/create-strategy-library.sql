-- =====================================================================
-- strategy_library v2（策略库二期 / T202，2026-11-20 用户裁定「实验引擎策略
-- 唯一来源」改造）
--
-- 条目 = 完整交易策略包（definition jsonb）：买/卖腿（腿对象与引擎
-- strategyArray 元素同构，卡牌张数在腿上）+ stallClose（断流卖出）+
-- burstCooldown（冷盘卖出）+ modules（四检测模块版本键：factorCheck /
-- cheatCheck / actFrontGate / buyPointCheck——键在场=模块启用，值经代码侧
-- module-registry 解析为具体逻辑代次）。实验 config 只存顶层 strategyId，
-- 引擎启动查库解析（启动时取最新 version，用户裁定），解析结果写回
-- config.strategyResolved 审计。
--
-- v1→v2 迁移（不前向兼容，2026-11-20 用户裁定）：
--   * v1 的 side/legs 两列退役（DROP）；旧条目全部清除（DELETE——仅当
--     旧列还在场时执行一次，本文件幂等：迁移后重复执行零副作用）
--   * 存量旧实验（config 内嵌 strategiesConfig 腿）新引擎拒启 fail-fast；
--     实验行一律不动（红线：绝不删有数据的实验行）
--
-- 沿用 v1 设计裁定：name UNIQUE（人读维度，引用走 id）；version 乐观并发
-- （PUT 带 expectedVersion，不匹配 409，成功 +1）；空腿 fail-closed CHECK；
-- 全局表无 experiment 维度；RLS service_role-only。
--
-- ⚠️ 部署红线：本文件必须先于新 web-server / 引擎代码在 182 执行
--     （新 routes / 引擎 initialize 启动即查询 definition 列）。
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（幂等，可重复执行）。
-- =====================================================================

-- 1) 全新安装：直接建 v2 形状
CREATE TABLE IF NOT EXISTS strategy_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                     -- 人读名（UNIQUE；引用走 id）
  description text DEFAULT '',            -- 人读说明
  definition jsonb NOT NULL,              -- 策略包（买/卖腿+stallClose+burstCooldown+modules）
  version int NOT NULL DEFAULT 1,         -- 乐观并发计数（PUT 成功 +1）
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()    -- 代码维护，不建 trigger（对齐惯例）
);

-- 2) v1→v2 迁移：旧 side/legs 条目清除（仅当 v1 列在场时执行——幂等保护，
--    迁移完成后重复执行本文件不再触碰数据）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'strategy_library'
      AND column_name = 'legs'
  ) THEN
    DELETE FROM strategy_library;  -- 2026-11-20 用户裁定：策略库已有策略可清除
  END IF;
END $$;

-- 3) 列迁移：加 definition / 删 side+legs（幂等）
ALTER TABLE strategy_library ADD COLUMN IF NOT EXISTS definition jsonb;
ALTER TABLE strategy_library DROP COLUMN IF EXISTS side;
ALTER TABLE strategy_library DROP COLUMN IF EXISTS legs;
ALTER TABLE strategy_library ALTER COLUMN definition SET NOT NULL;

-- 4) definition 形状 CHECK（深层校验腿级规则在 StrategyLibraryService.validatePack；
--    此处只锁「对象 + 两侧腿非空数组」结构性下限）
ALTER TABLE strategy_library DROP CONSTRAINT IF EXISTS strategy_library_definition_shape;
ALTER TABLE strategy_library ADD CONSTRAINT strategy_library_definition_shape
  CHECK (jsonb_typeof(definition) = 'object'
    AND jsonb_typeof(definition->'buyLegs') = 'array'
    AND jsonb_array_length(definition->'buyLegs') > 0
    AND jsonb_typeof(definition->'sellLegs') = 'array'
    AND jsonb_array_length(definition->'sellLegs') > 0);

-- 5) 重名防线（沿用 v1）
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_library_name ON strategy_library(name);

-- 6) 服务端读写策略（沿用 v1：RLS service_role-only，routes/引擎一律走
--    dbManager.getClient() service key）
ALTER TABLE strategy_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON strategy_library;
CREATE POLICY service_all ON strategy_library
    FOR ALL TO service_role USING (true) WITH CHECK (true);
