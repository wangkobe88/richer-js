// 一次性 clone（182 跑）：c73b62be（d345b-t186）→ bt-v154（T167c/FP19 全量代码对拍）。
// 同窗同配置 bit 不动（36h 10-12T00:00~10-13T12:00、门链全开、signalGateReal、300 万 maxTickRows），
// 唯一变量=代码层：182 最新 main（T167c/FP19 FP10 豁免最短冷却 10s + 其它会话已合入改动）。
// 腿为 copy-in 快照整包复制（11 买腿 cards:4 + 17 卖腿），libraryRefs 仅 provenance。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'c73b62be-bb1d-4acf-8002-652e5fb8a507'; // d345b-t186-pump-arm-default-hold

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  // 基底断言（bit 不动链）
  if (cfg.backtest?.startTime !== '2026-10-12T00:00:00.000Z' || cfg.backtest?.endTime !== '2026-10-13T12:00:00.000Z') {
    throw new Error('基底断言失败：窗口非预期 ' + cfg.backtest.startTime + '~' + cfg.backtest.endTime);
  }
  if (!cfg.backtest?.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  if (cfg.backtest?.maxTickRows !== 3000000) throw new Error('基底断言失败：maxTickRows=' + cfg.backtest?.maxTickRows);
  if (cfg.fourmemeWs?.buyPointCheck?.factorCheck?.enabled !== true) throw new Error('基底断言失败：factorCheck 未开');
  if (cfg.fourmemeWs?.cheatCheck?.enabled !== true) throw new Error('基底断言失败：cheatCheck 未开');
  if (cfg.fourmemeWs?.cheatCheck?.actFrontGate?.enabled !== true) throw new Error('基底断言失败：actFrontGate 未开');
  if (cfg.fourmemeWs?.factorSellFilter?.enabled !== true) throw new Error('基底断言失败：factorSellFilter 未开');
  const buys = cfg.strategiesConfig.buyStrategies;
  const sells = cfg.strategiesConfig.sellStrategies;
  if (buys.length !== 14 || sells.length !== 18) throw new Error('基底断言失败：腿数 ' + buys.length + '/' + sells.length);
  for (const l of buys) {
    if (l.cards !== 4) throw new Error('买腿 cards≠4：' + JSON.stringify(l.name || l.id));
    if (!l.signalGate) throw new Error('买腿缺 signalGate');
  }
  const cfgBefore = JSON.stringify({ ...cfg, name: undefined });
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v154-t167c-fp19-36h-win1012',
    experiment_description: 'bt-v154（T167c/FP19 代码层对拍，2026-11-19）：基于 c73b62be（d345b-t186）同窗 10-12T00:00~10-13T12:00（36h）同配置 bit 不动，唯一变量=代码层=182 最新 main：T167c/FP19（FP10 豁免最短冷却：破发豁免须距 famous 末卖 ≥10s——0x6075 苏琳案四张真空接刀止血、28ad dist=16s 精确保留）+ 并行会话已合入的其它改动。门链全开（factorCheck/actFront/cheat/BP+signalGateReal）+300 万 maxTickRows；腿为 copy-in 快照（libraryRefs 仅 provenance）',
    trading_mode: 'backtest',
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: { ...cfg, name: 'bt-v154' },
  };
  const after = JSON.stringify({ ...row.config, name: undefined });
  if (after !== cfgBefore) throw new Error('config 意外改动');
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('NEW_ID=' + row.id);
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
