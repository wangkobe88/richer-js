// v130 config/factorCheck 诊断（182 跑）
const { dbManager } = require('../src/services/dbManager.js');

async function main() {
  const c = await dbManager.getClient();
  const { data } = await c.from('experiments').select('config,name:experiment_name').eq('id', 'f927e187-b726-4001-98e1-cfce09e66ea5');
  const cfg = data[0].config;
  console.log('name:', data[0].name);
  console.log('fourmemeWs.buyPointCheck:', JSON.stringify(cfg.fourmemeWs && cfg.fourmemeWs.buyPointCheck));
  console.log('signalGateReal:', cfg.backtest && cfg.backtest.signalGateReal);
  // 本地复刻 service 构造
  const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService.js');
  const _wsCfg = cfg.fourmemeWs || {};
  const svc = new BuyPointCheckService({ ...(_wsCfg.buyPointCheck || {}), persist: false, settleDelayMs: 0 }, { info() {}, warn() {}, error() {} }, {});
  console.log('复刻构造 factorEnabled:', svc.factorEnabled, '/ enabled:', svc.enabled);
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
