// 一次性 clone（2026-11-14）：bt-v114 → bt-v115（T139 恢复滚动地板后的对照回测）：
//   用户指令「回退后，再次回测一下，记得 realHoldDuration >= 180 AND gmgnEntryChecked == 1
//   AND gmgnEntryPresent == 0 删除，sinceLastFamousBigBuySec > 120 改为
//   sinceLastFamousBigBuySec > 180」。三个变量：
//   ① 182 代码 f9ee93d2 = T139（撤销 T138 恒常量回退，launch 锚恢复 T134 完整滚动地板
//      min(常量,首买,滚动最低)）——bt-v114（132 票 +1.5848）跑在 c37ab2ee（恒常量口径）
//      上，本跑即 T134 口径 A/B 对照；
//   ② config：删 T116 GMGN 进场验证卖腿（realHoldDuration >= 180 AND
//      gmgnEntryChecked == 1 AND gmgnEntryPresent == 0，priority 6）——17 卖腿 → 16；
//   ③ config：T137 KOL HOLD 释放窗 120 → 180（sinceLastFamousBigBuySec > 120 → > 180，
//      5 条 HOLD 释放腿全量替换——用户此前「下次再调整」的挂账本次落地）。
//   其余（14 买腿/窗口/门链/HOLD 腿结构）逐位复制 bt-v114。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '685c9518-27eb-4be1-ac4c-764dc488a5f6'; // bt-v114

async function main() {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.status !== 'completed') throw new Error('bt-v114 非终态: ' + e.status);
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;
  // 断言：bt-v114 形状（删臂版 17 卖腿 / 14 买腿 / 窗口与门链不变）
  if (sc.sellStrategies.length !== 17) throw new Error(`卖腿数断言失败：${sc.sellStrategies.length}`);
  if (sc.buyStrategies.length !== 14) throw new Error(`买腿数断言失败：${sc.buyStrategies.length}`);
  if (cfg.backtest.signalGateReal !== true || cfg.backtest.sourceExperimentId !== '67803108-485a-4f1e-b300-a24061849d7d')
    throw new Error('回测段断言失败');
  if (cfg.backtest.startTime !== '2026-11-02T12:00:00Z' || cfg.backtest.maxTickRows !== 8000000)
    throw new Error('窗口断言失败');

  // ② 删 T116 GMGN 进场验证卖腿（恰好 1 条）
  const gmgnLegs = sc.sellStrategies.filter((l) =>
    (l.condition || '').includes('gmgnEntryChecked == 1') && (l.condition || '').includes('gmgnEntryPresent == 0'));
  if (gmgnLegs.length !== 1) throw new Error(`gmgn-entry 腿数断言失败：${gmgnLegs.length}`);
  sc.sellStrategies = sc.sellStrategies.filter((l) => !gmgnLegs.includes(l));

  // ③ HOLD 释放窗 120 → 180（恰好 5 条腿命中）
  let holdHits = 0;
  for (const l of sc.sellStrategies) {
    if ((l.condition || '').includes('sinceLastFamousBigBuySec > 120')) {
      l.condition = l.condition.split('sinceLastFamousBigBuySec > 120').join('sinceLastFamousBigBuySec > 180');
      holdHits++;
    }
  }
  if (holdHits !== 5) throw new Error(`HOLD 120→180 替换数断言失败：${holdHits}`);
  if (sc.sellStrategies.some((l) => (l.condition || '').includes('sinceLastFamousBigBuySec > 120')))
    throw new Error('残留 120 断言失败');
  if (sc.sellStrategies.length !== 16) throw new Error(`删腿后卖腿数断言失败：${sc.sellStrategies.length}`);

  cfg.description = 'bt-v115（2026-11-14 用户指令「回退后，再次回测一下，记得 realHoldDuration >= 180 AND gmgnEntryChecked == 1 AND gmgnEntryPresent == 0 删除，sinceLastFamousBigBuySec > 120 改为 sinceLastFamousBigBuySec > 180」）：bt-v114 克隆，三变量=①182 代码 f9ee93d2 T139（撤销 T138 恒常量回退，launch 锚恢复 T134 完整滚动地板 min(常量,首买,滚动最低)——bt-v114 132 票 +1.5848 即恒常量口径对照行，本跑为 T134 口径 A/B）；②删 T116 GMGN 进场验证卖臂（17→16 卖腿）；③T137 KOL HOLD 释放窗 120→180（5 条 HOLD 释放腿全量）。其余逐位复制 bt-v114。对照链：bt-v111（91 票 +1.1366）→bt-v113（94 票 +1.1827）→bt-v114（132 票 +1.5848，c37ab2ee 恒常量）→bt-v115（本跑）。';

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v115-t139-floor-delgmgn-hold180-v68base',
    experiment_description: cfg.description,
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
