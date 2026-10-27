#!/usr/bin/env node

/**
 * gang 资金口径毕业进度——本地零 DB 单测（2026-10-27 gang 接入）
 *
 * gang 与 flap 同走资金口径（池净入金 ÷ 毕业阈值），但两处刻意分叉：
 *   ① 系数恒 1.0/1.0：gang tick 的 bnb_amount 已是事件费后净额（Buy dw0=净入金/
 *      Sell dw3=净收款），无 flap 0.98/1.0204 经验系数——flap 系数是链上毛额入
 *      曲线的补偿，gang 事件本身已净额化，套用会双重折算（本测试的公式反证）
 *   ② 阈值链分平台：gang = state.graduationThresholdBnb（Created gradAmt 事件终态
 *      携带，registerToken set-once）?? 15；flap = per-quote noteGraduation 学习值
 *      ?? 全局常量。gang 刻意不学（gradAmt 硬性携带，混入污染共享阈值表）
 *
 * 覆盖：
 *   A. gang 净入金精确对拍（手算 Σbuy−Σsell / 1.0 系数反证 / 尘价无依赖）
 *   B. threshold 注入链（registerToken set-once / null 不覆盖已有值 / 缺省 ?? 15 /
 *      非 WNB 盘换算失败 null → 15 兜底）
 *   C. 三分支互不污染（gang/flap/four.meme 同 FA 实例并行：flap 学习表不进 gang、
 *      four.meme 72 锚路径不变、gang 不写学习表）
 *   D. noteGraduation 不学 gang（_gradFundsThresholds 零写入 + graduated 仍置位）
 *   E. graduationProgress 出键（gang 资金口径值 / platform tick 回填兜底路径）
 *
 * 用法：node scripts/_test_gang_graduation_progress.cjs
 */
'use strict';

const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function approx(name, actual, expected, eps = 1e-9) {
  if (Math.abs(actual - expected) < eps) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ≈${expected}\n    实际 ${actual}`); }
}

let feedSeq = 0;
function feedTick(fa, token, { type = 'buy', bnb = 0.1, price = 5e-9, platform = 'gang', quote = null, ts = null } = {}) {
  fa.processTick({
    token_address: token, timestamp: ts || (1790000000000 + (++feedSeq) * 500),
    trade_type: type, bnb_amount: bnb, price_bnb: price,
    block_number: 48000000 + feedSeq, log_index: feedSeq,
    trader_address: '0xfeed', sender_address: null, platform, quote_token: quote,
  }, { emitFactors: false });
}

// ═══ A. gang 净入金精确对拍 ═══
console.log('A. gang 净入金 Σbuy−Σsell（系数恒 1.0，事件已净额化）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  fa.registerToken('0xgang1', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 15 });
  // 手算：buy 4.95 + buy 0.495 − sell 0.98 − sell 0.1 = 4.365
  feedTick(fa, '0xgang1', { bnb: 4.95 });
  feedTick(fa, '0xgang1', { bnb: 0.495 });
  feedTick(fa, '0xgang1', { type: 'sell', bnb: 0.98 });
  feedTick(fa, '0xgang1', { type: 'sell', bnb: 0.1 });
  const st = fa.getTokenState('0xgang1');
  approx('Σbuy−Σsell 净额直计 4.365', st.poolInflowBnb, 4.95 + 0.495 - 0.98 - 0.1);
  // 系数反证：flap 口径会得 0.98×5.445−1.0204×1.08=4.2017…——gang 必须无系数
  approx('≠flap 系数口径（双重折算反证）', st.poolInflowBnb, 4.95 + 0.495 - 0.98 - 0.1);
  approx('progress = 4.365/15', fa._graduationFundsProgress(st), 4.365 / 15);

  // 尘价无依赖：price_bnb=0 照累积（资金口径零价格依赖，断流票可评）
  fa.registerToken('0xgang2', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 15 });
  feedTick(fa, '0xgang2', { bnb: 3.0, price: 0 });
  approx('零价 tick 照累积', fa.getTokenState('0xgang2').poolInflowBnb, 3.0);
}
console.log('');

// ═══ B. threshold 注入链 ═══
console.log('B. graduationThresholdBnb 注入链（set-once / ?? 15）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  // 缺省（非 WNB 盘换算失败传 null）→ 15 兜底（WNB 盘实测恒 15e18，协议常量字面量）
  fa.registerToken('0xt1', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: null });
  check('null → ?? 15', fa._graduationFundsThreshold(fa.getTokenState('0xt1')), 15);
  // 未传 → 15
  fa.registerToken('0xt2', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang' });
  check('未传 → 15', fa._graduationFundsThreshold(fa.getTokenState('0xt2')), 15);
  // 非 WNB 盘换算值（如 50）→ 原值
  fa.registerToken('0xt3', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 50 });
  check('非 WNB 换算值 50', fa._graduationFundsThreshold(fa.getTokenState('0xt3')), 50);
  // set-once：null 不算已设（非 WNB 盘换算失败晚到真值可落）；有值后才锁
  fa.registerToken('0xt1', { graduationThresholdBnb: 50 });
  check('null→50 晚到真值落定', fa.getTokenState('0xt1').graduationThresholdBnb, 50);
  fa.registerToken('0xt1', { graduationThresholdBnb: 15 });
  check('有值后 set-once 不覆盖', fa.getTokenState('0xt1').graduationThresholdBnb, 50);
  // null 不覆盖已有值
  fa.registerToken('0xt3', { graduationThresholdBnb: null });
  check('null 不洗掉 50', fa.getTokenState('0xt3').graduationThresholdBnb, 50);
  // ≤0 不落（防误传 0）
  fa.registerToken('0xt4', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 0 });
  check('0 不落 → 15', fa._graduationFundsThreshold(fa.getTokenState('0xt4')), 15);
}
console.log('');

// ═══ C. 三分支互不污染 ═══
console.log('C. gang/flap/four.meme 同实例并行互不污染');
{
  const fa = new FourMemeFactorAggregator({}, console);
  fa.registerToken('0xg', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 15 });
  fa.registerToken('0xf', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'flap' });
  fa.registerToken('0x4m', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'fourmeme' });
  feedTick(fa, '0xg', { bnb: 3.0 });
  feedTick(fa, '0xf', { platform: 'flap', bnb: 3.0 });
  feedTick(fa, '0x4m', { platform: 'fourmeme', bnb: 3.0 });

  approx('gang inflow=3.0（无系数）', fa.getTokenState('0xg').poolInflowBnb, 3.0);
  approx('flap inflow=0.98×3.0（系数不动）', fa.getTokenState('0xf').poolInflowBnb, 3.0 * 0.98);
  check('four.meme 零资金累积（72 锚口径隔离）', fa.getTokenState('0x4m').poolInflowBnb, 0);

  // flap 学习表值不进 gang 阈值
  fa.noteGraduation({ token: '0xf', fundsBnb: 20.5, quoteToken: null });
  check('flap 学习 null 键=20.5', fa._gradFundsThresholds.get(null), 20.5);
  check('gang 阈值仍 15（不吃共享表）', fa._graduationFundsThreshold(fa.getTokenState('0xg')), 15);
  approx('flap progress 用学习值 3×0.98/20.5', fa._graduationFundsProgress(fa.getTokenState('0xf')), (3.0 * 0.98) / 20.5);
}
console.log('');

// ═══ D. noteGraduation 不学 gang ═══
console.log('D. noteGraduation 不学 gang（graduated 仍置位）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  fa.registerToken('0xg9', { createdAtMs: 1790000000000, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 15 });
  fa.noteGraduation({ token: '0xg9', fundsBnb: 15.7, quoteToken: null });
  check('graduated 置位', fa.getTokenState('0xg9').graduated, true);
  check('学习表零写入（gang 不入表）', fa._gradFundsThresholds.size, 0);
  // 预存学习值不被 gang 毕业覆盖
  fa._gradFundsThresholds.set(null, 16.0);
  fa.noteGraduation({ token: '0xg9', fundsBnb: 99, quoteToken: null });
  check('预存值不被 gang 覆盖', fa._gradFundsThresholds.get(null), 16.0);
}
console.log('');

// ═══ E. graduationProgress 出键 ═══
console.log('E. buildFactorMap graduationProgress（gang 资金口径出键）');
{
  const fa = new FourMemeFactorAggregator({}, console);
  const createdAt = 1790000000000;
  fa.registerToken('0xgp', { createdAtMs: createdAt, totalSupply: 1e9, platform: 'gang', graduationThresholdBnb: 15 });
  feedTick(fa, '0xgp', { bnb: 7.5, ts: createdAt + 1000 });
  const f = fa.buildFactorMap('0xgp', createdAt + 2000);
  approx('progress=7.5/15=0.5', f.graduationProgress, 0.5);

  // platform 回填兜底路径：registerToken 未带 platform（tick 先到）→ tick.platform 填
  const fa2 = new FourMemeFactorAggregator({}, console);
  fa2.registerToken('0xpl', { createdAtMs: createdAt, totalSupply: 1e9 });
  feedTick(fa2, '0xpl', { bnb: 15.0, ts: createdAt + 1000 });
  const st2 = fa2.getTokenState('0xpl');
  check('tick.platform 回填', st2.platform, 'gang');
  approx('回填路径 progress=15/15（?? 15 兜底）', fa2.buildFactorMap('0xpl', createdAt + 2000).graduationProgress, 1.0);
}
console.log('');

console.log(`结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
