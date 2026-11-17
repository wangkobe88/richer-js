// 一次性 clone（2026-11-15）：C 窗三臂——bt-v124 基线（bt-v119 config）/bt-v125 簇臂（bt-v120）
// /bt-v126 扩展门（bt-v123），唯一替换=backtest 窗口三键换 C 窗源 v72（edbd5b38）：
//   [2026-11-04T14:00:00Z → 2026-11-04T23:59:59Z]（≈10h，与 A 窗 11-02T12→11-03T15 /
//   B 窗 11-05T00→13:45 零重叠）；signalGateReal/maxTickRows 3000000 原样。
// v72=11-04 时段唯一长覆盖源（13:42→11-05T04:26 both 接力采集，flap 2592/fourmeme 716 token）。
const { dbManager } = require('../src/services/dbManager.js');

const C_WIN = {
  startTime: '2026-11-04T14:00:00Z',
  endTime: '2026-11-04T23:59:59Z',
  sourceExperimentId: 'edbd5b38-27db-4dd4-8205-4bebfa410ea6',
};
const GATE_V19 = ' AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)';
const GATE_V20 = ' AND ((launchBundleClusterSize < 3 AND (launchFirstBlockWallets < 2 OR launchFirstWaveWallets < 3)) OR tokenAgeSec > 60)';
const B_WIN = { startTime: '2026-11-05T00:00:00Z', endTime: '2026-11-05T13:45:10Z', sourceExperimentId: 'c6efed13-ce9d-41b0-89a5-8ca8b029a609' };

async function loadCfg(c, prefix, name) {
  const { data, error } = await c.from('experiments').select('*').ilike('experiment_name', name + '%').limit(1);
  if (error || !data[0]) throw new Error(name + ' 读取失败');
  if (!data[0].id.startsWith(prefix)) throw new Error(name + ' 前缀不符: ' + data[0].id);
  if (data[0].status !== 'completed') throw new Error(name + ' 非终态: ' + data[0].status);
  return { cfg: JSON.parse(JSON.stringify(data[0].config)), meta: data[0] };
}

function assertBWindow(cfg, tag) {
  const b = cfg.backtest;
  if (b.startTime !== B_WIN.startTime || b.endTime !== B_WIN.endTime
    || b.sourceExperimentId !== B_WIN.sourceExperimentId || b.signalGateReal !== true)
    throw new Error(tag + ' 回测段形状断言失败: ' + JSON.stringify({ s: b.startTime, e: b.endTime, src: b.sourceExperimentId, sgr: b.signalGateReal }));
  if (b.maxTickRows !== 3000000) throw new Error(tag + ' maxTickRows 异常: ' + b.maxTickRows);
}

function assertLegs(cfg, tag, gateTail) {
  const buys = cfg.strategiesConfig.buyStrategies;
  if (buys.length !== 14 || cfg.strategiesConfig.sellStrategies.length !== 16)
    throw new Error(tag + ' 腿数断言失败: ' + buys.length + '/' + cfg.strategiesConfig.sellStrategies.length);
  for (const l of buys) {
    if (gateTail === null) {
      if (l.condition.includes('launchBundleClusterSize')) throw new Error(tag + ' 基线不应带门串: ' + (l.name || l.id));
    } else if (!l.condition.endsWith(gateTail)) {
      throw new Error(tag + ' 门串断言失败: ' + (l.name || l.id));
    }
  }
}

async function main() {
  const c = await dbManager.getClient();
  const srcs = {
    base: await loadCfg(c, '883e2513', 'bt-v119-b-baseline-v116strat'),
    clu: await loadCfg(c, '415b4ea0', 'bt-v120-b-cluster-gate-v116strat'),
    ext: await loadCfg(c, 'f454a704', 'bt-v123-b-firstwave-gate-rerun'),
  };
  assertBWindow(srcs.base.cfg, 'v119'); assertBWindow(srcs.clu.cfg, 'v120'); assertBWindow(srcs.ext.cfg, 'v123');
  assertLegs(srcs.base.cfg, 'v119', null);
  assertLegs(srcs.clu.cfg, 'v120', GATE_V19);
  assertLegs(srcs.ext.cfg, 'v123', GATE_V20);

  const defs = [
    ['bt-v124-c-baseline-v116strat', srcs.base, null,
      'bt-v124（2026-11-15 C 窗基线=无门）：bt-v119 config 逐位克隆，仅换回测窗口三键——源 v72（edbd5b38，11-04 时段唯一长覆盖 both 采集）、窗 [11-04T14:00→23:59:59Z] ≈10h，与 A 窗（11-02T12→11-03T15）/B 窗（11-05T00→13:45）零重叠。C 窗三臂对照：v124 基线/v125 簇臂（v19）/v126 扩展门（v20），同码 2d31f6c4 同策略集唯一变量=门串，验证 v20 立法在新时段的泛化。'],
    ['bt-v125-c-cluster-gate-v116strat', srcs.clu, GATE_V19,
      'bt-v125（2026-11-15 C 窗簇臂=v19 门）：bt-v120 config 逐位克隆，仅换回测窗口三键（源 v72 edbd5b38、窗 11-04T14:00→23:59:59Z）；14 买腿尾簇门串与库 v19 逐字一致。C 窗三臂中段。'],
    ['bt-v126-c-firstwave-gate', srcs.ext, GATE_V20,
      'bt-v126（2026-11-15 C 窗扩展门=v20 门）：bt-v123 config 逐位克隆，仅换回测窗口三键（源 v72 edbd5b38、窗 11-04T14:00→23:59:59Z）；14 买腿尾首两波扩展门串与库 v20 逐字一致（T141 立法后首轮全新窗口验证）。'],
  ];
  for (const [name, { cfg, meta }, gateTail, desc] of defs) {
    const row = {
      id: crypto.randomUUID(),
      experiment_name: name,
      experiment_description: desc,
      trading_mode: 'backtest',
      strategy_type: meta.strategy_type,
      blockchain: meta.blockchain,
      kline_type: meta.kline_type,
      status: 'stopped',
      config: (() => { const c2 = JSON.parse(JSON.stringify(cfg)); Object.assign(c2.backtest, C_WIN); return c2; })(),
    };
    // 装载后自检：窗口三键已换、门串形状保持
    assertLegs(row.config, name, gateTail);
    if (row.config.backtest.startTime !== C_WIN.startTime || row.config.backtest.sourceExperimentId !== C_WIN.sourceExperimentId)
      throw new Error(name + ' 窗口替换失败');
    const { error: ie } = await c.from('experiments').insert(row);
    if (ie) throw new Error(name + ' insert 失败: ' + ie.message);
    console.log(name + ' NEW_ID=' + row.id);
  }
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
