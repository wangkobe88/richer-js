#!/usr/bin/env node
/**
 * T97 secSincePeak 高点停滞减仓臂因子单测（2026-10-29 用户拍板：peakProfitPct >= 10
 * AND secSincePeak > 60 卖 1 卡 cd60 maxExecutions=2）——本地零 DB 零网络。
 *
 * 键：secSincePeak = (now − pos.highestPriceSinceBuyAt) / 1000——距持仓期峰值秒数。
 * 峰值时刻=任意接受价轨推进点（processTick priceAccepted 块：outlier（>1000× 中位数
 * 判）不推峰；尘 tick 不卡尘门——与武装门 peakProfitPct 的可靠价轨（尘门 0.002+outlier）
 * 分轨）；创新高 → 峰值时刻推进=secSincePeak 归零重计；now=buildFactorMap 入参（回测
 * =虚拟时钟，红线 6 禁 Date.now）；无持仓/无峰值时刻 → null（`> 60` 恒 false fail-closed）。
 *
 * 定标数据（scripts/tmp-since-high-arm-scan.cjs 182 跑，5 天 113 episode）：
 *   N=60/mf=2/peak≥10/无 profit 门=最优 +0.0109 BNB；盈转亏子集（峰≥+20% 终局≤0，
 *   n=29）贡献 +0.0107≈全部收益；profitGate>0 反而 -0.0024（跌回成本线下仍未收复段
 *   是主力贡献）；双阈值（第 2 张长窗）全面差于统一 60s——崩盘票等确认的落袋损失 >
 *   火箭误杀节省。误杀面=二次腾飞票（佩狗/创业时代/OST，单票 -0.0015~-0.0022）。
 *
 * 覆盖：
 *   A. 无持仓 null + ConditionEvaluator fail-closed（> 60 恒 false）
 *   B. 买入后起算（无价推进：= (asOf − buyTime)/1000）
 *   C. 新高推进归零重计（峰值时刻=新高 tick ts）
 *   D. 不新高持续增长（峰值时刻不动）
 *   E. outlier tick 不推峰（>1000× 突刺拒收——_acceptPrice 中位数判）
 *   F. 尘 tick 不卡尘门推峰（任意接受价轨）但不武装（可靠价轨）——双轨分离反证
 *   G. asOf 入参口径（同 state 两个 asOf 差值精确；源码无 Date.now）
 *   H. getHolderFactors per-position 同源
 *   I. 清仓 clearBuyState → 回 null
 *   J. FactorBuilder 快照透传（值透传 + undefined → null 不掩盖）
 *   K. 探针收键（getFactorKeys / getAvailableFactorIds）+ 卖腿条件直评四态
 *
 * 用法：node scripts/_test_sec_since_peak.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));
const { buildFactorValuesForTimeSeries } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: 'w1', sender_address: null,
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

function newFA() {
  const fa = new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

const COND = 'peakProfitPct >= 10 AND secSincePeak > 60';

// ═══════════════ A. 无持仓 null + fail-closed ═══════════════
console.log('A. 无持仓 null + fail-closed');
{
  const fa = newFA();
  fa.processTick(mkTick({}), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 5000);
  check('A1 无持仓 secSincePeak === null', () => assert.strictEqual(f.secSincePeak, null));
  const ev = new ConditionEvaluator();
  check('A2 无持仓卖腿条件恒 false（null > 60 不触发）', () =>
    assert.strictEqual(ev.evaluate(COND, f), false));
}

// ═══════════════ B. 买入后起算 ═══════════════
console.log('B. 买入后起算（无价推进）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  const f = fa.buildFactorMap('0xtoken', T0 + 62000);
  check('B1 secSincePeak = 60（asOf − buyTime；首接受价=锚=初始峰）', () =>
    assert.ok(Math.abs(f.secSincePeak - 60) < 1e-6, `got ${f.secSincePeak}`));
  check('B2 停滞恰 60s 不触发（> 60 严格大于——60.0 恰在线上不卖）', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false));
}

// ═══════════════ C. 新高推进归零重计 ═══════════════
console.log('C. 新高推进归零重计');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  // +15% 新高（0.00001 → 0.0000115）在 T0+30000：peakProfitPct 武装 + 峰值时刻推进
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 0.0000115, block_number: 101 }), {});
  const f1 = fa.buildFactorMap('0xtoken', T0 + 40000);
  check('C1 新高后 10s：secSincePeak=10（重计自新高 tick）', () =>
    assert.ok(Math.abs(f1.secSincePeak - 10) < 1e-6, `got ${f1.secSincePeak}`));
  check('C2 峰值利润武装（peakProfitPct ≥ 10）', () =>
    assert.ok(f1.peakProfitPct >= 10, `peak ${f1.peakProfitPct}`));
  const f2 = fa.buildFactorMap('0xtoken', T0 + 91000);
  check('C3 停滞 61s（新高后）触发卖腿条件', () =>
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f2), true));
}

// ═══════════════ D. 不新高持续增长 ═══════════════
console.log('D. 不新高：峰值时刻不动、secSincePeak 持续增长');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 0.0000115, block_number: 101 }), {});
  // 后续回落震荡（均低于峰）——secSincePeak 一直按 T0+30000 起算
  fa.processTick(mkTick({ timestamp: T0 + 60000, price_bnb: 0.0000105, block_number: 102 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 90000, price_bnb: 0.0000108, block_number: 103 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 120000);
  check('D1 回落不重计：secSincePeak=90（自 T0+30000 峰）', () =>
    assert.ok(Math.abs(f.secSincePeak - 90) < 1e-6, `got ${f.secSincePeak}`));
}

// ═══════════════ E. outlier tick 不推峰 ═══════════════
console.log('E. outlier 不推峰（>1000× 突刺拒收——_acceptPrice 中位数判，窗≥3 才评）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001, block_number: 100 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  // 填 recentPrices 窗（≥3 才判离群；中位数≈0.0000104）
  fa.processTick(mkTick({ timestamp: T0 + 11000, price_bnb: 0.0000102, block_number: 101 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 21000, price_bnb: 0.0000104, block_number: 102 }), {});
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 0.0000115, block_number: 103 }), {});   // 新高：峰时刻=T0+30000
  // 4800× 突刺=离群拒收（0.05 > mid×1000）——幽灵峰值不得重置停滞计时
  fa.processTick(mkTick({ timestamp: T0 + 50000, price_bnb: 0.05, block_number: 104 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('E1 outlier 后峰值不动（peakProfitPct 仍 15，武装价不被突刺抬高）', () =>
    assert.ok(Math.abs(f.peakProfitPct - 15) < 1e-6, `got ${f.peakProfitPct}`));
  check('E2 outlier 后 secSincePeak=30（自 T0+30000——突刺不重置计时）', () =>
    assert.ok(Math.abs(f.secSincePeak - 30) < 1e-6, `got ${f.secSincePeak}`));
}

// ═══════════════ F. 尘 tick 推峰（任意接受价轨语义）═══════════════
console.log('F. 尘 tick 不卡尘门——峰推进走任意接受价轨（与 peakProfitPct 可靠价轨分轨）');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001, block_number: 100 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 0.0000115, block_number: 101 }), {});
  // 尘量 0.0005 BNB < 可靠价尘门 0.002：不进可靠价轨（peakProfitPct 不武装）但非离群
  // → 接受价轨推进峰 → secSincePeak 归零重计（T97 载体与武装门分轨的真实口径）
  fa.processTick(mkTick({ timestamp: T0 + 50000, price_bnb: 0.00002, bnb_amount: 0.0005, block_number: 102 }), {});
  const f = fa.buildFactorMap('0xtoken', T0 + 60000);
  check('F1 尘价新高重置计时（secSincePeak=10 自 T0+50000）', () =>
    assert.ok(Math.abs(f.secSincePeak - 10) < 1e-6, `got ${f.secSincePeak}`));
  check('F2 尘价不武装（peakProfitPct 仍 15=可靠价轨峰值）', () =>
    assert.ok(Math.abs(f.peakProfitPct - 15) < 1e-6, `got ${f.peakProfitPct}`));
}

// ═══════════════ G. asOf 入参口径（禁 Date.now）═══════════════
console.log('G. asOf 入参口径');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 0.0000115, block_number: 101 }), {});
  const fa1 = fa.buildFactorMap('0xtoken', T0 + 40000).secSincePeak;
  const fa2 = fa.buildFactorMap('0xtoken', T0 + 90000).secSincePeak;
  check('G1 同 state 不同 asOf：差值精确=50s（虚拟时钟驱动，回测同源）', () =>
    assert.ok(Math.abs((fa2 - fa1) - 50) < 1e-6, `${fa1} → ${fa2}`));
  const src = read('src/services/FourMemeFactorAggregator.js');
  const seg = src.split('secSincePeak: pos.highestPriceSinceBuyAt')[1].split('\n')[0];
  check('G2 发射式用入参 now 非时钟（源码口径锁）', () =>
    assert.ok(seg.includes('(now - pos.highestPriceSinceBuyAt)'), seg));
}

// ═══════════════ H. getHolderFactors per-position 同源 ═══════════════
console.log('H. getHolderFactors 同源');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 }, 'leg1');
  fa.processTick(mkTick({ timestamp: T0 + 30000, price_bnb: 0.0000115, block_number: 101 }), {});
  const hf = fa.getHolderFactors('0xtoken', 'leg1', T0 + 60000);
  check('H1 per-position 口径=主表同式（60−30=30s）', () =>
    assert.ok(Math.abs(hf.secSincePeak - 30) < 1e-6, `got ${hf.secSincePeak}`));
}

// ═══════════════ I. 清仓回 null ═══════════════
console.log('I. 清仓 clearBuyState → null');
{
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.00001 }), {});
  fa.setBuyState('0xtoken', { buyPriceBnb: 0.00001, buyTime: T0 + 2000 });
  fa.clearBuyState('0xtoken');
  const f = fa.buildFactorMap('0xtoken', T0 + 100000);
  check('I1 清仓后 secSincePeak=null 且条件恒 false（清仓后臂不存在）', () => {
    assert.strictEqual(f.secSincePeak, null);
    assert.strictEqual(new ConditionEvaluator().evaluate(COND, f), false);
  });
}

// ═══════════════ J. FactorBuilder 快照透传 ═══════════════
console.log('J. FactorBuilder 快照透传');
{
  const snap = buildFactorValuesForTimeSeries({ secSincePeak: 73.5, profitPercent: 12 });
  check('J1 值透传 73.5', () => assert.ok(Math.abs(snap.secSincePeak - 73.5) < 1e-9));
  const snap2 = buildFactorValuesForTimeSeries({ profitPercent: 12 });
  check('J2 旧 FA 无键 → null 不掩盖', () => assert.strictEqual(snap2.secSincePeak, null));
  const fbSrc = read('src/trading-engine/core/FactorBuilder.js');
  check('J3 快照白名单源码锁（不落库即丢防线）', () =>
    assert.ok(fbSrc.includes('secSincePeak: factorResults.secSincePeak ?? null')));
}

// ═══════════════ K. 探针收键 + 条件四态 ═══════════════
console.log('K. 探针收键 + 卖腿条件四态');
{
  const fa = newFA();
  const keys = fa.getFactorKeys();
  check('K1 getFactorKeys 含 secSincePeak（三防线自动认得）', () =>
    assert.ok(keys.has('secSincePeak'), [...keys].filter(k => k.includes('Since')).join(',')));
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  check('K2 getAvailableFactorIds 含（条件校验可过）', () =>
    assert.ok(getAvailableFactorIds().has('secSincePeak')));

  const ev = new ConditionEvaluator();
  check('K3 未武装（peak 5%）+ 停滞 100s → false', () =>
    assert.strictEqual(ev.evaluate(COND, { peakProfitPct: 5, secSincePeak: 100 }), false));
  check('K4 武装 + 停滞 59s → false', () =>
    assert.strictEqual(ev.evaluate(COND, { peakProfitPct: 20, secSincePeak: 59 }), false));
  check('K5 武装 + 停滞 61s → true', () =>
    assert.strictEqual(ev.evaluate(COND, { peakProfitPct: 20, secSincePeak: 61 }), true));
  check('K6 武装 + null → false（fail-closed）', () =>
    assert.strictEqual(ev.evaluate(COND, { peakProfitPct: 20, secSincePeak: null }), false));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
