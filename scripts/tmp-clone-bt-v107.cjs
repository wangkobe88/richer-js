// 一次性 clone（182 跑）：bt-v106 → bt-v107（四变化同车验证 vs V105 基线 +2.5656）：
//   ① famous-entry-exit v1→v2（T136 金额门 sinceEntryFamousNearLaunchBuyBnb >= 0.5，
//      来财 Ed_x 0.276 误触发修复）——唯一 config 改动；
//   ② roster v3（26 址，Ed_x 剔除）+ ③ BP64 ③桶绝对额参考线 + ④BP63 速倒臂（V106 已带）
//   =全局态（config 外），182 已 pull/deploy，启动即吃到。
// 断言：库 famous-entry-exit version=2 ∧ v2 cond 含金额门；替换后 v1 计数门不残；
//       买腿 14 条 ladder v18 原样（t0 年龄门在）；窗口/source/signalGateReal 不动。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '90da8b3f-0ae5-4c33-bae4-928a03d9984f'; // bt-v106

async function main() {
  const c = await dbManager.getClient();
  const { data: lib, error: le } = await c.from('strategy_library')
    .select('id,name,side,version,legs').eq('name', 'famous-entry-exit');
  if (le || !lib || !lib.length) throw new Error('库条目拉取失败: ' + le.message);
  if (lib[0].version !== 2) throw new Error(`库版本断言失败：期望 2 实得 ${lib[0].version}`);
  const v2Legs = JSON.parse(JSON.stringify(lib[0].legs));
  if (!v2Legs.some((l) => /sinceEntryFamousNearLaunchBuyBnb >= 0\.5/.test(l.condition || '')))
    throw new Error('v2 金额门断言失败');

  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;
  const idx = sc.sellStrategies.findIndex((l) => (l.condition || '').trim() === 'sinceEntryFamousNearLaunchBuys >= 1');
  if (idx < 0) throw new Error('v1 计数门腿定位失败');
  sc.sellStrategies.splice(idx, 1, ...v2Legs);
  if (sc.sellStrategies.some((l) => (l.condition || '').trim() === 'sinceEntryFamousNearLaunchBuys >= 1'))
    throw new Error('v1 计数门残留断言失败');
  if (sc.buyStrategies.length !== 14) throw new Error(`买腿数断言失败：${sc.buyStrategies.length}`);
  if (!sc.buyStrategies.slice(0, 2).every((l) => /tokenAgeSec >= 15/.test(l.condition || '')))
    throw new Error('t0/t0a 年龄门断言失败');
  if (cfg.backtest.signalGateReal !== true || cfg.backtest.sourceExperimentId !== 'c6efed13-ce9d-41b0-89a5-8ca8b029a609')
    throw new Error('回测段断言失败');

  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v107-误伤修复四变化同车',
    experiment_description: "bt-v107（bt-v106 误伤修复验证，2026-11-12 用户裁定「两个都做……尽量不要误伤，如果有误伤必须定位原因然后修复」）：四变化同车 vs V105 基线 56 票 +2.5656——①卖腿 famous-entry-exit v2 金额门（T136 sinceEntryFamousNearLaunchBuyBnb >= 0.5，来财 Ed_x 0.276 单笔误触发 v1 计数门修复）②roster v3 26 址（Ed_x 大粉亏损型剔除）③BP64 ③桶抢筹臂绝对额参考线 ≥0.5（28ad 0.384/谷谷 0.202 零星量级翻回 none，对拍 6/6 达成）④BP63 速倒臂（V106 已带）。config 唯一改动=卖腿 v1→v2；基底 bt-v106 90da8b3f 同窗同源：窗 11-05 00:00~13:45 source=c6efed13 signalGateReal ladder v18 帽 15",
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
