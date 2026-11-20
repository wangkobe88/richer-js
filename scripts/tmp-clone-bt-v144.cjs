// 一次性 clone（182 跑）：bt-v143 → bt-v144（FP13 burst 弱波拦截线 A/B 对照）。
// 同窗同配置（23h win1103、ladder v28 十四腿+18 卖腿+门链全开），唯一差=FP13
// burst_weak_wave 臂（ccc43719 已 pull）；对照差=该臂净效应。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'e5941591-df22-4434-ae29-1a93ced0f841'; // bt-v143

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  if (!cfg.fourmemeWs?.buyPointCheck?.factorCheck?.enabled) throw new Error('基底断言失败：factorCheck 未开');
  if (!cfg.backtest?.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  if ((cfg.strategiesConfig.sellStrategies || []).length !== 18) throw new Error('基底断言失败：卖腿数≠18');
  if ((cfg.strategiesConfig.buyStrategies || []).length !== 14) throw new Error('基底断言失败：买腿数≠14');
  cfg.name = 'bt-v144';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v144-fp13-burst-weak-23h-win1103',
    experiment_description: 'bt-v144（2026-11-18 T173/FP13 burst 弱波拦截线 A/B：burst 语境 ∧ 波内无 ≥0.15 大户 ∧ 压箱 <1B → FP 门拒 burst_weak_wave；config=bt-v143 原样同窗 23h win1103（cache FRESH），唯一差=ccc43719 FP13 新臂；对照基线=bt-v143 同窗同配置）',
    trading_mode: 'backtest',
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
