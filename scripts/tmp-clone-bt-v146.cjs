// 一次性 clone（182 跑）：bt-v145 → bt-v146（10 月老架构数据 3h 冒烟）。
// 同配置（AF1 开+ladder 十四腿+18 卖腿+signalGateReal 门链真调），唯改窗口：
// 2026-10-08T10:00 ~ 13:00（10 月密度代表日 26.9 万 ticks/天的 3h 切片）。
// 冒烟目标=验证 10 月老采集架构数据（watcher 时代 sender 覆盖未知）在新门链
// （AF1/FP15/cheat/BP）下全链跑通；通过后切 36h 正式窗。
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
  cfg.backtest.startTime = '2026-10-08T10:00:00.000Z';
  cfg.backtest.endTime = '2026-10-08T13:00:00.000Z';
  cfg.name = 'bt-v146';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v146-af1-smoke-3h-win1008',
    experiment_description: 'bt-v146（2026-10-08 3h 冒烟，2026-11-18 切窗）：10 月老采集架构数据在 AF1/FP15/cheat/BP 新门链下全链跑通验证——窗口 10-08T10:00~13:00（密度代表日 26.9 万 ticks/天切片），config=bt-v145 原样（AF1 开+signalGateReal+300 万 maxTickRows）唯改窗口；通过后切 36h 正式窗（计划 10-12T00~10-13T12）',
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
