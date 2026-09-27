/**
 * 实验工具 — 共享的 scope 实验选择函数
 *
 * 迁自 pumpfun-wss-trader（2026-09-27），供 step3（token profile）使用：
 * 返回最新的 N 个 virtual 实验，按 experiments.created_at 取，
 * 不依赖 model_iteration_metrics 的 old/new 链（richer-js 无此链）。
 */
'use strict';

/**
 * 获取本次需要处理的 scope 实验（最新 N 个 virtual 实验，默认 10）
 *
 * 按 experiments.created_at 倒序取最新 N 个 virtual 实验（含当前 running），返回从老到新排列的元数据数组。
 *
 * 设计（母版原味）：按 created_at 直接取对 clone/插入类操作鲁棒（不沿 old/new 链回溯），
 * 贴合"最新 N 个虚拟实验"的本意。trading_mode='virtual' 已排除 backtest/live。
 *
 * 与母版差异：+ `.order('id', { ascending: true })` 次序键——同毫秒 created_at 并列行需要
 * tiebreaker（ExperimentFactory.list :180 先例），否则并列行序不稳定。
 *
 * scope 默认 10：跨多实验的长生命周期代币（如闪崩段落在较早实验）需要更宽的合并窗口才能拿到
 * 完整 tick。注意窗口外已滚出的老 token 仍捞不到（step3 只处理 scope 内实验的 tick），需手工补救。
 * 可用环境变量 STEP3_SCOPE_LIMIT 调整（首跑实测耗时过长可调小）。
 *
 * @param {Object} sb Supabase 客户端
 * @param {number} [limit] 取最新几个实验（默认 STEP3_SCOPE_LIMIT || 10）
 * @returns {Promise<Array<{id:string, experiment_name:string, created_at:string}>>} 从老到新排列
 */
async function getScopeExperiments(sb, limit) {
  const n = limit || Number(process.env.STEP3_SCOPE_LIMIT) || 10;
  const { data, error } = await sb.from('experiments')
    .select('id, experiment_name, created_at')
    .eq('trading_mode', 'virtual')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(n);
  if (error) throw new Error(`查询 scope 实验失败: ${error.message}`);
  // 倒序取回（最新在前），反转为从老到新（step3 逐实验循环按时间升序处理）
  return (data || []).reverse();
}

module.exports = { getScopeExperiments };
