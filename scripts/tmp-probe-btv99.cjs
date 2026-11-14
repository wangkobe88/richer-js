// 一次性探针（182 跑）：查 bt-v 编号占用 + bt-v96 config 关键段
const { dbManager } = require('../src/services/dbManager.js');

(async () => {
  const c = await dbManager.getClient();
  const { data: names } = await c.from('experiments').select('id,experiment_name').like('experiment_name', 'bt-v9%').order('created_at', { ascending: false }).limit(8);
  console.log(names.map((n) => n.experiment_name.slice(0, 52)).join('\n'));
  const { data } = await c.from('experiments').select('config').eq('id', 'e582e873-7f1a-44a5-b50f-0fca576847be').limit(1);
  const cfg = data[0].config;
  const sc = cfg.strategiesConfig;
  console.log('---buyLegs:', sc.buyStrategies.length, 'sellLegs:', sc.sellStrategies.length);
  console.log('---t0:', sc.buyStrategies[0].condition);
  console.log('---t0gate:', JSON.stringify(sc.buyStrategies[0].signalGate));
  console.log('---buySignalMaxPerToken:', cfg.fourmemeWs.buySignalMaxPerToken, 'cooldownMs:', cfg.fourmemeWs.buySignalCooldownMs, 'cooldownTicks:', cfg.fourmemeWs.buySignalCooldownTicks);
  console.log('---signalGateReal:', cfg.backtest && cfg.backtest.signalGateReal);
  console.log('---cheatCheck:', JSON.stringify({ enabled: cfg.fourmemeWs.cheatCheck && cfg.fourmemeWs.cheatCheck.enabled, minTicks: cfg.fourmemeWs.cheatCheck && cfg.fourmemeWs.cheatCheck.minTicks, alwaysRecheck: cfg.fourmemeWs.cheatCheck && cfg.fourmemeWs.cheatCheck.gate && cfg.fourmemeWs.cheatCheck.gate.alwaysRecheck }));
  console.log('---buyPointCheck:', JSON.stringify({ enabled: cfg.fourmemeWs.buyPointCheck && cfg.fourmemeWs.buyPointCheck.enabled, minTicks: cfg.fourmemeWs.buyPointCheck && cfg.fourmemeWs.buyPointCheck.minTicks }));
  console.log('---sellConds:', sc.sellStrategies.map((l) => (l.condition || '').slice(0, 66)).join(' | '));
  console.log('---refs:', JSON.stringify((sc.libraryRefs || []).map((r) => r.name + ':v' + r.version)));
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
