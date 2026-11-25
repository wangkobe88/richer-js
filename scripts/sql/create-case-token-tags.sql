-- =====================================================================
-- Case 代币标签表（2026-11-25 用户需求：给集合代币按性质粗略分类 + 核心信息
-- 整理与展示——标签可增删查，每个标签可用于查询）
--
-- 设计裁定（勿随意改动）：
--   1. 全局代币级（token_address 维度，不挂 collection）：标签=代币「性质」
--      本身，同一代币跨集合共享；从集合移除代币/删集合不级联删标签
--      （标签是人工整理的核心信息资产，与 ticks/events 副本快照性质不同）。
--   2. 不挂 FK（对齐 gmgn_wallet_profiles 画像库惯例）：标签可先于入集合打上
--      （先分类后入集）；孤儿标签无害——全局标签检索可见，重新入集合即恢复关联。
--   3. PRIMARY KEY (token_address, tag)：同票同标签幂等（重复添加无副作用）。
--   4. 标签归一化在代码侧（normalizeTag 纯函数：trim + 非空 + ≤40 字符 +
--      拒绝控制字符）；表不设 CHECK（对齐 case_collection_tokens 惯例，
--      校验纯函数可单测）。
--
-- ⚠️ 部署红线：本文件必须先于引用代码（case-collections routes/service）重启执行。
-- ⚠️ 执行方式：Supabase SQL Editor 整段执行（幂等，可重复执行）。
-- =====================================================================

CREATE TABLE IF NOT EXISTS case_token_tags (
  token_address text NOT NULL,          -- 小写地址（与 case_collection_tokens 口径一致）
  tag text NOT NULL,                    -- 标签（trim 后 ≤40 字符）
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (token_address, tag)
);

-- 按标签查询主形状（「每个标签可以用于查询」）
CREATE INDEX IF NOT EXISTS idx_case_token_tags_tag ON case_token_tags(tag);

-- ─────────────────────────────────────────────────────────────────────
-- RLS：service_role-only（对齐 case 四表；routes 一律 dbManager service key）
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE case_token_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON case_token_tags;
CREATE POLICY service_all ON case_token_tags
    FOR ALL TO service_role USING (true) WITH CHECK (true);
