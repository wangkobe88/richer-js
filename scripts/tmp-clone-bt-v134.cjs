// 一次性 clone（2026-11-15）：bt-v134 = bt-v133（FP2 全门链）新窗口回测。
// 窗口选择：[11-02T06:00Z → 11-03T14:59:59Z] ≈33h——可用数据（11-02T06→11-05T14）里
// 与 D 窗（11-03T15→11-04T14，v129/132/133 已测）零重叠的最长完整段；token_create
// 密度充足（逐小时 137~834）。A 窗（v115/116/121）虽时段重叠但从未跑过 FP2 门链。
const { dbManager } = require('../src/services/dbManager.js');
async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').ilike('experiment_name', 'bt-v133-window-act-gate-fp2').limit(1);
  if (error || !data[0]) throw new Error('bt-v133 读取失败');
  if (!data[0].id.startsWith('550f9e89') || data[0].status !== 'completed') throw new Error('bt-v133 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  if (cfg.backtest.sourceExperimentId !== undefined) throw new Error('应为时间窗通道');
  if (!(cfg.fourmemeWs?.buyPointCheck?.factorCheck?.enabled === true)) throw new Error('factorCheck 断言失败');
  cfg.backtest.startTime = '2026-11-02T06:00:00.000Z';
  cfg.backtest.endTime = '2026-11-03T14:59:59.000Z';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v134-window-fp2-early33h',
    experiment_description: 'bt-v134（2026-11-15 T144 后新窗验证）：bt-v133 config 逐位克隆（FP2 全门链=因子门 PVP 纯买入侧+act low/ultra+CD 四臂背景腿+BP68 三题），唯一变量=窗口 [11-02T06:00Z→11-03T14:59:59Z] ≈33h——与 D 窗（11-03T15→11-04T14，v133 已测）零重叠的最长可用段（数据池 11-02T06→11-05T14）；A 窗时段虽与 v115/v116/v121 重叠但从未跑过 FP2 门链。用户指令「再找一个时间窗口，回测 550f9e89 的交易策略」。',
    trading_mode: 'backtest', strategy_type: data[0].strategy_type, blockchain: data[0].blockchain, kline_type: data[0].kline_type, status: 'stopped', config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v134 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
