// 一次性 clone（182 跑）：bt-v141 → bt-v143（含 T171/FP11 famous 极早快闪双支臂在内的
// 全量最新代码，换 23h 窗 11-03T15:00~11-04T14:00 再测——33h 窗不重跑省 Jev/时间）。
// 窗=bt-v129~v133 家族窗（cache 已在 182 win-20261103t150000000z_20261104t140000000z）。
// 其余 config 原样（ladder v28 十四腿+18 卖腿+factorSellFilter+门链全开）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '8a7b6b09-e2bc-4773-8393-a696821ff531'; // bt-v142
const WIN = { startTime: '2026-11-04T14:00:00.000Z', endTime: '2026-11-05T14:00:00.000Z' };

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  if (!cfg.fourmemeWs || !cfg.fourmemeWs.factorSellFilter || !cfg.fourmemeWs.factorSellFilter.enabled) throw new Error('基底断言失败：factorSellFilter 缺');
  if ((cfg.strategiesConfig.sellStrategies || []).length !== 18) throw new Error('基底断言失败：卖腿数≠18');
  if ((cfg.strategiesConfig.buyStrategies || []).length !== 14) throw new Error('基底断言失败：买腿数≠14');
  cfg.backtest.startTime = WIN.startTime;
  cfg.backtest.endTime = WIN.endTime;
  delete cfg.backtest.sourceExperimentId; // 纯窗口派生（若有残留清掉）
  cfg.name = 'bt-v143';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v143-all-changes-23h-win1103',
    experiment_description: 'bt-v143（2026-11-17 T171/FP11 famous 极早快闪双支臂（btv141 거침없이/SI 点名案）随全量代码换窗再测：23h 窗 11-03T15:00~11-04T14:00（bt-v129~v133 家族窗，cache 已在 182；33h 窗不重跑）。config=bt-v141 原样（ladder v28 十四腿+18 卖腿+factorSellFilter 全臂管辖+famous-trim/famous-entry v3/pump-imbalance v3+FP5~FP11 因子门+G19~G22/D3.72~D3.77），对照基线=bt-v133 同窗（T117 门链时代策略版，仅参考）',
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
  console.log('窗: ' + WIN.startTime + ' ~ ' + WIN.endTime + ' | 卖腿 18 | 买腿 14 | factorSellFilter=on');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
