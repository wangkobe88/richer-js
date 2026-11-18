// 一次性 clone（182 跑）：bt-v140 → bt-v141（买侧复审轮 FP5~FP10 + 卖侧 T157c/T161/
// T162/T163b/T165b/T168/T170 全量上车的 33h 窗再回测）。
//   ① 买腿=bt-v140 原样（ladder v28 十四腿 copy-in cards:4，库零改动）；
//   ② T157b 迁移：5 条 HOLD 腿（P7/P11×2/P10×2）删条件串释放臂（干净条件）+
//      config 加 fourmemeWs.factorSellFilter={enabled:true}（pp>=100 管辖归模块）；
//   ③ famous-entry-exit 腿换库 v3（2s 延迟）；pump-imbalance-exit 腿换库 v3
//      （T168 买额度门 sinceEntryBuyBnb>=1）；famous-trim-exit v1 两腿 append（T161）；
//   ④ 其余 config 原样（同窗 11-02T06:00~11-03T14:59:59、signalGateReal、
//      alwaysRecheck、activityExemptLevels ['high']、factorCheck.enabled）。
// 断言：释放臂零残留 ∧ factorSellFilter 在 ∧ 库版本 v3/v3/v1 ∧ 卖腿 16→18。
const { dbManager } = require('../src/services/dbManager.js');
const SRC = '6e75ed6d-807a-4164-9551-d3b95d1fc37b'; // bt-v140

const RELEASE_ARM = ' AND (profitPercent < 100 OR sinceLastFamousBigBuySec IS NULL OR sinceLastFamousBigBuySec > 180 OR recentFamousSellBnb >= 0.2)';

async function main() {
  const c = await dbManager.getClient();
  // 库拉三条卖腿最新版
  const libs = {};
  for (const [name, wantV] of [['famous-entry-exit', 3], ['pump-imbalance-exit', 3], ['famous-trim-exit', 1]]) {
    const { data, error } = await c.from('strategy_library').select('id,name,side,version,legs').eq('name', name);
    if (error || !data || !data.length) throw new Error(`库条目 ${name} 拉取失败: ${error && error.message}`);
    const l = data[0];
    if (l.version !== wantV) throw new Error(`库版本断言失败：${name} 期望 v${wantV} 实得 v${l.version}`);
    libs[name] = l;
  }
  if (libs['famous-trim-exit'].legs.length !== 2) throw new Error('famous-trim-exit 应 2 腿');

  const { data, error } = await c.from('experiments').select('*').eq('id', SRC).limit(1);
  if (error) throw new Error(error.message);
  const e = data[0];
  if (e.trading_mode !== 'backtest') throw new Error('基底非 backtest？');
  const cfg = JSON.parse(JSON.stringify(e.config));
  const sc = cfg.strategiesConfig;
  const sells = sc.sellStrategies;

  // ② 5 条 HOLD 腿删释放臂
  let holdN = 0;
  for (const s of sells) {
    const cond = s.condition || '';
    if (!cond.includes('sinceLastFamousBigBuySec')) continue;
    holdN++;
    let clean = cond.split(RELEASE_ARM).join('');
    // idx3 形状 `profitPercent > 100 AND (...)`：split 后剩 `profitPercent > 100 AND `
    clean = clean.replace(/ AND $/, '').trim();
    if (clean.includes('sinceLastFamousBigBuySec')) throw new Error('释放臂删后仍残留: ' + clean);
    s.condition = clean;
  }
  if (holdN !== 5) throw new Error(`HOLD 腿数断言失败：${holdN}（期望 5）`);

  // ③ famous-entry-exit 换 v3 / pump-imbalance-exit 换 v3（按条件串定位整腿替换）
  const swapLeg = (condMatch, libEntry, tag) => {
    const idx = sells.findIndex((s) => (s.condition || '').includes(condMatch));
    if (idx < 0) throw new Error(`${tag} 腿定位失败（条件串: ${condMatch}）`);
    const newLeg = JSON.parse(JSON.stringify(libEntry.legs[0]));
    sells[idx] = { ...sells[idx], ...newLeg }; // 保留腿外层既有字段（priority 等以库为准由 newLeg 覆盖）
    console.log(`${tag} 腿 idx=${idx} 换库 v${libEntry.version}: ${newLeg.condition}`);
  };
  swapLeg('sinceEntryFamousNearLaunchBuyBnb', libs['famous-entry-exit'], 'famous-entry-exit');
  swapLeg('sinceEntryNetBuyRatio', libs['pump-imbalance-exit'], 'pump-imbalance-exit');

  // famous-trim-exit v1 两腿 append（库字段原样：cards/bypass/maxExecutions 已在库内）
  for (const leg of JSON.parse(JSON.stringify(libs['famous-trim-exit'].legs))) {
    sells.push(leg);
    console.log('append famous-trim-exit 腿: ' + leg.condition);
  }

  // factorSellFilter 段（T157c 全臂管辖）
  cfg.fourmemeWs = cfg.fourmemeWs || {};
  cfg.fourmemeWs.factorSellFilter = { enabled: true };

  // libraryRefs 更新（版本 provenance）
  const lr = sc.libraryRefs = sc.libraryRefs || {};
  const setRef = (name, lib) => { lr[name] = { version: lib.version, libraryId: lib.id }; };
  setRef('famous-entry-exit', libs['famous-entry-exit']);
  setRef('pump-imbalance-exit', libs['pump-imbalance-exit']);
  setRef('famous-trim-exit', libs['famous-trim-exit']);
  lr['famous-trim-exit-new'] = { name: 'famous-trim-exit', side: 'sell', libId: libs['famous-trim-exit'].id, version: 1, legCount: 2 };

  // 终检
  if (sells.some((s) => (s.condition || '').includes('sinceLastFamousBigBuySec'))) throw new Error('终检：释放臂残留');
  if (!cfg.fourmemeWs.factorSellFilter.enabled) throw new Error('终检：factorSellFilter 缺');
  if (sells.length !== 18) throw new Error(`终检：卖腿 ${sells.length}（期望 18）`);
  if ((sc.buyStrategies || []).length !== 14) throw new Error('终检：买腿数漂移');

  cfg.name = 'bt-v141';
  const row = {
    id: crypto.randomUUID(),
    experiment_name: 'bt-v141-all-changes-33h',
    experiment_description: 'bt-v141（2026-11-17 买侧复审轮+卖侧全量上车 33h 窗再回测，基底 bt-v140 6e75ed6d 同窗 11-02T06:00~11-03T14:59:59）：买腿 ladder v28 十四腿原样；FP5~FP10 因子门（尾声门/observe/腿3砸穿/CD414 密集砸盘/慢拉卸货/famous 收割完/低价全清冷却）+G19~G22/D3.72~D3.77 题集瘦身（holdings/cr/sbp/bd/abr 五题退役+pump 合力反锚+act 加权锚）随引擎生效；卖侧 T157c factorSellFilter 全臂管辖（5 条 HOLD 腿删释放臂）+famous-entry-exit v3（2s 延迟）+famous-trim-exit v1 两腿+pump-imbalance-exit v3（买额度门）+T170 almost_launch 断流延长',
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
  console.log('卖腿 ' + sells.length + ' 条 | HOLD 腿释放臂已删 ' + holdN + ' 条 | factorSellFilter.enabled=true');
  process.exit(0);
}
main().catch((err) => { console.error('FATAL', err && err.stack || err); process.exit(1); });
