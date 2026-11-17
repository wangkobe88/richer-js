// 一次性 clone（2026-11-15）：bt-v132 = bt-v131 同数据集（时间窗通道）重跑，唯一变量=代码
// 三修后（BP84 二修 PVP 纯买入侧 44fc02d9 + CD401/CD405 背景腿 bb6d3911）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*')
    .ilike('experiment_name', 'bt-v131-window-factor-prebuy-gate').limit(1);
  if (error || !data[0]) throw new Error('bt-v131 读取失败');
  if (!data[0].id.startsWith('f3dd5537') || data[0].status !== 'completed') throw new Error('bt-v131 形状断言失败');
  const cfg = JSON.parse(JSON.stringify(data[0].config));
  const b = cfg.backtest;
  if (b.sourceExperimentId !== undefined) throw new Error('应为时间窗通道');
  if (b.startTime !== '2026-11-03T15:00:00.000Z' || b.endTime !== '2026-11-04T14:00:00.000Z') throw new Error('窗口断言失败');
  if (!(cfg.fourmemeWs && cfg.fourmemeWs.buyPointCheck && cfg.fourmemeWs.buyPointCheck.factorCheck && cfg.fourmemeWs.buyPointCheck.factorCheck.enabled === true))
    throw new Error('factorCheck.enabled 断言失败');
  const TAIL = 'tokenAgeSec > 60 OR launchConstVsPct <= 0)';
  for (const l of cfg.strategiesConfig.buyStrategies) if (!l.condition.endsWith(TAIL)) throw new Error('v21 门串断言失败');
  if (cfg.strategiesConfig.sellStrategies.length !== 16) throw new Error('卖腿数断言失败');

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v132-window-factor-prebuy-v2',
    experiment_description: 'bt-v132（2026-11-15 T143 三修后重跑）：bt-v131 config 逐位克隆（同数据集=时间范围通道 [11-03T15:00Z→11-04T14:00Z] 无 sourceExperimentId+factorCheck.enabled=true），唯一变量=代码三修——①BP84 二修 PVP 纯买入侧单一等式（44fc02d9，承接轴/在场三分删除：Go Brrrrr 39s 蓄势静默 zero_absorption 误伤修）+②CD401/CD405 背景活跃度腿两臂同加（bb6d3911，burst 语境前提=背景低/中：Go Brrrrr 08:42:17 CD401 误拦修+高活跃盘喘息不构成沉积语境）。用户指令「重新回测，只回测最新数据集（f3dd5537 使用的数据集）」。预期：Go Brrrrr（+0.2783 v129 冠军）两误拦点全解除救回、PVP 拒因域收敛 pvp_no_big_participation 单码、CD401/405 命中面收缩。',
    trading_mode: 'backtest',
    strategy_type: data[0].strategy_type,
    blockchain: data[0].blockchain,
    kline_type: data[0].kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v132 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
