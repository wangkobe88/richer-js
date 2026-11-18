// 一次性 clone（182 跑）：bt-v151 → bt-v152（SI-5 在场腿对照）。
// 同窗同配置（smart-inflow-relay v1 独立纯净），唯改=FA T184 判据加在场腿（git 同步的代码侧变化，config 零改动）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'f7f21986-48dd-48c5-8aa0-1bd30c4b7903'; // bt-v151
async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  if (cfg.backtest.startTime !== '2026-10-12T00:00:00.000Z' || cfg.backtest.endTime !== '2026-10-13T12:00:00.000Z') throw new Error('基底断言失败：窗口');
  if (cfg.strategiesConfig.buyStrategies.length !== 1 || cfg.strategiesConfig.sellStrategies.length !== 1) throw new Error('基底断言失败：腿数非 1+1？');
  if (cfg.strategiesConfig.buyStrategies[0].condition !== 'smartInflowReady == 1') throw new Error('基底断言失败：买腿条件');
  cfg.name = 'bt-v152';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v152-smart-inflow-relay1-presence-36h-win1012',
    experiment_description: 'bt-v152（SI-5 在场腿对照，2026-11-18 用户语义修正「连续入场=前者仍持仓时后者明知接盘」）：基于 bt-v151 同窗同配置零改动，唯改=FA T184 事件判据加在场腿（链尾首买时刻前序实体净持仓 ≥首买×5%，已清仓=链断；代码侧 commit 同步）。预期=事件 151→~110、胜率↑（研究口径 81→59 票 43%→47%）；对照 bt-v151 +2.1607B/39.07%',
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
