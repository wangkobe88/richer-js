// 一次性 clone（182 跑）：bt-v145 → bt-v147（10 月 36h 正式窗）。
// 同配置（AF1 开+ladder 十四腿+18 卖腿+signalGateReal 门链真调），唯改窗口：
// 2026-10-12T00:00 ~ 10-13T12:00（含最密日 10-12 的 32.9 万 ticks）。
// 冒烟已过（bt-v146 3h：419 信号/18 成交/净 +0.101/AF1 零故障）；本跑=36h 正式窗。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '2448116a-bebe-457d-9d8a-b4556c9a8e0d'; // bt-v145

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  if (cfg.fourmemeWs?.cheatCheck?.actFrontGate?.enabled !== true) throw new Error('基底断言失败：AF1 未开');
  if (!cfg.backtest?.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  cfg.backtest.startTime = '2026-10-12T00:00:00.000Z';
  cfg.backtest.endTime = '2026-10-13T12:00:00.000Z';
  cfg.name = 'bt-v147';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v147-af1-36h-win1012',
    experiment_description: 'bt-v147（10 月 36h 正式窗，2026-11-18 冒烟通过后切）：窗口 10-12T00:00~10-13T12:00（含最密日 10-12 32.9 万 ticks），config=bt-v145 原样（AF1 开+signalGateReal+300 万 maxTickRows）唯改窗口；冒烟=bt-v146 3h（419 信号/18 成交/净 +0.101/AF1 分流 130 零故障全链跑通）',
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
