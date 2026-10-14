#!/usr/bin/env node
/**
 * holderTrend 族 slot 化改造单测（2026-10-14 用户裁定）——零 DB 零网络。
 *
 * 改动语义：holderTrend 11 键原地改——原料序列从 10s 墙钟桶×8 点（80s 窗）改为
 * blockNumber 桶×8 块（≈4s 窗，BSC 出块 0.5s 中位）。价格 _priceSeries 10s 桶
 * 机制不动（trend 族不变，裁定②）。买门形状 `holderTrendSlope > 0` NULL fail-closed
 * （裁定③：键缺失/值 null 双路 ConditionEvaluator 恒 false，不写 OR NULL）。
 *
 * 运行：node scripts/_test_holder_trend_slot_series.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const DETECTOR_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'HolderTrendDetector.js');
const FACTOR_BUILDER_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'core', 'FactorBuilder.js');
const TS_SERVICE_PATH = path.join(__dirname, '..', 'src', 'web', 'services', 'ExperimentTimeSeriesService.js');

const FourMemeFactorAggregator = require(FA_PATH);
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

/** 造一笔 tick（真实 shape 对齐 collector tickRow 透传） */
function mkTick(overrides) {
  return Object.assign({
    token_address: '0xtoken',
    trade_type: 'buy',
    trader_address: null,
    sender_address: null,
    price_bnb: 0.00001,
    price_usd: 5,
    bnb_amount: 1,
    token_amount: 1000,
    block_number: 100,
    timestamp: Date.now(),
    tx_hash: '0xtx',
    log_index: 0,
  }, overrides);
}

function newFA() {
  return new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
}

const T0 = 1790802000000;

// ═══════════ A 节：机制（blockNumber 桶状态机） ═══════════
console.log('\nA 节：blockNumber 桶机制');
{
  // A1 同块覆盖：同 block 两笔 → 1 点，count=末笔时刻 holderCount
  const fa = newFA();
  fa.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 100 }));
  fa.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 100, block_number: 100 }));
  const st = fa._states.get('0xtoken');
  check('A1 同块覆盖：1 点 {block:100, count:2}（末笔快照）',
    () => assert.strictEqual(st._holderSeries.length, 1)
      && assert.strictEqual(st._holderSeries[0].block, 100)
      && assert.strictEqual(st._holderSeries[0].count, 2));

  // A2 新块追加
  fa.processTick(mkTick({ trader_address: '0xC', sender_address: '0xC', timestamp: T0 + 200, block_number: 101 }));
  check('A2 新块追加：2 点递增',
    () => assert.strictEqual(st._holderSeries.length, 2)
      && assert.strictEqual(st._holderSeries[1].block, 101)
      && assert.strictEqual(st._holderSeries[1].count, 3));

  // A3 8 块封顶：喂到第 9 块 → shift 恒 8，首点=第 2 块
  for (let b = 102; b <= 108; b++) {
    fa.processTick(mkTick({ trader_address: `0xX${b}`, sender_address: `0xX${b}`, timestamp: T0 + b, block_number: b }));
  }
  check('A3 8 块封顶（9 块进 → 首点滑到 101）',
    () => assert.strictEqual(st._holderSeries.length, 8)
      && assert.strictEqual(st._holderSeries[0].block, 101)
      && assert.strictEqual(st._holderSeries[7].block, 108));

  // A4 点形状：{block, count}（旧 .bucket 键不得回流）
  check('A4 点形状 {block,count}（无 bucket 键）',
    () => st._holderSeries.every(p => Object.keys(p).sort().join(',') === 'block,count'));

  // A5 block_number null 不推进（collector null 丢行/回测透传恒非空，不造兜底）
  const before = st._holderSeries.length;
  fa.processTick(mkTick({ trader_address: '0xN', sender_address: '0xN', timestamp: T0 + 999, block_number: null }));
  check('A5 block_number null 不推进（长度不变）',
    () => assert.strictEqual(st._holderSeries.length, before));

  // A6 解耦位：零价 tick（价格臂不推进）照样推进 holder 桶
  const fa6 = newFA();
  fa6.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 200, price_bnb: 0 }));
  const st6 = fa6._states.get('0xtoken');
  check('A6 零价 tick 照样推进 holder 桶（价格臂 0 点/holder 臂 1 点）',
    () => assert.strictEqual(st6._priceSeries.length, 0) && assert.strictEqual(st6._holderSeries.length, 1));

  // A7 价格臂 10s 桶回归不变（裁定②：同 10s 桶覆盖/跨桶追加）
  const fa7 = newFA();
  fa7.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 300, price_bnb: 0.00001 }));
  fa7.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0 + 5000, block_number: 300, price_bnb: 0.00002 })); // 同 10s 桶
  fa7.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0 + 11000, block_number: 301, price_bnb: 0.00003 })); // 跨桶
  const st7 = fa7._states.get('0xtoken');
  check('A7 价格臂 10s 桶不变：同桶覆盖末价/跨桶追加 2 点',
    () => assert.strictEqual(st7._priceSeries.length, 2)
      && assert.strictEqual(st7._priceSeries[0].price, 0.00002)
      && assert.strictEqual(st7._priceSeries[1].price, 0.00003));
}

// ═══════════ B 节：因子出口（门槛/方向/fail-closed） ═══════════
console.log('\nB 节：因子出口');
{
  const evaluator = new ConditionEvaluator();
  const COND = 'holderTrendSlope > 0';

  // B1 1 块：仅 dataPoints，族键 undefined（白名单落库为 null）
  const fa = newFA();
  fa.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 100 }));
  let f = fa.buildFactorMap('0xtoken', T0 + 500);
  check('B1 1 块仅 dataPoints=1，slope/方向族键缺失',
    () => assert.strictEqual(f.holderTrendDataPoints, 1)
      && assert.strictEqual(f.holderTrendSlope, undefined)
      && assert.strictEqual(f.holderTrendGrowthRatio, undefined)
      && assert.strictEqual(f.holderTrendHolderCountUp, undefined));
  check('B1b 键缺失路：ConditionEvaluator 评 slope>0 恒 false（fail-closed）',
    () => assert.strictEqual(evaluator.evaluate(COND, f), false));

  // B2 2-3 块：growthRatio 族出值，slope/direction 族仍缺
  fa.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 600, block_number: 101 }));
  fa.processTick(mkTick({ trader_address: '0xC', sender_address: '0xC', timestamp: T0 + 700, block_number: 102 }));
  f = fa.buildFactorMap('0xtoken', T0 + 800);
  check('B2 3 块：growthRatio=200（1→3）/riseRatio 族出值，slope 族仍缺',
    () => assert.ok(Math.abs(f.holderTrendGrowthRatio - 200) < 1e-9)
      && assert.ok(f.holderTrendRiseRatio > 0)
      && assert.strictEqual(f.holderTrendSlope, undefined));
  check('B2b 值 null 路：白名单形状（buildFactorValues ?? null）下评 slope>0 仍 false',
    () => assert.strictEqual(evaluator.evaluate(COND, { ...f, holderTrendSlope: null }), false));

  // B3 ≥4 块：全键出值；涨趋势 slope>0 → 门放行
  const ts3 = T0 + 1000;
  fa.processTick(mkTick({ trader_address: '0xD', sender_address: '0xD', timestamp: ts3, block_number: 103 }));
  f = fa.buildFactorMap('0xtoken', ts3 + 100);
  check('B3 4 块全出：slope>0 / holderCountUp=1 / strength>0',
    () => assert.ok(f.holderTrendSlope > 0)
      && assert.strictEqual(f.holderTrendHolderCountUp, 1)
      && assert.ok(f.holderTrendStrengthScore > 0));
  check('B3b 门放行：涨趋势 `holderTrendSlope > 0` 评 true',
    () => assert.strictEqual(evaluator.evaluate(COND, f), true));

  // B4 跌趋势：卖光两钱包 → slope<0 → 门拦
  const fa4 = newFA();
  fa4.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 100 }));
  fa4.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 100, block_number: 101 }));
  fa4.processTick(mkTick({ trader_address: '0xC', sender_address: '0xC', timestamp: T0 + 200, block_number: 102 }));
  fa4.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0 + 300, block_number: 103, trade_type: 'sell' }));
  fa4.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 400, block_number: 104, trade_type: 'sell' }));
  fa4.processTick(mkTick({ trader_address: '0xC', sender_address: '0xC', timestamp: T0 + 500, block_number: 105, trade_type: 'sell' }));
  const f4 = fa4.buildFactorMap('0xtoken', T0 + 600);
  check('B4 跌趋势：slope<0 且 evaluator 拦（序列 [1,2,3,2,1,0] 三连清仓）',
    () => assert.ok(f4.holderTrendSlope < 0)
      && assert.strictEqual(evaluator.evaluate(COND, f4), false));

  // B5 出值速度：4 连续块 4 tick，age ~ms 级即出 slope（旧机制需 4×10s=40s）
  const fa5 = newFA();
  const t5 = T0 + 2000;
  for (let i = 0; i < 4; i++) {
    fa5.processTick(mkTick({ trader_address: `0xF${i}`, sender_address: `0xF${i}`, timestamp: t5 + i * 50, block_number: 200 + i }));
  }
  const f5 = fa5.buildFactorMap('0xtoken', t5 + 200); // 首笔后仅 ~350ms
  check('B5 秒级出值：首笔后 350ms（4 块 4 tick）slope 已出且 >0',
    () => assert.ok(f5.holderTrendSlope > 0) && assert.strictEqual(f5.holderTrendDataPoints, 4));
}

// ═══════════ C 节：源码口径断言（repo 惯例防线） ═══════════
console.log('\nC 节：源码口径断言');
{
  const faSrc = fs.readFileSync(FA_PATH, 'utf8');
  check('C1 HOLDER_SERIES_MAX_POINTS = 8 常量在（价格臂常量独立不混）',
    () => assert.ok(/const HOLDER_SERIES_MAX_POINTS = 8;/.test(faSrc))
      && assert.ok(/const SERIES_MAX_POINTS = 8;/.test(faSrc)));
  check('C2 holder 臂点形状 push({block 在 / push({bucket 仅价格臂',
    () => assert.ok(/state\._holderSeries\.push\(\{ block: blockNumber, count: state\.holderCount \}\);/.test(faSrc))
      && assert.ok(/state\._priceSeries\.push\(\{ bucket, price: state\.currentPriceBnb \}\);/.test(faSrc)));
  check('C3 两调用点形状：holder 臂带 null 守卫（K 组后独立段）/ 价格臂在价格接受分支内',
    () => assert.ok(/if \(blockNumber !== null\) this\._pushHolderSeriesPoint\(state, blockNumber\);/.test(faSrc))
      && assert.ok(/this\._pushPriceSeriesPoint\(state, ts\);/.test(faSrc)));
  check('C3b 旧合体方法名 _pushSeriesPoint 零残留',
    () => assert.ok(!faSrc.includes('_pushSeriesPoint(')));
  check('C3c 消费侧只读 h.count（不改点形状）',
    () => assert.ok(/state\._holderSeries\.map\(h => h\.count\)/.test(faSrc)));

  const fbSrc = fs.readFileSync(FACTOR_BUILDER_PATH, 'utf8');
  check('C4 FactorBuilder slim 含 11 个 holderTrend 键（?? null 形态）',
    () => {
      const slimStart = fbSrc.indexOf('function buildSlimFactorValues');
      const slimEnd = fbSrc.indexOf('\n}', slimStart);
      const slim = fbSrc.slice(slimStart, slimEnd);
      const keys = ['holderTrendDataPoints', 'holderTrendGrowthRatio', 'holderTrendRiseRatio',
        'holderTrendCV', 'holderTrendRecentDecreaseCount', 'holderTrendRecentDecreaseRatio',
        'holderTrendConsecutiveDecreases', 'holderTrendHolderCountUp', 'holderTrendMedianUp',
        'holderTrendSlope', 'holderTrendStrengthScore'];
      const missing = keys.filter(k => !new RegExp(`${k}: factorResults\\.${k} \\?\\? null`).test(slim));
      assert.strictEqual(missing.length, 0, 'slim 缺键: ' + missing.join(','));
    });

  const tsSrc = fs.readFileSync(TS_SERVICE_PATH, 'utf8');
  check('C5 web 直读分支在 + 重算侧 holderHistory/_holders 零残留（死代码已删）',
    () => assert.ok(/HOLDER_TREND_FACTOR_KEYS\.has\(factorName\)/.test(tsSrc))
      && assert.ok(!tsSrc.includes('holderHistory'))
      && assert.ok(!/_holders\b/.test(tsSrc.split('_rebuildFactorTimeSeries')[1] || '')));

  const detSrc = fs.readFileSync(DETECTOR_PATH, 'utf8');
  const detMaxPoints = (detSrc.match(/const maxPoints = 8;/g) || []).length;
  check('C6 HolderTrendDetector 两处 maxPoints=8 与 FA HOLDER_SERIES_MAX_POINTS 一致（改一处必须同改另一处）',
    () => assert.strictEqual(detMaxPoints, 2)
      && assert.ok(/const HOLDER_SERIES_MAX_POINTS = 8;/.test(faSrc)));
}

// ═══════════ D 节：乱序块行为锁定（live WSS 偶发，无守卫=对齐旧时钟偏移行为） ═══════════
console.log('\nD 节：乱序块行为');
{
  const fa = newFA();
  fa.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 105 }));
  fa.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 100, block_number: 104 })); // 乱序迟到
  const st = fa._states.get('0xtoken');
  check('D1 乱序块按 append 处理（105 后到 104 → 2 点，无守卫无重排，行为与旧时间桶时钟偏移等价）',
    () => assert.strictEqual(st._holderSeries.length, 2)
      && assert.strictEqual(st._holderSeries[0].block, 105)
      && assert.strictEqual(st._holderSeries[1].block, 104));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
