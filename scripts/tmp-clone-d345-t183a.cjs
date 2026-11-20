// 一次性 clone（182 跑）：d345 → d345a（T183a AST 签名管辖修复对拍）。
// 同窗同配置 bit 不动（36h 窗 10-12T00:00~10-13T12:00+AF1+signalGateReal+18 卖腿），
// 唯一差异=182 已部署 T183a 修复（factor-sell-filter legConditionText 双形状 +
// StrategyEngine conditionText）——pump 臂签名管辖（pp<100 域）首次真正生效。
// 预期：熊二 P5（smart 2s）→ smart_hold 拦；狸花猫 P5（famous 29s）→ famous_hold
// 拦；BIBI/BNCBSI/熊翠花/大美 无 HOLD 证据仍放行（新臂未立）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'd3453504-03d5-480c-89e0-483db930361c';

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  // 基底断言（bit 不动）
  if (cfg.fourmemeWs?.factorSellFilter?.enabled !== true) throw new Error('基底断言失败：factorSellFilter 未开');
  if (!cfg.backtest?.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  if (cfg.backtest.startTime !== '2026-10-12T00:00:00.000Z' || cfg.backtest.endTime !== '2026-10-13T12:00:00.000Z') {
    throw new Error('基底断言失败：窗口非预期 ' + cfg.backtest.startTime + '~' + cfg.backtest.endTime);
  }
  const sells = cfg.strategiesConfig.sellStrategies;
  const buys = cfg.strategiesConfig.buyStrategies;
  if (buys.length !== 14 || sells.length !== 18) throw new Error('基底断言失败：腿数 ' + buys.length + '/' + sells.length);
  const p5 = sells.find((l) => (l.condition || '').includes('sinceEntryNetBuyRatio'));
  if (!p5) throw new Error('P5 泵失衡腿缺失');

  cfg.name = 'd345a-t183a';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'd345a-t183a-pump-signature-fix-parity',
    experiment_description: 'd345a（T183a 修复对拍，2026-11-18）：基于 d345（d3453504）同窗同配置 bit 不动，唯一差异=182 已部署 T183a（loadStrategies 腿对象 condition=AST 致 pump 臂签名管辖 typeof string 恒 false 从未生效的修复：conditionText 原文保留+legConditionText 双形状）。预期熊二/狸花猫 P5 被 smart_hold/famous_hold 拦截',
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
