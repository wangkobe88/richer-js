// T168 库部署：pump-imbalance-exit v3 —— 买入额度门 sinceEntryBuyBnb >= 1
// 用户裁定（2026-11-17 fa99 案）「至少买入额度要有一定限制，不要一点小额度买就下车了」；
// 定线 1.0 BNB（四档裁定取 ≥1.0：拦 fa99 0.399/cdf0 0.236/54b8 0.895，b2b3 1.183/9c01 1.348 照旧）
// 部署前 validateLegs+loadStrategies 双预检（T163b/T165 惯例），--commit 才写库
const { dbManager } = require('../src/services/dbManager.js');
const { validateLegs } = require('../src/web/services/StrategyLibraryService.js');
const { StrategyEngine } = require('../src/strategies/StrategyEngine.js');

const ID = '49862cfe-4bc5-409e-8917-9d8079c9f2cb';
const COMMIT = process.argv.includes('--commit');
const NEW_CONDITION = 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90 AND sinceEntryBuyBnb >= 1';

(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_library')
    .select('id,name,side,version,legs').eq('id', ID).limit(1);
  if (error || !data.length) { console.error('读条目失败:', error ? error.message : 'not found'); process.exit(1); }
  const row = data[0];
  if (row.name !== 'pump-imbalance-exit' || row.side !== 'sell') { console.error('条目身份核验失败'); process.exit(1); }

  const legs = JSON.parse(JSON.stringify(row.legs));
  const leg = legs[0];
  const oldCondition = leg.condition;
  if (oldCondition !== 'realHoldDuration >= 30 AND sinceEntryNetBuyRatio >= 90') {
    console.error('基底 condition 非预期:', oldCondition); process.exit(1);
  }
  // T168 改动：买入额度门（FA sinceEntryBuyBnb=T113 原料键升条件串；未持仓 null fail-closed 恒不触发同 ratio）
  leg.condition = NEW_CONDITION;
  leg.description = leg.description +
    ' T168 v3（2026-11-17，bt-v140 fa99 0xfa99d9b5…7777 案）：买入额度门 AND sinceEntryBuyBnb >= 1——用户裁定「至少买入额度要有一定限制，不要一点小额度买就下车」；fa99 案 39s 内他人买仅 0.399B（一笔 0.197+尘埃单）零卖=净买比 100% 触发全清 +14.6%，卖后 10min +214.6%（真 pump 延迟到来，后续买 12.08B）。11 实验全触发面扫描（去重 5 次）：4 次卖早（0.399→+214.6%/0.895→+22.9%/1.183→+60.3%/1.348→+47.1%）、1 次（0.236）持有 10min 末仅差 1pp 非避险；v70 时代的崩盘保护对象（30s 单边买 4/6 崩）已被买侧门链结构性前置拦截，触发面变质为健康票首波拉升。定线 1.0：拦 0.399/0.236/0.895 三次，1.183/1.348 巨量形状保留逃生门；sinceEntryBuyBnb=入场锚以来他人链上买累计（不含本仓虚拟成交），未持仓 null fail-closed。';

  // 预检 1：validateLegs（入库 400 口径）
  const check = validateLegs('sell', legs);
  if (!check.valid) { console.error('预检1 validateLegs 拒绝:', check.errors); process.exit(1); }
  console.log('预检1 validateLegs ✓');

  // 预检 2：loadStrategies（引擎装载口径，含 FA 因子键集校验——sinceEntryBuyBnb 未知因子防线）
  try {
    const eng = new StrategyEngine();
    eng.loadStrategies([{
      id: 'sell_0_t113v3', name: '卖出策略 P5', action: 'sell',
      condition: leg.condition, priority: leg.priority, cards: leg.cards,
      cooldownSec: leg.cooldownSec, bypassDebounce: leg.bypassDebounce,
      sellDebounce: leg.sellDebounce, enabled: true,
    }]);
    const loaded = eng.getStrategy('sell_0_t113v3');
    // condition 装载后为 AST（AND/COMPARISON 树）——断言三比较叶齐全
    const leaves = [];
    const walk = (n) => {
      if (!n || typeof n !== 'object') return;
      if (n.type === 'COMPARISON') leaves.push(`${n.left} ${n.operator} ${n.right}`);
      else { walk(n.left); walk(n.right); }
    };
    walk(loaded.condition);
    const ok = loaded && leaves.length === 3
      && leaves.includes('realHoldDuration >= 30')
      && leaves.includes('sinceEntryNetBuyRatio >= 90')
      && leaves.includes('sinceEntryBuyBnb >= 1');
    if (!ok) { console.error('预检2 装载形状错误:', JSON.stringify(leaves)); process.exit(1); }
    console.log('预检2 loadStrategies ✓ 比较叶=', JSON.stringify(leaves));
  } catch (e) { console.error('预检2 loadStrategies 拒绝:', e.message); process.exit(1); }

  console.log('\n[dry] 条目:', row.name, 'v' + row.version, '→ v' + (row.version + 1));
  console.log('[dry] condition:', oldCondition, '→', NEW_CONDITION);
  if (!COMMIT) { console.log('\n[dry-run] 未写库；加 --commit 写库'); process.exit(0); }

  const { error: upErr } = await c.from('strategy_library')
    .update({ legs, version: row.version + 1 }).eq('id', row.id);
  if (upErr) { console.error('写库失败:', upErr.message); process.exit(1); }

  const { data: back } = await c.from('strategy_library')
    .select('name,version,legs').eq('id', row.id).limit(1);
  const b = back[0];
  const okShape = b.legs[0].condition === NEW_CONDITION
    && b.legs[0].sellDebounce && b.legs[0].sellDebounce.minTicks === 2;
  console.log(`\n写库完成: ${b.name} v${b.version}；形状核验 ${okShape ? '✓' : '✗ FAIL'}（condition=${b.legs[0].condition}）`);
  process.exit(okShape ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
