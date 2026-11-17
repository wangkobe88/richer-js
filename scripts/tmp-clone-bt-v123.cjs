// 一次性 clone（2026-11-15）：bt-v123 = bt-v122 config 逐位克隆重跑（B 窗首两波扩展门门控臂）。
// 原因：v122（631bd2c2）跑于 TypeSafe 402 billing_error 窗口——458/889 信号 bp_gate_fail
//   （BP 门 jev_error fail-closed 拒），executed 仅 17，B 窗证据无效；充值后重跑。
// v122 行保留不删（污染实验留行，删否由用户裁定）。config 逐位不动（含扩展门串+库快照 copy-in）。
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*')
    .ilike('experiment_name', 'bt-v122-b-firstwave-gate%').limit(1);
  if (error) throw new Error(error.message);
  const v122 = data[0];
  if (!v122) throw new Error('bt-v122 不存在');
  if (!v122.id.startsWith('631bd2c2')) throw new Error('v122 id 前缀不符: ' + v122.id);
  if (v122.status !== 'completed') throw new Error('v122 非终态: ' + v122.status);

  const cfg = JSON.parse(JSON.stringify(v122.config));
  // 形状断言：B 窗四键 + 扩展门串在全部 14 买腿尾部
  if (cfg.backtest.startTime !== '2026-11-05T00:00:00Z'
    || cfg.backtest.endTime !== '2026-11-05T13:45:10Z'
    || cfg.backtest.sourceExperimentId !== 'c6efed13-ce9d-41b0-89a5-8ca8b029a609'
    || cfg.backtest.signalGateReal !== true)
    throw new Error('回测段形状断言失败: ' + JSON.stringify(cfg.backtest));
  const GATE = ' AND ((launchBundleClusterSize < 3 AND (launchFirstBlockWallets < 2 OR launchFirstWaveWallets < 3)) OR tokenAgeSec > 60)';
  let hits = 0;
  for (const l of cfg.strategiesConfig.buyStrategies) {
    if (!l.condition || !l.condition.endsWith(GATE))
      throw new Error('买腿门串断言失败: ' + (l.name || l.id));
    hits++;
  }
  if (hits !== 14 || cfg.strategiesConfig.sellStrategies.length !== 16)
    throw new Error('腿数断言失败: ' + hits + '/' + cfg.strategiesConfig.sellStrategies.length);

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v123-b-firstwave-gate-rerun',
    experiment_description: 'bt-v123（2026-11-15 B 窗首两波扩展门重跑）：bt-v122 config 逐位克隆。v122 原跑撞 TypeSafe 402 billing_error 窗口（458/889 信号 bp_gate_fail、executed 仅 17 vs v119 51/v120 40）=无效跑，行保留；充值后本跑为干净对照。基线=bt-v119（883e2513）/簇臂=bt-v120（415b4ea0），唯一变量=扩展门（v19 簇臂 OR 首两波臂「f0>=2 ∧ wave>=3 ∧ age<=60 挡」），与 A 窗 bt-v121 合并裁定 v20。',
    trading_mode: 'backtest',
    strategy_type: v122.strategy_type,
    blockchain: v122.blockchain,
    kline_type: v122.kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error('insert 失败: ' + ie.message);
  console.log('bt-v123 NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
