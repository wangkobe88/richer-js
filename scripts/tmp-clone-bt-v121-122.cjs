// 一次性 clone（2026-11-15）：T141 首两波扩展门门控回测对（A/B 两窗）。
// 用户拍板形状「X=2s ∧ f0≥2」——扩展门串（v20 候选）：
//   AND ((launchBundleClusterSize < 3 AND (launchFirstBlockWallets < 2
//         OR launchFirstWaveWallets < 3)) OR tokenAgeSec > 60)
//   挡 = age<=60 ∧ (簇>=3 ∨ (f0>=2 ∧ wave>=3))；v19 簇臂 OR 叠加首两波臂。
//   ①bt-v121 = bt-v115 config 整包（A 窗原值不动）+ 14 买腿尾加扩展门串（A 门控臂）；
//   ②bt-v122 = bt-v115 config + B 窗四键（同 bt-v119 取值）+ 14 买腿尾加同款门串（B 门控臂）。
// 对照链：v121 vs v115 = 扩展门全效应（A 窗）；v122 vs v119 = 扩展门全效应（B 窗）；
//   与 v116/v120（v19 簇臂）差分 = 首两波臂单独效应。代码须含 6ba4562e（FA 新键）。
const { dbManager } = require('../src/services/dbManager.js');
const V115 = '34e78e97';
const GATE = ' AND ((launchBundleClusterSize < 3 AND (launchFirstBlockWallets < 2 OR launchFirstWaveWallets < 3)) OR tokenAgeSec > 60)';

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
  // A 窗原值（v121 不动）
  if (v115.config.backtest.startTime !== '2026-11-02T12:00:00Z'
    || v115.config.backtest.endTime !== '2026-11-03T14:58:49Z'
    || v115.config.backtest.sourceExperimentId !== '67803108-485a-4f1e-b300-a24061849d7d'
    || v115.config.backtest.maxTickRows !== 8000000)
    throw new Error('v115 回测段形状断言失败: ' + JSON.stringify(v115.config.backtest));

  // B 窗基线终态在（v119/v120 跑毕才克隆本对）
  const v119 = await loadFull(c, '883e2513', 'bt-v119-b-baseline-v116strat');
  const v120 = await loadFull(c, '415b4ea0', 'bt-v120-b-cluster-gate-v116strat');
  if (v120.config.strategiesConfig.buyStrategies[0].condition
    !== v119.config.strategiesConfig.buyStrategies[0].condition
      + ' AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)')
    throw new Error('v120 门串形状断言失败（尾加式）');

  const toB = (cfg) => {
    cfg.backtest.startTime = '2026-11-05T00:00:00Z';
    cfg.backtest.endTime = '2026-11-05T13:45:10Z';
    cfg.backtest.sourceExperimentId = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
    cfg.backtest.maxTickRows = 3000000;
  };
  const addGate = (cfg) => {
    let hits = 0;
    for (const l of cfg.strategiesConfig.buyStrategies) {
      if (!l.signalGate) throw new Error('非 signalGate 买腿存在');
      if (!l.condition || typeof l.condition !== 'string') throw new Error('买腿无 condition');
      if (l.condition.includes('launchBundleClusterSize')) throw new Error('已含簇键（源应为 v18 口径）');
      l.condition = l.condition + GATE;
      hits++;
    }
    if (hits !== 14) throw new Error('加门数断言失败: ' + hits);
  };

  const desc = '（2026-11-15 T141 首两波扩展门门控回测：v20 候选门串=簇臂 OR 叠加首两波臂「首块首买 f0>=2 ∧ 首块+≤2s 首个活跃块首买 wave>=3 ∧ age<=60 挡」，FA 新键 launchFirstBlockWallets/launchFirstWaveWallets 代码 6ba4562e；对照 v121 vs bt-v115 / v122 vs bt-v119，与 v116/v120 差分=首两波臂单独效应）';

  // ①bt-v121：A 门控（v115 config 原窗口 + 扩展门）
  await insert(c, v115, 'bt-v121-a-firstwave-gate',
    'bt-v121（2026-11-15 T141 首两波扩展门 A 窗门控臂）：bt-v115 config 整包+14 买腿尾加扩展门串，其余逐位不动（A 窗 11-02T12:00→11-03T14:58:49Z）。基线=bt-v115，唯一变量=扩展门（v19 簇臂+首两波臂）。' + desc,
    addGate);

  // ②bt-v122：B 门控（v115 config + B 窗四键 + 扩展门）
  await insert(c, v115, 'bt-v122-b-firstwave-gate',
    'bt-v122（2026-11-15 T141 首两波扩展门 B 窗门控臂）：bt-v115 config 整包+回测四键换 B 窗（11-05T00:00→13:45:10Z，源 c6efed13，与 bt-v119 逐位一致）+14 买腿尾加同款扩展门串。基线=bt-v119，唯一变量=扩展门。' + desc,
    (cfg) => { toB(cfg); addGate(cfg); });

  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
