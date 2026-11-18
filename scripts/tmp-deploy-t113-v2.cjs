// T165 库部署：pump-imbalance-exit v2 —— 腿级 sellDebounce 确认窗减弱 3500/5 → 2000/2
// 部署前 validateLegs+loadStrategies 双预检（T163b 惯例），--commit 才写库
const { dbManager } = require('../src/services/dbManager.js');
const { validateLegs } = require('../src/web/services/StrategyLibraryService.js');
const { StrategyEngine } = require('../src/strategies/StrategyEngine.js');

const ID = '49862cfe-4bc5-409e-8917-9d8079c9f2cb';
const COMMIT = process.argv.includes('--commit');

(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_library')
    .select('id,name,side,version,legs').eq('id', ID).limit(1);
  if (error || !data.length) { console.error('读条目失败:', error ? error.message : 'not found'); process.exit(1); }
  const row = data[0];
  if (row.name !== 'pump-imbalance-exit' || row.side !== 'sell') { console.error('条目身份核验失败'); process.exit(1); }

  const legs = JSON.parse(JSON.stringify(row.legs));
  const leg = legs[0];
  // T165 改动：阈值 90 不动，确认窗腿级减弱
  leg.sellDebounce = { minTicks: 2, debounceMs: 2000 };
  leg.description = leg.description +
    ' T165 v2（2026-11-17，bt-v140 05d2/bea7 双案）：确认窗腿级减弱 3500/5→2000/2——纯买单墙票（bea7 入场后 39 笔零卖 ratio 恒 100）fire 后 5-tick 证据在砸盘 tick 前凑不齐被掐（实跑 -7.9%；2000/2 在砸盘前最后纯买 tick +9.6% 成交，救回 +0.035）；再松档（1500/1 以下/阈值 80）放进有换手拉升票早卖砍利润（bypass 最差 -0.086），127 票矩阵 2000/2 唯一正收益档 +0.027；阈值 90 与全腿 bypass=false 裁定不动。';

  // 预检 1：validateLegs（入库 400 口径）
  const check = validateLegs('sell', legs);
  if (!check.valid) { console.error('预检1 validateLegs 拒绝:', check.errors); process.exit(1); }
  console.log('预检1 validateLegs ✓');

  // 预检 2：loadStrategies（引擎装载口径，含 normalizeSellDebounce）
  try {
    const eng = new StrategyEngine();
    eng.loadStrategies([{
      id: 'sell_0_t113v2', name: '卖出策略 P5', action: 'sell',
      condition: leg.condition, priority: leg.priority, cards: leg.cards,
      cooldownSec: leg.cooldownSec, bypassDebounce: leg.bypassDebounce,
      sellDebounce: leg.sellDebounce, enabled: true,
    }]);
    const loaded = eng.getStrategy('sell_0_t113v2');
    if (!loaded.sellDebounce || loaded.sellDebounce.minTicks !== 2 || loaded.sellDebounce.debounceMs !== 2000) {
      console.error('预检2 装载形状错误:', loaded.sellDebounce); process.exit(1);
    }
    console.log('预检2 loadStrategies ✓ sellDebounce=', JSON.stringify(loaded.sellDebounce));
  } catch (e) { console.error('预检2 loadStrategies 拒绝:', e.message); process.exit(1); }

  console.log('\n[dry] 条目:', row.name, 'v' + row.version, '→ v' + (row.version + 1));
  console.log('[dry] 腿改动: sellDebounce +=', JSON.stringify(leg.sellDebounce), '/ condition 不动:', leg.condition);
  if (!COMMIT) { console.log('\n[dry-run] 未写库；加 --commit 写库'); process.exit(0); }

  const { error: upErr } = await c.from('strategy_library')
    .update({ legs, version: row.version + 1 }).eq('id', row.id);
  if (upErr) { console.error('写库失败:', upErr.message); process.exit(1); }

  const { data: back } = await c.from('strategy_library')
    .select('name,version,legs').eq('id', row.id).limit(1);
  const b = back[0];
  const sd = b.legs[0].sellDebounce;
  const okShape = sd && sd.minTicks === 2 && sd.debounceMs === 2000
    && b.legs[0].condition === 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90';
  console.log(`\n写库完成: ${b.name} v${b.version}；形状核验 ${okShape ? '✓' : '✗ FAIL'}（sellDebounce=${JSON.stringify(sd)}）`);
  process.exit(okShape ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
