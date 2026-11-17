// 一次性 clone（2026-11-14）：开盘捆绑簇×早入场口袋门回测验证（三实验一批）：
//   背景=bt-v113/bt-v102 双窗因子分析发现「launchBundleClusterSize>=3 ∧ tokenAgeSec<=60」
//   口袋两窗稳定同负（A −0.144 n=29 / B −0.535 n=29）、其余三格全正、剔除面零肥尾
//   （max +0.12/+0.10）、网格簇3~6×age30~60 全负非刀锋——首个通过跨窗检验的候选门。
//   用户指令「好，回测下」。门串=「 AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)」
//   （簇在场时禁 60s 内触发；簇键空/空窗恒 0 非 null，异常 null→<3 恒 false=fail-closed；
//   preFilter age 提取对 OR 臂含非 age 比较→整组不贡献约束，原 age 区间不动，已核源码）。
//   三个新实验（182 代码 f9ee93d2=T139，与 bt-v115 同码）：
//   ①bt-v116 = bt-v115 config + 14 买腿加簇门（A 门控臂；基线=bt-v115 103 票 +1.5532 现成）；
//   ②bt-v117 = bt-v102 config 逐位不动（B 基线重跑——v102 原跑在 11-11 旧代码，
//     其后 CD400-407/BP77-83/T134-T139 均动买决策，对照必须同码）；
//   ③bt-v118 = bt-v102 config + 14 买腿加簇门（B 门控臂）。
//   B 载体选 v102 非 v110：B 窗口袋 29 张 −0.535 几乎全在 v102（v110 仅 8 张 +0.005 平）。
const { dbManager } = require('../src/services/dbManager.js');
const V115 = '34e78e97'; // 前缀——运行时补全校验
const GATE = ' AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)';

async function loadFull(c, prefix, name) {
  // 按名字取行（id 只知前缀，宁按名取再断言前缀）
  const { data, error } = await c.from('experiments').select('*').ilike('experiment_name', name + '%').limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (!e) throw new Error(name + ' 不存在');
  if (!e.id.startsWith(prefix)) throw new Error(name + ' id 前缀不符: ' + e.id);
  if (e.status !== 'completed') throw new Error(name + ' 非终态: ' + e.status);
  return e;
}

function assertBtShape(cfg, win, rows, src, sellN) {
  const sc = cfg.strategiesConfig;
  if (!sc || sc.buyStrategies.length !== 14) throw new Error('买腿数断言失败: ' + (sc && sc.buyStrategies.length));
  if (sc.sellStrategies.length !== sellN) throw new Error('卖腿数断言失败: ' + sc.sellStrategies.length);
  if (cfg.backtest.signalGateReal !== true || cfg.backtest.sourceExperimentId !== src) throw new Error('回测段断言失败');
  if (cfg.backtest.startTime !== win.start || cfg.backtest.endTime !== win.end || cfg.backtest.maxTickRows !== rows)
    throw new Error('窗口断言失败: ' + JSON.stringify(cfg.backtest));
}

function addGate(sc, label) {
  let hits = 0;
  for (const l of sc.buyStrategies) {
    if (!l.signalGate) throw new Error(label + ' 非 signalGate 买腿存在: ' + (l.name || l.id));
    if (!l.condition || typeof l.condition !== 'string') throw new Error(label + ' 买腿无 condition 字符串');
    if (l.condition.includes('launchBundleClusterSize')) throw new Error(label + ' 已含簇键（防重复追加）');
    l.condition = l.condition + GATE;
    hits++;
  }
  if (hits !== 14) throw new Error(label + ' 加门数断言失败: ' + hits);
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
  assertBtShape(v115.config, { start: '2026-11-02T12:00:00Z', end: '2026-11-03T14:58:49Z' }, 8000000,
    '67803108-485a-4f1e-b300-a24061849d7d', 16);

  const v102 = await loadFull(c, 'c961a49d', 'bt-v102-BP74四步制-删收益50臂-买4卡');
  assertBtShape(v102.config, { start: '2026-11-05T00:00:00Z', end: '2026-11-05T13:45:10Z' }, 3000000,
    'c6efed13-ce9d-41b0-89a5-8ca8b029a609', 17);

  const gateDesc = '簇门=每买腿追加「 AND (launchBundleClusterSize < 3 OR tokenAgeSec > 60)」（开盘出生窗同块捆绑簇≥3 钱包在场时禁 60s 内触发，晚于 60s 恢复可触）';
  const bgDesc = '（2026-11-14 双窗因子分析：口袋 A −0.144 n=29/B −0.535 n=29 两窗稳定同负、早入∧无簇与晚入格全正、剔除面零肥尾、网格簇3~6×age30~60 全负非刀锋；launchBundleClusterSize=FA 出生窗运行值早龄可见、空/空窗恒 0 非 null）';

  // ①bt-v116：A 门控臂
  await insert(c, v115, 'bt-v116-a-cluster-gate-v68base',
    'bt-v116（2026-11-14 开盘簇×早入场口袋门 A 窗门控臂）：bt-v115 config 克隆+14 买腿加簇门，其余（16 卖腿/窗口 11-02T12:00→11-03T14:58:49Z/门链/HOLD180/删GMGN臂）逐位不动。基线=bt-v115（103 票 +1.5532，同码 f9ee93d2 同日跑毕），唯一变量=簇门。' + gateDesc + bgDesc,
    (cfg) => addGate(cfg.strategiesConfig, 'v116'));

  // ②bt-v117：B 基线重跑（原样）
  await insert(c, v102, 'bt-v117-b-baseline-rerun-v68base',
    'bt-v117（2026-11-14 开盘簇×早入场口袋门 B 窗基线重跑）：bt-v102 config 逐位克隆（14 买腿/17 卖腿/窗口 11-05T00:00→13:45:10Z 不动），唯一变量=代码时代——v102 原跑 11-11 旧代码，其后 CD400-407/BP77-83/T134-T139 均动买决策，本跑与 bt-v118（门控臂）同码 f9ee93d2 构成同码对照。预期与原跑 109 票 +2.092 漂移（门链 denied 臂增多/锚口径三度反向）。',
    null);

  // ③bt-v118：B 门控臂
  await insert(c, v102, 'bt-v118-b-cluster-gate-v68base',
    'bt-v118（2026-11-14 开盘簇×早入场口袋门 B 窗门控臂）：bt-v102 config 克隆+14 买腿加簇门，其余（17 卖腿/窗口/门链）逐位不动。基线=bt-v117（同码原样重跑），唯一变量=簇门。B 载体选 v102 非 v110：B 窗口袋 29 张 −0.535 几乎全在 v102（v110 仅 8 张 +0.005）。' + gateDesc + bgDesc,
    (cfg) => addGate(cfg.strategiesConfig, 'v118'));

  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
