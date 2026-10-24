-- token_narrative 列名重构（2026-10-24，叙事 DB 适配批次 B1）
--
-- 旧三阶段生成式管线列名 → 当前评估链语义（事件判定 → 事件评分 → 关系+代币 → 终局）。
-- RENAME = 纯元数据操作：历史 39,329 行数据原位零迁移，历史行以新列名照常可读。
--
-- ⚠️ 执行窗口纪律（与代码切换原子同步）：
--   1. 新代码须已 push 且 182 已 pull（跑中进程内存旧代码+DB 旧列名=兼容）
--   2. 执行前停 narrative worker（live 引擎是否同停由用户裁定——不停则窗口内
--      旧代码写旧列名报 PGRST204 fail-loud，无静默风险但分析中断）
--   3. 本件与 add_token_narrative_projection_columns.sql 同批一次执行
--   4. 起新代码 worker；回滚=反向 RENAME + 代码 revert
--
-- jev_prompt/jev_raw_output = Jev 完整输入输出单份真源（原 stage1_*）；
-- legacy_* 四列 = 旧管线时代三段独立 LLM 调用的真输出（历史保留，新行停写——
-- 停写的只是新行冗余拷贝，Jev 响应完整保留在 jev_raw_output）。
-- pre_check_result / prestage_result / prestage_prompt / prestage_raw_output
-- 名字已语义化不动。

BEGIN;

ALTER TABLE public.token_narrative RENAME COLUMN stage1_result      TO event_result;
ALTER TABLE public.token_narrative RENAME COLUMN stage2_result      TO event_score_result;
ALTER TABLE public.token_narrative RENAME COLUMN stage3_result      TO relation_result;
ALTER TABLE public.token_narrative RENAME COLUMN stage_final_result TO final_result;
ALTER TABLE public.token_narrative RENAME COLUMN stage1_prompt      TO jev_prompt;
ALTER TABLE public.token_narrative RENAME COLUMN stage1_raw_output  TO jev_raw_output;
ALTER TABLE public.token_narrative RENAME COLUMN stage2_prompt      TO legacy_stage2_prompt;
ALTER TABLE public.token_narrative RENAME COLUMN stage3_prompt      TO legacy_stage3_prompt;
ALTER TABLE public.token_narrative RENAME COLUMN stage2_raw_output  TO legacy_stage2_raw_output;
ALTER TABLE public.token_narrative RENAME COLUMN stage3_raw_output  TO legacy_stage3_raw_output;

COMMENT ON COLUMN public.token_narrative.event_result IS '事件判定：分类 A~W/影响力档/时效/改道审计（原 stage1_result）';
COMMENT ON COLUMN public.token_narrative.event_score_result IS '事件评分：契合分/W 数学/量级门/蓝筹去重拦截（原 stage2_result）';
COMMENT ON COLUMN public.token_narrative.relation_result IS '关系+代币段：relevance/quality/总分聚合/名字门豁免审计（原 stage3_result）';
COMMENT ON COLUMN public.token_narrative.final_result IS '终局信封 rating/score/details（原 stage_final_result）';
COMMENT ON COLUMN public.token_narrative.jev_prompt IS 'Jev 标准调用完整输入（原 stage1_prompt）';
COMMENT ON COLUMN public.token_narrative.jev_raw_output IS 'Jev 标准调用完整响应（原 stage1_raw_output）';
COMMENT ON COLUMN public.token_narrative.legacy_stage2_prompt IS '旧管线遗留（新行停写）';
COMMENT ON COLUMN public.token_narrative.legacy_stage3_prompt IS '旧管线遗留（新行停写）';
COMMENT ON COLUMN public.token_narrative.legacy_stage2_raw_output IS '旧管线时代=独立调用真输出（新行停写）';
COMMENT ON COLUMN public.token_narrative.legacy_stage3_raw_output IS '旧管线时代=独立调用真输出（新行停写）';

COMMIT;
