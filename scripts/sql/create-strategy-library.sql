-- =====================================================================
-- 新表：strategy_library（全局策略库，2026-09-28 用户裁定「腿集合包」粒度）
--
-- 参照 rich-js 交易策略管理架构的 richer-js 落地：条目 = 一组同侧腿
-- （「热桶卖侧 9 腿」「V2 买门」各成条目），实验创建页「从库引用」展开进
-- 表单，config 只存 libraryRefs 元数据（快照 copy-in 语义——运行零依赖
-- 本表，删除条目不影响已建实验）。
--
-- 设计裁定：
--   1. legs jsonb 形状 = strategiesConfig.buy/sellStrategies 数组元素同构
--      （含 condition/priority/cards/groups 等），展开=纯数组拼接零转换
--   2. name UNIQUE——人读维度，引用走 id（uuid 稳定）；重名插入显式失败
--   3. version 乐观并发：PUT 带 expectedVersion，不匹配 409；成功 +1
--   4. 空腿条目 fail-closed 拒绝（CHECK jsonb_array_length > 0）
--   5. 无 experiment 维度——全局表，DELETE 不级联任何实验数据
--
-- ⚠️ 部署红线：本表必须先于新 web-server 代码重启执行（新 routes 启动即查询）。
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（本文件幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS strategy_library (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                     -- 人读名（UNIQUE；引用走 id）
  description text DEFAULT '',            -- 人读说明
  side text NOT NULL CHECK (side IN ('buy', 'sell')),
  legs jsonb NOT NULL CHECK (jsonb_typeof(legs) = 'array' AND jsonb_array_length(legs) > 0),
  version int NOT NULL DEFAULT 1,         -- 乐观并发计数（PUT 成功 +1）
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()    -- 代码维护，不建 trigger（对齐惯例）
);

-- 重名防线（见头注 2）
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_library_name ON strategy_library(name);

-- 服务端读写策略（对齐 model_iteration_metrics 惯例；182 SERVICE_KEY=service_role。
-- ⚠️ 前端/anon key 不可读写——routes 一律走 dbManager.getClient() service key）
ALTER TABLE strategy_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_all ON strategy_library;
CREATE POLICY service_all ON strategy_library
    FOR ALL TO service_role USING (true) WITH CHECK (true);
