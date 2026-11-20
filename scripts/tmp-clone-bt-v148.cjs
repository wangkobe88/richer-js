// 一次性 clone（182 跑）：bt-v147 → bt-v148（价格门收紧对照实验）。
// 同窗同配置（AF1 开+ladder v29 快照十四腿+18 卖腿+signalGateReal 门链真调，36h 窗 10-12T00:00~10-13T12:00），
// 唯改：买腿 condition 中 12 处 `currentVsLaunchPct <= 28.5` → `currentVsLaunchPct <= 0`
// （只买贴发行价/破发位；RL15 `<= 20`/RL10 `<= 10` 两臂按用户指令「其它保持不变」原样保留）。
// 卖腿 18 条、门链配置、窗口、卡牌、止损全部 bit 不动（脚本内断言）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '9b31baf4-bdd3-4ebb-9031-2a1603f34633'; // bt-v147

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  // 基底断言
  if (cfg.fourmemeWs?.cheatCheck?.actFrontGate?.enabled !== true) throw new Error('基底断言失败：AF1 未开');
  if (!cfg.backtest?.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  if (cfg.backtest.startTime !== '2026-10-12T00:00:00.000Z' || cfg.backtest.endTime !== '2026-10-13T12:00:00.000Z') {
    throw new Error('基底断言失败：窗口非预期 ' + cfg.backtest.startTime + '~' + cfg.backtest.endTime);
  }
  const buys = cfg.strategiesConfig.buyStrategies;
  const sells = cfg.strategiesConfig.sellStrategies;
  if (buys.length !== 14 || sells.length !== 18) throw new Error('基底断言失败：腿数 ' + buys.length + '/' + sells.length);
  const sellsBefore = JSON.stringify(sells);

  let changed = 0;
  for (const l of buys) {
    if (!l.condition.includes('currentVsLaunchPct <= 28.5')) continue;
    l.condition = l.condition.split('currentVsLaunchPct <= 28.5').join('currentVsLaunchPct <= 0');
    changed++;
  }
  if (changed !== 12) throw new Error('替换数非 12：' + changed);
  // RL15/RL10 两臂保持原样
  if (!buys[12].condition.includes('currentVsLaunchPct <= 20')) throw new Error('RL15 臂被动了？');
  if (!buys[13].condition.includes('currentVsLaunchPct <= 10')) throw new Error('RL10 臂被动了？');
  // 28.5 全清 + 改后臂全部含 <= 0
  for (const l of buys) {
    if (l.condition.includes('28.5')) throw new Error('残留 28.5：' + l.condition);
    if (l.condition.includes('currentVsLaunchPct <= 0') && l.condition.includes('currentVsLaunchPct <= 20')) {
      throw new Error('同腿双门异常');
    }
  }
  const zeroArms = buys.filter((l) => l.condition.includes('currentVsLaunchPct <= 0')).length;
  if (zeroArms !== 12) throw new Error('0 门臂数非 12：' + zeroArms);
  if (JSON.stringify(sells) !== sellsBefore) throw new Error('卖腿被改动');

  cfg.name = 'bt-v148';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v148-pricegate0-36h-win1012',
    experiment_description: 'bt-v148（价格门收紧对照，2026-11-18 用户实验）：基于 bt-v147（9b31baf4）同窗 10-12T00:00~10-13T12:00（36h）同配置，唯改 12 处买腿 `currentVsLaunchPct <= 28.5` → `<= 0`（只买贴发行价/破发位）；RL15 `<=20`/RL10 `<=10` 两臂及其余全部原样（含 AF1/cheat/BP/factorCheck 门链+signalGateReal+300 万 maxTickRows）。注意：腿为本地改写快照，非 strategy_library 快照（libraryRefs 仅 provenance 起点=v29 copy-in）',
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
