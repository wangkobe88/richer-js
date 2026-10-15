#!/usr/bin/env node
/**
 * 零 DB 零网络单测：fire→成交窗峰值回填（2026-10-15 双口径裁定，0xc7fe…7777 案）
 *
 * 事故现场：live fire 锚 1.1445e-8 → preBuy 检查 12s 冲高 1.4147e-8（+23.6%）→
 * 成交 1.2754e-8 → 旧机制峰值从成交时刻起算 → peakProfitPct=0 → P11 回撤臂
 * （peakProfitPct >= 10 AND drawdownFromHighestSinceLastBuy <= -35）永不具资格 →
 * 走 P2 止损臂 -53%。修复=markBuyFire 双轨峰 + setBuyState 消费回填。
 *
 * 比例数反证：fire 价 100 / 冲高 123.6 / 成交回落 83.9（与 0xc7fe 案同比例）
 *   → highest=123.6 / peakProfitPct=+23.6 / drawdown≈-32.1 / profitPercent≈-16.1
 *
 * 覆盖：A 本案反证 / B outlier 不推进 / C chainLate 不推进 / D 尘 tick 双轨
 * （peakAny 吃尘价、peakRel 只吃可靠价）/ E clearBuyFire 无残留 / F 无 mark 旧语义
 * bit 一致（回测 parity 红线）/ G holdDuration 双因子 / H 回测同 tick 形状 bit 一致
 */
'use strict';

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n     期望: ${expected}\n     实际: ${actual}`); }
}
function approx(name, actual, expected, tol) {
  const ok = Math.abs(actual - expected) <= tol;
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n     期望≈${expected}(±${tol})\n     实际: ${actual}`); }
}

const noopLogger = { info() {}, warn() {}, error() {}, debug() {} };
const FA = require('../src/services/FourMemeFactorAggregator.js');

const T0 = 1_700_000_000_000;
const TRADER = '0xabc0000000000000000000000000000000000001';

function mkFa() {
  return new FA({ fourmemeWs: {}, maintainClassifierTracks: false, maintainTpaTracks: false }, noopLogger);
}
// 直读内部持仓峰（highestPriceSinceBuyBnb 是 _positionFactors 内部键，顶层 factors
// 映射从不暴露——条件层消费的是 drawdownFromHighestSinceLastBuy 派生键；单测直读
// state 是事故反证断言的既定写法）
function posPeak(fa, addr) {
  return fa._states.get(addr)._positions.get('default').highestPriceSinceBuyBnb;
}
function tick(addr, ts, priceBnb, block, logIdx, bnbAmount = 0.5) {
  return {
    token_address: addr, timestamp: ts, trade_type: 'buy',
    bnb_amount: bnbAmount, price_bnb: priceBnb, token_amount: 5e6,
    block_number: block, log_index: logIdx,
    trader_address: TRADER,
  };
}
function feed(fa, t) { fa.processTick(t, { emitFactors: false }); }

// ═══ A. 本案反证（0xc7fe…7777 比例数）═══
console.log('A. fire 窗峰值回填（0xc7fe 案比例数：fire 100 / 冲高 123.6 / 成交回落 83.9）');
{
  const fa = mkFa();
  fa.registerToken('0xa1', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa1', T0, 100, 1, 1));                 // fire 时刻市价 100
  fa.markBuyFire('0xa1', 100);                            // fire：pending 双轨开账
  feed(fa, tick('0xa1', T0 + 5000, 123.6, 2, 1));        // preBuy 窗冲高 +23.6%（可靠价 0.5 BNB）
  feed(fa, tick('0xa1', T0 + 12000, 83.9, 3, 1));        // 执行时刻回落（现行 83.9）
  // 引擎成功分支：锚=fire 价 100，buySignalAt=fire 时刻，buyTime=成交时刻
  fa.setBuyState('0xa1', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 12000, buySignalAt: T0 });

  const f = fa.buildFactorMap('0xa1', T0 + 15000);
  check('A1 highestPriceSinceBuyBnb 含 fire 窗冲高（123.6，非旧口径 83.9/100）',
    posPeak(fa, '0xa1'), 123.6);
  approx('A2 peakProfitPct 回填信号口径峰值（+23.6% → P11 具资格）', f.peakProfitPct, 23.6, 0.01);
  approx('A3 drawdownFromHighestSinceLastBuy（83.9 vs 峰 123.6 → ≈-32.1）',
    f.drawdownFromHighestSinceLastBuy, -32.12, 0.01);
  approx('A4 profitPercent 相对 fire 锚（83.9 vs 100 → ≈-16.1）', f.profitPercent, -16.1, 0.01);
  // 反事实：旧机制 peakProfitPct=0 时 P11（>=10）恒 false；新口径 23.6 >= 10 具资格
  check('A5 P11 峰值利润门资格恢复（peakProfitPct >= 10）', f.peakProfitPct >= 10, true);
}

// ═══ B. outlier tick 不推进 pending ═══
console.log('B. 离群价不推进 pending 峰（与持仓峰同门：_acceptPrice 拒绝的价不算冲高）');
{
  const fa = mkFa();
  fa.registerToken('0xa2', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa2', T0, 100, 1, 1));
  feed(fa, tick('0xa2', T0 + 1000, 100, 2, 1));          // 填满 recentPrices 窗中位数基线
  feed(fa, tick('0xa2', T0 + 2000, 100, 3, 1));
  fa.markBuyFire('0xa2', 100);
  // 1000 倍跳价 = OUTLIER_RATIO 边界外（中位 100 → >100000 判离群；200000 稳超）
  feed(fa, tick('0xa2', T0 + 3000, 200000, 4, 1));       // outlier：不推 peakAny/peakRel
  fa.setBuyState('0xa2', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 4000 });
  const f = fa.buildFactorMap('0xa2', T0 + 5000);
  check('B1 highest 不吃离群价（100）', posPeak(fa, '0xa2'), 100);
  check('B2 peakProfitPct 不吃离群价（0）', f.peakProfitPct, 0);
}

// ═══ C. chainLate tick 不推进 pending ═══
console.log('C. 迟到旧价不推进 pending 峰（chainLate 跳过价格追踪整段）');
{
  const fa = mkFa();
  fa.registerToken('0xa3', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa3', T0, 100, 5, 10));                // 水位 (block 5, li 10)
  fa.markBuyFire('0xa3', 100);
  feed(fa, tick('0xa3', T0 + 1000, 150, 4, 10));         // block 4 < 5 → chainLate
  fa.setBuyState('0xa3', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 2000 });
  const f = fa.buildFactorMap('0xa3', T0 + 3000);
  check('C1 highest 不吃迟到旧价（100）', posPeak(fa, '0xa3'), 100);
  check('C2 peakProfitPct 不吃迟到旧价（0）', f.peakProfitPct, 0);
}

// ═══ D. 尘 tick 双轨：peakAny 吃尘价、peakRel 只吃可靠价 ═══
console.log('D. 尘 tick（bnb < minPriceUpdateBnb 0.002）双轨分叉');
{
  const fa = mkFa();
  fa.registerToken('0xa4', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa4', T0, 100, 1, 1));
  fa.markBuyFire('0xa4', 100);
  feed(fa, tick('0xa4', T0 + 1000, 150, 2, 1, 0.001));   // 尘 tick：接受但不可靠
  fa.setBuyState('0xa4', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 2000 });
  const f = fa.buildFactorMap('0xa4', T0 + 3000);
  check('D1 highest（任意接受价轨）吃尘价（150——与持仓 highestPriceSinceBuyBnb 同语义）',
    posPeak(fa, '0xa4'), 150);
  check('D2 peakProfitPct（可靠价轨）不吃尘价（0 哨兵）', f.peakProfitPct, 0);
}

// ═══ E. clearBuyFire 无残留（失败路径清理）═══
console.log('E. clearBuyFire 后 setBuyState 无 pending 残留');
{
  const fa = mkFa();
  fa.registerToken('0xa5', { createdAtMs: T0, totalSupply: 1e9 });
  fa.registerToken('0xa5c', { createdAtMs: T0, totalSupply: 1e9 }); // 对照组：未 clear
  feed(fa, tick('0xa5', T0, 100, 1, 1));
  feed(fa, tick('0xa5c', T0, 100, 1, 1));
  fa.markBuyFire('0xa5', 100);
  fa.markBuyFire('0xa5c', 100);
  feed(fa, tick('0xa5', T0 + 1000, 150, 2, 1));          // fire 窗可靠价冲高 +50%
  feed(fa, tick('0xa5c', T0 + 1000, 150, 2, 1));
  feed(fa, tick('0xa5', T0 + 1500, 120, 3, 1));          // 回落（隔离 running max：
  feed(fa, tick('0xa5c', T0 + 1500, 120, 3, 1));         // setBuyState 后首次 buildFactorMap
  // 的先推进后读取只看 _relPriceBnb=120 → +20%，与 pending 回填 +50% 可区分）
  fa.clearBuyFire('0xa5');                                // 模拟引擎 finally 清理（买失败）
  fa.setBuyState('0xa5', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 2000 });
  fa.setBuyState('0xa5c', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 2000 });
  const f = fa.buildFactorMap('0xa5', T0 + 3000);
  const fc = fa.buildFactorMap('0xa5c', T0 + 3000);
  // clear 后：pending 峰已清——peakProfitPct 只剩 running max（回落价 120 → +20%）
  check('E1 clear 后 peakProfitPct 无窗内冲高残留（20=running max 回落价，非 50）',
    f.peakProfitPct, 20);
  check('E2 clear 后 highest 走旧口径 max(锚, current)（120）', posPeak(fa, '0xa5'), 120);
  check('E3 对照组未 clear peakProfitPct=50（+50% 可靠价冲高回填）', fc.peakProfitPct, 50);
  check('E4 对照组 highest 回填窗内峰（150）', posPeak(fa, '0xa5c'), 150);
}

// ═══ F. 无 markBuyFire 直接 setBuyState → 旧语义 bit 一致（回测 parity 红线）═══
console.log('F. 无 pending 的 setBuyState 逐位退化为旧行为（手工/恢复锚点/回测形状）');
{
  const fa = mkFa();
  fa.registerToken('0xa6', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa6', T0, 100, 1, 1));
  fa.setBuyState('0xa6', { buyPriceBnb: 100, buyPriceUsd: 100, buyTime: T0 + 1000 });
  const f0 = fa.buildFactorMap('0xa6', T0 + 1500);
  check('F1 highest=max(锚, current)（100）', posPeak(fa, '0xa6'), 100);
  check('F2 peakProfitPct=0（无回填，靠持仓后可靠价推进）', f0.peakProfitPct, 0);
  check('F3 buySignalAt 缺省回落 buyTime（旧调用形状 bit 一致）', f0.buySignalAt, T0 + 1000);
  check('F4 holdDuration == realHoldDuration（同锚）', f0.holdDuration, f0.realHoldDuration);
  // 持仓后可靠价 tick 推进 running max（旧机制不变量）
  feed(fa, tick('0xa6', T0 + 4000, 120, 2, 1));
  const f1 = fa.buildFactorMap('0xa6', T0 + 5000);
  check('F5 持仓后可靠价推进 peakProfitPct（+20% 旧机制）', f1.peakProfitPct, 20);
  check('F6 profitPercent 相对锚（120 vs 100）', f1.profitPercent, 20);
}

// ═══ G. holdDuration/realHoldDuration 双因子 + 执行键透传 ═══
console.log('G. 双时长（信号/执行口径）与 buyExecutedPriceBnb 透传');
{
  const fa = mkFa();
  fa.registerToken('0xa7', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa7', T0, 100, 1, 1));
  fa.markBuyFire('0xa7', 100);
  feed(fa, tick('0xa7', T0 + 17000, 110, 2, 1));         // preBuy 窗 17s 后成交
  fa.setBuyState('0xa7', {
    buyPriceBnb: 100, buyPriceUsd: 100,
    buyTime: T0 + 17000, buySignalAt: T0,
    buyExecutedPriceBnb: 110,                            // live 余额差法成交价
  });
  const f = fa.buildFactorMap('0xa7', T0 + 60000);
  check('G1 holdDuration 信号口径（T0 起算 60s）', f.holdDuration, 60);
  check('G2 realHoldDuration 执行口径（T0+17s 起算 43s）', f.realHoldDuration, 43);
  check('G3 buySignalAt 透传（fire 时刻）', f.buySignalAt, T0);
  check('G4 buyExecutedAt 透传（成交时刻）', f.buyExecutedAt, T0 + 17000);
  check('G5 buyExecutedPriceBnb 透传（110）', f.buyExecutedPriceBnb, 110);
  // buyExecutedPriceBnb 缺省（虚拟/回测）= null 诚实语义
  fa.registerToken('0xa7v', { createdAtMs: T0, totalSupply: 1e9 });
  feed(fa, tick('0xa7v', T0, 100, 1, 1));
  fa.setBuyState('0xa7v', { buyPriceBnb: 100, buyTime: T0 + 1000, buySignalAt: T0 });
  const fv = fa.buildFactorMap('0xa7v', T0 + 2000);
  check('G6 虚拟/回测 buyExecutedPriceBnb=null（无独立执行价真相）', fv.buyExecutedPriceBnb, null);
}

// ═══ H. 回测形状：mark → 同 tick setBuyState 与无 mark bit 一致 ═══
console.log('H. 回测串行形状（fire==成交同 tick）零变化——mark 不引入任何差异');
{
  const fa = mkFa();
  fa.registerToken('0xa8', { createdAtMs: T0, totalSupply: 1e9 });   // 带 mark
  fa.registerToken('0xa8n', { createdAtMs: T0, totalSupply: 1e9 });  // 无 mark（旧形状）
  const now = T0 + 1000;
  feed(fa, tick('0xa8', now, 120, 1, 1));
  feed(fa, tick('0xa8n', now, 120, 1, 1));
  fa.markBuyFire('0xa8', 120);
  fa.setBuyState('0xa8', { buyPriceBnb: 120, buyPriceUsd: 120, buyTime: now, buySignalAt: now });
  fa.setBuyState('0xa8n', { buyPriceBnb: 120, buyPriceUsd: 120, buyTime: now });
  feed(fa, tick('0xa8', T0 + 5000, 130, 2, 1));
  feed(fa, tick('0xa8n', T0 + 5000, 130, 2, 1));
  feed(fa, tick('0xa8', T0 + 9000, 125, 3, 1));
  feed(fa, tick('0xa8n', T0 + 9000, 125, 3, 1));
  const a = fa.buildFactorMap('0xa8', T0 + 10000);
  const b = fa.buildFactorMap('0xa8n', T0 + 10000);
  const keys = ['buyPriceBnb', 'holdDuration', 'realHoldDuration', 'profitPercent',
    'drawdownFromHighestSinceLastBuy', 'peakProfitPct',
    'buySignalAt', 'buyExecutedAt'];
  for (const k of keys) {
    check(`H1 ${k} 逐键一致（${k}: ${a[k]} vs ${b[k]}）`, a[k], b[k]);
  }
  check('H1b highestPriceSinceBuyBnb 逐键一致', posPeak(fa, '0xa8'), posPeak(fa, '0xa8n'));
  check('H2 mark 消费即清（pending 不残留）', fa._states.get('0xa8')._pendingBuyFire, null);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;
