// 一次性 clone（182 跑）：d345b → d345c（T170b 断流阈值全链对照实验）。
// 同窗同配置（36h win1012+ladder 十四腿+18 卖腿+signalGateReal 门链真调+T186 pumpArmHold），
// 唯改：stallClose.stallMs 40000 → 50000（T170b 追裁定「默认断流卖出时间改为 50 秒」）。
// 机制代码层（almost 90s/破发 180s 两档+currentVsFloorPct+断流上下文 metadata）由 182
// 现行代码 f2548323 自带——d345b 跑在旧 T170 60s 单档代码上，本对照=代码+配置双升级。
// 其余 config（factorSellFilter/门链/卡牌/止损）全部 bit 不动（脚本内断言）。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = 'c73b62be-bb1d-4acf-8002-652e5fb8a507'; // d345b

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  // 基底断言
  if (cfg.backtest.startTime !== '2026-10-12T00:00:00.000Z' || cfg.backtest.endTime !== '2026-10-13T12:00:00.000Z') {
    throw new Error('基底断言失败：窗口非预期');
  }
  if (!cfg.backtest.signalGateReal) throw new Error('基底断言失败：signalGateReal 未开');
  const sc = cfg.fourmemeWs?.stallClose ?? cfg.stallClose;
  if (!sc || sc.stallMs !== 40000 || sc.minTickBnb !== 0.01) {
    throw new Error('基底断言失败：stallClose 形状非预期 ' + JSON.stringify(sc));
  }
  if (cfg.fourmemeWs?.factorSellFilter?.enabled !== true) throw new Error('基底断言失败：factorSellFilter 未开');
  const buys = cfg.strategiesConfig.buyStrategies;
  const sells = cfg.strategiesConfig.sellStrategies;
  if (buys.length !== 14 || sells.length !== 18) throw new Error('基底断言失败：腿数 ' + buys.length + '/' + sells.length);
  const before = JSON.stringify({ buys, sells });

  // 唯一改动：stallMs 40000 → 50000
  sc.stallMs = 50000;
  if (sc.stallMs !== 50000) throw new Error('改写失败');
  // 改后断言：腿 bit 不动、无残留 40000
  if (JSON.stringify({ buys: cfg.strategiesConfig.buyStrategies, sells: cfg.strategiesConfig.sellStrategies }) !== before) {
    throw new Error('腿被意外改动');
  }

  cfg.name = 'd345c';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'd345c-t170b-stall50-36h-win1012',
    experiment_description: 'd345c（T170b 断流阈值全链对照，2026-11-18 用户实验）：基于 d345b（c73b62be）同窗 10-12T00:00~10-13T12:00（36h）同配置，唯改 stallClose.stallMs 40000→50000；机制代码由 182 现行 f2548323 提供（d345b 跑在旧 T170 60s 单档代码上）——本对照=代码两档化（almost 90s/破发 180s+currentVsFloorPct+断流上下文 metadata）+配置 50s 双升级。T186 pumpArmHold/factorSellFilter/门链/signalGateReal/300 万 maxTickRows 全部原样',
    trading_mode: 'backtest',
    strategy_type: e.strategy_type,
    blockchain: e.blockchain,
    kline_type: e.kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(ie.message);
  console.log('created:', row.id, row.experiment_name);
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
