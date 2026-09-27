-- token_narrative 加 token_category 列（2026-09-27 用户裁定：代币分类作为叙事分析的输出落库）
--
-- 值域：
--   project / account_based_meme / web3_native_ip_early —— prestage Jev 前置判定（代币类型）
--   super_ip_fast                                —— 超大 IP 快速通道（prestage 同位承载）
--   event:A ~ event:W                            —— 标准路径 Jev 事件类别（骑乘/热点/产品发布等）
--   NULL                                         —— precheck fail / no_data（未走到分类环节）
--
-- ⚠️ 部署顺序红线（同 gmgn_info 先例）：本列必须先于进程重启执行——
--    NarrativeRepository.save 在有分类判定时会写该键，列缺失时全链路 upsert PGRST204。
--
-- 历史行不回填（新分析自然写入）；如需回填用下方可选段（先抽查值域再跑）。

ALTER TABLE token_narrative ADD COLUMN IF NOT EXISTS token_category text;

COMMENT ON COLUMN token_narrative.token_category IS
  '代币分类（叙事分析输出）：project/account_based_meme/web3_native_ip_early/super_ip_fast/event:A~W；precheck fail 未分类为 NULL';

-- ═══════════════════════════════════════════════════════════════════════════
-- 可选：历史行回填（从既有 JSON 提取；建议先跑下方抽查查询确认值域后再执行）
-- ═══════════════════════════════════════════════════════════════════════════

-- 抽查（只读）：
--   SELECT prestage_result->>'category' AS p, COUNT(*)
--   FROM token_narrative WHERE prestage_result IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
--   SELECT stage1_result->'details'->'eventClassification'->>'primaryCategory' AS c, COUNT(*)
--   FROM token_narrative WHERE stage1_result IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;

-- 回填（prestage 值域白名单 + 标准 event 类别；幂等可重跑）：
-- UPDATE token_narrative SET token_category = COALESCE(
--   CASE WHEN prestage_result->>'category' IN
--     ('project','account_based_meme','web3_native_ip_early','super_ip_fast')
--     THEN prestage_result->>'category' END,
--   'event:' || (stage1_result->'details'->'eventClassification'->>'primaryCategory')
-- )
-- WHERE token_category IS NULL
--   AND (
--     prestage_result->>'category' IN
--       ('project','account_based_meme','web3_native_ip_early','super_ip_fast')
--     OR stage1_result->'details'->'eventClassification'->>'primaryCategory' IS NOT NULL
--   );
