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
  check('C2 holder 臂点形状：覆盖快照（非 defer）+ 事件缓冲（defer）双路径 / push({bucket 仅价格臂',
    () => assert.ok(/_pushHolderSeriesPoint\(state, blockNumber\) \{/.test(faSrc)
      && /state\._holderSeries\.push\(\{ block: blockNumber, count: state\.holderCount \}\);/.test(faSrc)
      && /_recordHolderEvent\(state, blockNumber, tokenAmount > 0 \? walletAddr : null, isBuy, tokenAmount\)/.test(faSrc)
      && /state\._priceSeries\.push\(\{ bucket, price: state\.currentPriceBnb \}\);/.test(faSrc)));
  check('C3 两调用点形状：deferred 派发分支（wallet 段）/ 价格臂在价格接受分支内',
    () => assert.ok(/if \(vars\.deferred === true\) \{/.test(faSrc)
      && /this\._pushHolderSeriesPoint\(state, blockNumber\);/.test(faSrc)
      && /this\._pushPriceSeriesPoint\(state, ts\);/.test(faSrc)));
  check('C3b 旧合体方法名 _pushSeriesPoint 零残留',
    () => assert.ok(!faSrc.includes('_pushSeriesPoint(')));
  check('C3c 消费侧只读 h.count（不改点形状）',
    () => assert.ok(/state\._holderSeries\.map\(h => h\.count\)/.test(faSrc)));

  const fbSrc = fs.readFileSync(FACTOR_BUILDER_PATH, 'utf8');
  check('C4 FactorBuilder signal 快照（buildFactorValuesForTimeSeries）含 11 个 holderTrend 键（直接透传形态）',
    () => {
      const snapStart = fbSrc.indexOf('function buildFactorValuesForTimeSeries');
      const snapEnd = fbSrc.indexOf('\n}', snapStart);
      const snap = fbSrc.slice(snapStart, snapEnd);
      const keys = ['holderTrendDataPoints', 'holderTrendGrowthRatio', 'holderTrendRiseRatio',
        'holderTrendCV', 'holderTrendRecentDecreaseCount', 'holderTrendRecentDecreaseRatio',
        'holderTrendConsecutiveDecreases', 'holderTrendHolderCountUp', 'holderTrendMedianUp',
        'holderTrendSlope', 'holderTrendStrengthScore'];
      const missing = keys.filter(k => !new RegExp(`${k}: factorResults\\.${k},`).test(snap));
      assert.strictEqual(missing.length, 0, 'signal 快照缺键: ' + missing.join(','));
    });

  check('C5 时序机制零残留（experiment_time_series_data 2026-10-15 停写：slim 构建器与 web 时序服务文件已删）',
    () => assert.ok(!fbSrc.includes('buildSlimFactorValues'))
      && assert.ok(!fs.existsSync(TS_SERVICE_PATH)));

  const detSrc = fs.readFileSync(DETECTOR_PATH, 'utf8');
  const detMaxPoints = (detSrc.match(/const maxPoints = 8;/g) || []).length;
  check('C6 HolderTrendDetector 两处 maxPoints=8 与 FA HOLDER_SERIES_MAX_POINTS 一致（改一处必须同改另一处）',
    () => assert.strictEqual(detMaxPoints, 2)
      && assert.ok(/const HOLDER_SERIES_MAX_POINTS = 8;/.test(faSrc)));
}

// ═══════════ D 节：乱序块行为锁定（2026-10-14 两阶段喂食：wallet 段乱序回推 → 有序视图+链序正确快照） ═══════════
console.log('\nD 节：乱序块行为');
{
  const fa = newFA();
  fa.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 105 }));
  fa.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 100, block_number: 104 })); // 乱序迟到
  const st = fa._states.get('0xtoken');
  check('D1 乱序块按 append 处理（105 后到 104 → 2 点，无守卫无重排，行为与旧时间桶时钟偏移等价；'
    + ' defer 路径的乱序免疫由 _test_fa_deferred_wallet_feeding 重放断言锁定）',
    () => assert.ok(st._holderSeries.length === 2
      && st._holderSeries[0].block === 105
      && st._holderSeries[1].block === 104));
}

// ═══════════ E 节：holderTrendSlopeExSniper 剔狙击段（2026-10-29 用户裁定） ═══════════
// 语义：跳过的 slot=有交易的 slot（前 4 个有 tick 的不同 block，无交易的块不产生序列点
// 也不计入跳过数）；ExSniper 序列=第 5 个不同 block 起的子集，slope 门槛 ≥4 点不足不出键
// （`> 0` 门恒 false 拦买）。纯新增键，旧 11 键 bit 不变（E3/E5 并存断言）
console.log('\nE 节：holderTrendSlopeExSniper 剔狙击段');
{
  const evaluator = new ConditionEvaluator();
  const COND_EX = 'holderTrendSlopeExSniper > 0';

  // E1 前 4 个有交易 slot 不进 ExSniper：4 块各 1 买 → 旧键已出（4 点），ExSniper 0 点键缺失门拦
  const fa = newFA();
  for (let i = 0; i < 4; i++) {
    fa.processTick(mkTick({ trader_address: `0xE${i}`, sender_address: `0xE${i}`, timestamp: T0 + i * 100, block_number: 100 + i }));
  }
  let f = fa.buildFactorMap('0xtoken', T0 + 500);
  check('E1 前 4 slot 全剔：旧 slope 出值 >0（狙击爆发可拉正）/ExSniper 0 点键缺失门拦',
    () => assert.ok(f.holderTrendSlope > 0)
      && assert.strictEqual(f.holderTrendDataPointsExSniper, 0)
      && assert.strictEqual(f.holderTrendSlopeExSniper, undefined)
      && assert.strictEqual(evaluator.evaluate(COND_EX, f), false));

  // E2 跳过数只数「有交易的 slot」：块号大间隔（200/300/400/500）仍算前 4 slot，边界=第 5 个有 tick 块
  const fa2 = newFA();
  for (const b of [200, 300, 400, 500]) {
    fa2.processTick(mkTick({ trader_address: `0xG${b}`, sender_address: `0xG${b}`, timestamp: T0 + b, block_number: b }));
  }
  const st2 = fa2._states.get('0xtoken');
  check('E2 无交易块不计入跳过数：4 个间隔块后边界未定型（null）',
    () => assert.strictEqual(st2._holderSeries.length, 4)
      && assert.strictEqual(st2._holderExSniperStartBlock, null));
  fa2.processTick(mkTick({ trader_address: '0xG600', sender_address: '0xG600', timestamp: T0 + 600, block_number: 600 }));
  check('E2b 第 5 个有 tick 块（600）定型边界 write-once',
    () => assert.strictEqual(st2._holderExSniperStartBlock, 600));

  // E3 第 5-8 块到齐出值：slope 只算后 4 点（[5,6,7,8] 手算 1/6.5），旧键全窗并存不受影响
  for (let i = 0; i < 4; i++) {
    fa.processTick(mkTick({ trader_address: `0xF${i}`, sender_address: `0xF${i}`, timestamp: T0 + 1000 + i * 100, block_number: 104 + i }));
  }
  f = fa.buildFactorMap('0xtoken', T0 + 1500);
  check('E3 ExSniper=后 4 点斜率 1/6.5（手算对拍）/dataPointsExSniper=4/门放行',
    () => assert.ok(Math.abs(f.holderTrendSlopeExSniper - 1 / 6.5) < 1e-12)
      && assert.strictEqual(f.holderTrendDataPointsExSniper, 4)
      && assert.strictEqual(evaluator.evaluate(COND_EX, f), true));
  check('E3b 旧 11 键并存不受污染：全窗 8 点 dp=8 / slope>0（[1..8] 全史斜率 ≠ 1/6.5）',
    () => assert.strictEqual(f.holderTrendDataPoints, 8)
      && assert.ok(f.holderTrendSlope > 0)
      && assert.ok(Math.abs(f.holderTrendSlope - f.holderTrendSlopeExSniper) > 1e-9));

  // E4 狙击形状反证（v60 损失票形状）：前 4 块爆发 1→8、后 4 块横盘 8 恒定 →
  //     旧门放行（爆发段拉正）/ ExSniper 拦（横盘 slope=0 有证据零值）
  const fa4 = newFA();
  fa4.processTick(mkTick({ trader_address: '0xA', sender_address: '0xA', timestamp: T0, block_number: 100 }));           // 1
  fa4.processTick(mkTick({ trader_address: '0xB', sender_address: '0xB', timestamp: T0 + 100, block_number: 101 }));      // 2
  fa4.processTick(mkTick({ trader_address: '0xC', sender_address: '0xC', timestamp: T0 + 200, block_number: 102 }));      // 3
  for (const w of ['0xD', '0xE', '0xF', '0xG', '0xH']) {                                                                  // 块 103 狙击爆发 → 8
    fa4.processTick(mkTick({ trader_address: w, sender_address: w, timestamp: T0 + 300, block_number: 103 }));
  }
  for (let i = 0; i < 4; i++) {                                                                                           // 块 104-107 横盘 8
    const b = 104 + i;
    fa4.processTick(mkTick({ trader_address: `0xN${i}`, sender_address: `0xN${i}`, timestamp: T0 + 400 + i * 100, block_number: b }));            // 新钱包买
    fa4.processTick(mkTick({ trader_address: `0xO${i}`, sender_address: `0xO${i}`, timestamp: T0 + 450 + i * 100, block_number: b, trade_type: 'sell', token_amount: 0 })); // 占位行（tokenAmount=0 不动 count，同块覆盖=8）
  }
  const f4 = fa4.buildFactorMap('0xtoken', T0 + 1000);
  check('E4 狙击爆发+横盘：旧 slope>0 放行 / ExSniper 序列 [8,8,8,8] slope=0 拦',
    () => assert.ok(f4.holderTrendSlope > 0)
      && assert.strictEqual(f4.holderTrendDataPointsExSniper, 4)
      && assert.strictEqual(f4.holderTrendSlopeExSniper, 0)
      && assert.strictEqual(evaluator.evaluate(COND_EX, f4), false));

  // E5 边界滑出 8 点窗（≥12 不同块）→ ExSniper 子集=全窗 → 两键 bit 一致
  const fa5 = newFA();
  for (let i = 0; i < 12; i++) {
    fa5.processTick(mkTick({ trader_address: `0xZ${i}`, sender_address: `0xZ${i}`, timestamp: T0 + i * 100, block_number: 300 + i }));
  }
  const f5 = fa5.buildFactorMap('0xtoken', T0 + 2000);
  check('E5 边界滑出窗后 ExSniper === 旧 slope（bit 一致）',
    () => assert.strictEqual(f5.holderTrendSlopeExSniper, f5.holderTrendSlope)
      && assert.strictEqual(f5.holderTrendDataPointsExSniper, 8));

  // E6 defer 两阶段（resolver 乱序回推）：ExSniper 与正序直喂 bit 一致（边界在重放侧排序定型）
  const seq = [];
  for (let i = 0; i < 10; i++) {
    seq.push(mkTick({ trader_address: `0xD${i}`, sender_address: `0xD${i}`, timestamp: T0 + i * 100, block_number: 400 + i, token_amount: 100 }));
  }
  const faA = newFA();
  seq.forEach(t => faA.processTick(t, { emitFactors: false }));
  const faB = newFA();
  seq.forEach(t => faB.processTick(t, { deferWallet: true, emitFactors: false }));
  for (let i = seq.length - 1; i >= 0; i--) faB.applyWalletTick(seq[i], { emitFactors: false }); // 全倒序回推
  const fA = faA.buildFactorMap('0xtoken', T0 + 3000);
  const fB = faB.buildFactorMap('0xtoken', T0 + 3000);
  check('E6 defer 乱序回推 ExSniper 与正序 bit 一致（边界=第 5 不同 block 重放定型）',
    () => assert.strictEqual(fB.holderTrendDataPointsExSniper, fA.holderTrendDataPointsExSniper)
      && assert.strictEqual(fB.holderTrendSlopeExSniper, fA.holderTrendSlopeExSniper)
      && assert.strictEqual(faB._states.get('0xtoken')._holderExSniperStartBlock, 404));

  // E7 因子键全集（三防线自动认得；dataPoints 键无条件出探针自收）
  const keys = newFA().getFactorKeys();
  check('E7 getFactorKeys 含 ExSniper 两键',
    () => assert.ok(keys.has('holderTrendSlopeExSniper')) && assert.ok(keys.has('holderTrendDataPointsExSniper')));

  // E8 FactorBuilder 快照白名单两处透传（不落库即丢防线）
  const fbSrc2 = fs.readFileSync(FACTOR_BUILDER_PATH, 'utf8');
  check('E8 FactorBuilder 两处白名单含 ExSniper 两键',
    () => {
      const direct = (fbSrc2.match(/holderTrendSlopeExSniper: factorResults\.holderTrendSlopeExSniper,/g) || []).length;
      const list = (fbSrc2.match(/'holderTrendSlopeExSniper', 'holderTrendDataPointsExSniper',/g) || []).length;
      assert.strictEqual(direct, 1, 'signal 快照直接透传缺键');
      assert.strictEqual(list, 1, '键清单缺键');
    });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
