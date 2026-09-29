#!/usr/bin/env node
// tokenAgeSec 因子单测（秒口径 token 年龄，2026-09-29；90s 买窗 condition 用）
// 零 DB：真 FA 实例 + ConditionEvaluator 纯函数 + FactorBuilder 时序重建路径
// 用法：node scripts/_test_token_age_sec.cjs
'use strict';

const FourMemeFactorAggregator = require('../src/services/FourMemeFactorAggregator');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { getAvailableFactorIds, buildFactorsFromTimeSeries } = require('../src/trading-engine/core/FactorBuilder');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const T0 = 1_700_000_000_000; // 固定创建锚
function makeTick(addr, ts, priceBnb = 5e-9, bnb = 0.01) {
  return {
    token_address: addr, trade_type: 'buy', trader_address: '0xtrader1',
    price_bnb: priceBnb, price_usd: priceBnb * 600, bnb_amount: bnb,
    token_amount: bnb / priceBnb, block_number: 40000001, timestamp: ts,
    tx_hash: '0xtx1', log_index: 0, price_outlier: false, platform: 'fourmeme',
  };
}

console.log('A. FA tokenAgeSec 发射（创建锚 createdAtMs，asOf 传入防前视）');
{
  const fa = new FourMemeFactorAggregator({ fourmemeWs: {} }, noopLogger);
  fa.registerToken('0xa1', { createdAtMs: T0, totalSupply: 1e9, symbol: 'TST' });
  fa.processTick(makeTick('0xa1', T0 + 1000), { emitFactors: false });
  const f = fa.buildFactorMap('0xa1', T0 + 90_000);
  check('A1 tokenAgeSec = 90（创建后 90s 评估）', f.tokenAgeSec, 90);
  check('A2 age/tokenAgeSec = 1/60 关系', f.age, f.tokenAgeSec / 60);
  const f2 = fa.buildFactorMap('0xa1', T0 + 30_000);
  check('A3 同 state 不同 asOf → 30（禁 Date.now，值随传入时刻）', f2.tokenAgeSec, 30);
  // 乱序回填更早创建锚 → 年龄变大（registerToken 幂等回填语义）
  fa.registerToken('0xa1', { createdAtMs: T0 - 60_000 });
  const f3 = fa.buildFactorMap('0xa1', T0 + 90_000);
  check('A4 迟到 TokenCreate 回填更早锚 → 150', f3.tokenAgeSec, 150);
  // 缺锚（无 info.createdAtMs）→ _createEmptyState 的 Date.now() 注册时刻兜底锚
  //（与 age 同源同行为：年龄从注册刻起算，随 asOf 增长）
  const faP = new FourMemeFactorAggregator({ fourmemeWs: {} }, noopLogger);
  faP.registerToken('0xa2', { totalSupply: 1e9 });
  const fp = faP.buildFactorMap('0xa2', Date.now() + 30_000);
  check('A5 无显式锚 → 注册时刻兜底，30s 后 ≈30（±5s 容差）', Math.abs(fp.tokenAgeSec - 30) < 5, true);
}

console.log('B. 键审计（getFactorKeys 探针自动收 → 策略 condition 可引用）');
{
  const fa = new FourMemeFactorAggregator({ fourmemeWs: {} }, noopLogger);
  check('B1 getFactorKeys 含 tokenAgeSec', fa.getFactorKeys().has('tokenAgeSec'), true);
  check('B2 getAvailableFactorIds 含 tokenAgeSec', getAvailableFactorIds().has('tokenAgeSec'), true);
}

console.log('C. ConditionEvaluator 求值（tokenAgeSec < 90 真值表）');
{
  const ev = new ConditionEvaluator();
  check('C1 89 → true', ev.evaluate('tokenAgeSec < 90', { tokenAgeSec: 89 }), true);
  check('C2 90 边界 → false', ev.evaluate('tokenAgeSec < 90', { tokenAgeSec: 90 }), false);
  check('C3 91 → false', ev.evaluate('tokenAgeSec < 90', { tokenAgeSec: 91 }), false);
  check('C4 0（缺锚 fail-open）→ true', ev.evaluate('tokenAgeSec < 90', { tokenAgeSec: 0 }), true);
  check('C5 组合 AND', ev.evaluate('tokenAgeSec < 90 AND buyVolumeBnb >= 1.5 AND holders > 5',
    { tokenAgeSec: 60, buyVolumeBnb: 2, holders: 9 }), true);
  check('C6 组合 AND 一项不满足', ev.evaluate('tokenAgeSec < 90 AND buyVolumeBnb >= 1.5',
    { tokenAgeSec: 95, buyVolumeBnb: 2 }), false);
  check('C7 与 age 并存', ev.evaluate('age < 30 AND tokenAgeSec < 90',
    { age: 1.2, tokenAgeSec: 72 }), true);
}

console.log('D. extractBuyRangeFromCondition（preFilter 年龄区间提取，秒→分钟归一）');
{
  const ex = c => ConditionEvaluator.extractBuyRangeFromCondition(c);
  check('D1 tokenAgeSec < 90 → maxAgeMinutes 1.5', ex('tokenAgeSec < 90'), { maxAgeMinutes: 1.5 });
  check('D2 tokenAgeSec <= 120 → 2', ex('tokenAgeSec <= 120'), { maxAgeMinutes: 2 });
  check('D3 tokenAgeSec > 30 → minAgeMinutes 0.5', ex('tokenAgeSec > 30'), { minAgeMinutes: 0.5 });
  check('D4 AND 取最紧（age<30 AND tokenAgeSec<90）', ex('age < 30 AND tokenAgeSec < 90'),
    { maxAgeMinutes: 1.5 });
  check('D5 OR → null（安全降级）', ex('tokenAgeSec < 90 OR age < 5'), null);
  check('D6 age >= 5 回归（下界提取保留 >=）', ex('age >= 5'), { minAgeMinutes: 5 });
  check('D7 age > 3 → 下界 3', ex('age > 3'), { minAgeMinutes: 3 });
  check('D8 语法错 → null', ex('tokenAgeSec <'), null);
}

console.log('E. FA preFilter 集成（tokenAgeSec 策略的越界 token 跳过因子构建）');
{
  const fa = new FourMemeFactorAggregator({ fourmemeWs: {} }, noopLogger);
  fa.setPreFilter([{ maxAgeMinutes: 1.5 }]); // = tokenAgeSec < 90
  fa.registerToken('0xb1', { createdAtMs: T0, totalSupply: 1e9 });
  fa.processTick(makeTick('0xb1', T0 + 1000), { emitFactors: false });
  check('E1 界内（age 60s）→ 正常产出', fa.buildFactorMap('0xb1', T0 + 60_000) === null, false);
  check('E2 越界（age 120s 未持仓）→ null 跳过', fa.buildFactorMap('0xb1', T0 + 120_000), null);
}

console.log('F. FactorBuilder 时序重建路径（tokenAgeSec = age×60 同源推导）');
{
  const tokenState = { tokenCreatedAt: new Date(T0).toISOString(), firstPrice: 5e-9 };
  const f = buildFactorsFromTimeSeries({}, tokenState, 3e-9, T0 + 90_000);
  check('F1 tokenAgeSec = age×60（90s）', f.tokenAgeSec, 90);
  check('F2 age 同步 1.5 分钟', f.age, 1.5);
  const f2 = buildFactorsFromTimeSeries({ age: 2 }, {}, 3e-9, T0); // fv.age 优先路径
  check('F3 fv.age 优先时同样 ×60', f2.tokenAgeSec, 120);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
