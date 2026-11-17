// 一次性 clone（2026-11-14）：B 窗对照对换 v116 一致策略集重建。
// 用户裁定：bt-v117（v102 config 重跑）/bt-v118（v102 config+簇门）的卖腿是老策略集
// （裸 profitPercent > 100 切卡腿/GMGN 进场臂/low-zone-stall 臂/计数版 famous 臂/无
// peak-protect/无 KOL HOLD）——「肯定要用 aa8fb3b3（bt-v116）一致的交易策略」。
// v118 已停（stopped 留行），v117 completed 留档；重建对：
//   ①bt-v119 = bt-v115 config 整包克隆 + 回测四键换 B 窗（start/end/sourceExperimentId/
//     maxTickRows 取自 bt-v102 断言值）——策略集与 bt-v115/bt-v116 逐位一致（B 基线）；
//   ②bt-v120 = 同上 + 14 买腿加簇门（与 bt-v116 门串逐字一致）（B 门控臂）。
// 唯一变量链：v120 vs v119 = 簇门；v119 vs v116 = 窗口（策略集同）。
const { dbManager } = require('../src/services/dbManager.js');
const V115 = '34e78e97';
const GATE = ' AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)';

async function loadFull(c, prefix, name) {
  const { data, error } = await c.from('experiments').select('*').ilike('experiment_name', name + '%').limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (!e) throw new Error(name + ' 不存在');
  if (!e.id.startsWith(prefix)) throw new Error(name + ' id 前缀不符: ' + e.id);
  if (e.status !== 'completed') throw new Error(name + ' 非终态: ' + e.status);
  return e;
}

async function insert(c, src, name, desc, mutate) {
  const cfg = JSON.parse(JSON.stringify(src.config));
  if (mutate) mutate(cfg);
  const row = {
    id: crypto.randomUUID(),
    experiment_name: name,
    experiment_description: desc,
    trading_mode: 'backtest',
    strategy_type: src.strategy_type,
    blockchain: src.blockchain,
    kline_type: src.kline_type,
    status: 'stopped',
    config: cfg,
  };
  const { error: ie } = await c.from('experiments').insert(row);
  if (ie) throw new Error(name + ' insert 失败: ' + ie.message);
  console.log(name + ' NEW_ID=' + row.id);
}

async function main() {
  const c = await dbManager.getClient();

  const v115 = await loadFull(c, V115, 'bt-v115-t139-floor-delgmgn-hold180-v68base');
  const scV115 = v115.config.strategiesConfig;
  if (scV115.buyStrategies.length !== 14 || scV115.sellStrategies.length !== 16)
    throw new Error('v115 腿数断言失败');
  if (v115.config.backtest.signalGateReal !== true) throw new Error('v115 signalGateReal 断言失败');
  // A 窗原值（换前断言）
  if (v115.config.backtest.startTime !== '2026-11-02T12:00:00Z'
    || v115.config.backtest.endTime !== '2026-11-03T14:58:49Z'
    || v115.config.backtest.sourceExperimentId !== '67803108-485a-4f1e-b300-a24061849d7d'
    || v115.config.backtest.maxTickRows !== 8000000)
    throw new Error('v115 回测段形状断言失败: ' + JSON.stringify(v115.config.backtest));

  const v102 = await loadFull(c, 'c961a49d', 'bt-v102-BP74四步制-删收益50臂-买4卡');
  const bt = v102.config.backtest;
  // B 窗四键断言（取自 v102）
  if (bt.startTime !== '2026-11-05T00:00:00Z' || bt.endTime !== '2026-11-05T13:45:10Z'
    || bt.sourceExperimentId !== 'c6efed13-ce9d-41b0-89a5-8ca8b029a609' || bt.maxTickRows !== 3000000)
    throw new Error('v102 B 窗断言失败: ' + JSON.stringify(bt));

  // 买腿 condition 串对比（v115 vs v102）—— informational
  let same = 0, diff = 0;
  for (let i = 0; i < 14; i++) {
    const a = scV115.buyStrategies[i].condition, b = v102.config.strategiesConfig.buyStrategies[i].condition;
    if (a === b) same++; else { diff++; console.log('买腿[' + i + '] condition 不同:\n  v115: ' + a + '\n  v102: ' + b); }
  }
  console.log('买腿 condition 逐位一致 ' + same + '/14，不同 ' + diff);

  const toB = (cfg) => {
    cfg.backtest.startTime = bt.startTime;
    cfg.backtest.endTime = bt.endTime;
    cfg.backtest.sourceExperimentId = bt.sourceExperimentId;
    cfg.backtest.maxTickRows = bt.maxTickRows;
  };

  const stratDesc = '（2026-11-14 用户裁定 B 窗对照「肯定要用 aa8fb3b3（bt-v116）一致的交易策略」：bt-v117/v118 载体 v102 config 是老策略集——裸 profitPercent>100 切卡腿/GMGN 进场卖臂/low-zone-stall 臂/计数版 famous 臂/无 peak-protect/无 KOL HOLD；本对改用 bt-v115 config 整包（16 卖腿=KOL HOLD 臂+peak-protect+T136 金额门 famous 臂+删 GMGN/low-zone-stall 臂）仅换回测窗口四键（start/end/sourceExperimentId=c6efed13/maxTickRows=3000000 取自 bt-v102），策略集与 bt-v115/bt-v116 逐位一致；v117 completed/v118 stopped 留档不删）';

  // ①bt-v119：B 基线（v115 策略集 + B 窗）
  await insert(c, v115, 'bt-v119-b-baseline-v116strat',
    'bt-v119（2026-11-14 开盘簇×早入场口袋门 B 窗基线·v116 策略集）：bt-v115 config 整包克隆+回测四键换 B 窗（11-05T00:00→13:45:10Z，源 c6efed13），策略集与 bt-v116 逐位一致，唯一差异=窗口（A→B）。' + stratDesc,
    toB);

  // ②bt-v120：B 门控（同 + 簇门，与 v116 门串逐字一致）
  await insert(c, v115, 'bt-v120-b-cluster-gate-v116strat',
    'bt-v120（2026-11-14 开盘簇×早入场口袋门 B 窗门控臂·v116 策略集）：bt-v119 同源+14 买腿加簇门「 AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)」（与 bt-v116 逐字一致），其余逐位不动。基线=bt-v119，唯一变量=簇门。' + stratDesc,
    (cfg) => {
      toB(cfg);
      let hits = 0;
      for (const l of cfg.strategiesConfig.buyStrategies) {
        if (!l.signalGate) throw new Error('v120 非 signalGate 买腿存在');
        if (!l.condition || typeof l.condition !== 'string') throw new Error('v120 买腿无 condition');
        if (l.condition.includes('launchBundleClusterSize')) throw new Error('v120 已含簇键');
        l.condition = l.condition + GATE;
        hits++;
      }
      if (hits !== 14) throw new Error('v120 加门数断言失败: ' + hits);
    });

  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
