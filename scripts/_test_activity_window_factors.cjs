#!/usr/bin/env node
/**
 * 交易活跃度滑动窗口因子族 act* 8 键单测（2026-10-15，取代同日删除的 cycle 分桶
 * 路由）——本地零 DB 零网络。
 *
 * 8 键：actBuyBnb/actSellBnb/actNetBnb/actTrades/actTraders/actBuyers/
 *      actSellers/actNewTraders；窗口 activityWinMs 默认 10000（用户裁定：新发布
 *      Meme 10s 已不小），factorParams 可覆盖；wallet=sender||trader 口径。
 *
 * 覆盖：
 *   A. 正序派生正确性（买卖混排精确值；null wallet 行计量不计人）
 *   B. 窗口过滤（now-11s 出局 / now-10s 边界留）
 *   C. defer 乱序回推容忍（乱序补喂 == ts 全序重放对拍）
 *   D. actNewTraders firstSeen min 语义（先 T2 再回推 T1，按 T1 判新）
 *   E. 裁剪不影响窗内（>64 老事件触发 splice，窗内值不变 + length 收缩）
 *   F. 空窗零值（8 键全 0 非 null）+ getFactorKeys 探针含 8 键
 *   G. 参数覆盖（factorParams.activityWinMs 两级合并生效）
 *   H. 源码口径断言（写点段禁 Date.now / 2× 裁剪余量 / 写点在 _applyWalletAggregation）
 *   I. tickBuildSkip 无互斥（condition 直引 actTrades 正常装载）
 *   J. FactorBuilder 两处快照透传（旧输入 null 不掩盖）
 *   K. StrategyEngine fail-fast 回归（带 groups/cycle throw；干净腿正常）
 *
 * 用法：node scripts/_test_activity_window_factors.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const FourMemeFactorAggregator = require(path.join(ROOT, 'src', 'services', 'FourMemeFactorAggregator.js'));

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

const T0 = 1790802000000;
const mkTick = (o) => Object.assign({
  token_address: '0xtoken', trade_type: 'buy', trader_address: null, sender_address: null,
  price_bnb: 0.00001, price_usd: 5, bnb_amount: 1, token_amount: 1000,
  block_number: 100, timestamp: T0 + 1000, tx_hash: '0xtx', log_index: 0,
}, o);

/** 标准构造：FA + 已注册 token（不同 factorParams 覆盖经参传） */
function newFA(factorParams) {
  const cfg = factorParams ? { fourmemeWs: { factorParams } } : {};
  const fa = new FourMemeFactorAggregator(cfg, { info() {}, warn() {}, error() {} });
  fa.registerToken('0xtoken', { createdAtMs: T0, totalSupply: 1e9, symbol: 'T', creatorAddress: null });
  return fa;
}

// ═══════════════ A. 正序派生正确性 ═══════════════
console.log('A. 正序派生正确性');
{
  const NOW = T0 + 60000;
  const fa = newFA();
  // 3 买（wA 0.5+0.3、wB 0.2）+ 2 卖（wC 0.4、wA 0.1）+ 1 笔 null wallet 买 0.9
  fa.processTick(mkTick({ timestamp: NOW - 9000, trader_address: 'wA', trade_type: 'buy', bnb_amount: 0.5 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 8000, trader_address: 'wC', trade_type: 'sell', bnb_amount: 0.4 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 7000, trader_address: 'wA', trade_type: 'buy', bnb_amount: 0.3 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 6000, trade_type: 'buy', bnb_amount: 0.9 }), {}); // wallet null
  fa.processTick(mkTick({ timestamp: NOW - 5000, trader_address: 'wB', trade_type: 'buy', bnb_amount: 0.2 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 4000, trader_address: 'wA', trade_type: 'sell', bnb_amount: 0.1 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('A1 actBuyBnb = 0.5+0.3+0.9+0.2（null wallet 照计）', () => assert.ok(Math.abs(f.actBuyBnb - 1.9) < 1e-9));
  check('A2 actSellBnb = 0.4+0.1', () => assert.ok(Math.abs(f.actSellBnb - 0.5) < 1e-9));
  check('A3 actNetBnb = 买-卖', () => assert.ok(Math.abs(f.actNetBnb - 1.4) < 1e-9));
  check('A4 actTrades = 6', () => assert.strictEqual(f.actTrades, 6));
  check('A5 actTraders = 3（wA/wB/wC，null 不计人）', () => assert.strictEqual(f.actTraders, 3));
  check('A6 actBuyers = 2（wA/wB）', () => assert.strictEqual(f.actBuyers, 2));
  check('A7 actSellers = 2（wA/wC）', () => assert.strictEqual(f.actSellers, 2));
  check('A8 actNewTraders = 3（三钱包首见均在窗内，per-wallet 恰一次）', () => assert.strictEqual(f.actNewTraders, 3));

  // actNewTraders per-wallet 恰计一次：wA 窗内 3 笔，不重复计
  check('A9 同钱包多笔不重复计新', () => {
    const fa2 = newFA();
    for (let i = 0; i < 3; i++) {
      fa2.processTick(mkTick({ timestamp: NOW - 9000 + i * 1000, trader_address: 'wA', trade_type: 'buy', bnb_amount: 0.1 }), {});
    }
    const f2 = fa2.buildFactorMap('0xtoken', NOW);
    assert.strictEqual(f2.actTrades, 3);
    assert.strictEqual(f2.actNewTraders, 1);
  });
}

// ═══════════════ B. 窗口过滤 ═══════════════
console.log('B. 窗口过滤（默认 10s）');
{
  const NOW = T0 + 60000;
  const fa = newFA();
  fa.processTick(mkTick({ timestamp: NOW - 11000, trader_address: 'wOld', trade_type: 'buy', bnb_amount: 7 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 10000, trader_address: 'wEdge', trade_type: 'buy', bnb_amount: 1 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 3000, trader_address: 'wNew', trade_type: 'buy', bnb_amount: 2 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('B1 now-11s 出局（量/人数均不含 wOld）', () => {
    assert.strictEqual(f.actTrades, 2);
    assert.strictEqual(f.actTraders, 2);
    assert.ok(Math.abs(f.actBuyBnb - 3) < 1e-9);
  });
  check('B2 now-10s 边界留（<= 窗长在内）', () => assert.strictEqual(f.actTraders >= 2 && f.actBuyBnb >= 3, true));
  check('B3 边界钱包计新（首见=边界时刻 ≥ cutoff）', () => {
    // wEdge firstSeen=NOW-10000=cutoff → new；wOld firstSeen=NOW-11000<cutoff 不在窗内本就不数
    assert.strictEqual(f.actNewTraders, 2);
  });
}

// ═══════════════ C. defer 乱序回推容忍 ═══════════════
console.log('C. defer 乱序回推容忍（applyWalletTick 乱序 == ts 全序对拍）');
{
  const NOW = T0 + 60000;
  const mkRows = () => ([
    { timestamp: NOW - 9000, trader_address: 'wD', trade_type: 'buy', bnb_amount: 0.4, block_number: 110, log_index: 3 },
    { timestamp: NOW - 7000, trader_address: 'wE', trade_type: 'sell', bnb_amount: 0.6, block_number: 111, log_index: 1 },
    { timestamp: NOW - 5000, trader_address: 'wD', trade_type: 'sell', bnb_amount: 0.2, block_number: 112, log_index: 0 },
    { timestamp: NOW - 8000, trader_address: 'wF', trade_type: 'buy', bnb_amount: 1.5, block_number: 110, log_index: 7 },
  ]);
  const ACT_KEYS = ['actBuyBnb', 'actSellBnb', 'actNetBnb', 'actTrades', 'actTraders', 'actBuyers', 'actSellers', 'actNewTraders'];

  // 正序基线
  const faSeq = newFA();
  for (const r of mkRows()) faSeq.processTick(mkTick(r), {});
  const base = faSeq.buildFactorMap('0xtoken', NOW);

  // defer 乱序：价格段先按 block 序喂，wallet 段按乱序回推
  const faDef = newFA();
  const rows = mkRows();
  const byBlock = [...rows].sort((a, b) => (a.block_number - b.block_number) || (a.log_index - b.log_index));
  for (const r of byBlock) faDef.processTick(mkTick(r), { deferWallet: true });
  // 乱序回推顺序：故意打乱（wF 回查最晚）
  for (const r of [rows[2], rows[0], rows[1], rows[3]]) {
    faDef.applyWalletTick(mkTick({ ...r, price_accepted: true }));
  }
  const fDef = faDef.buildFactorMap('0xtoken', NOW);
  check('C1 乱序回推 == ts 正序全量对拍（8 键 bit 一致）', () => {
    for (const k of ACT_KEYS) assert.strictEqual(fDef[k], base[k], `${k}: ${fDef[k]} vs ${base[k]}`);
  });
  check('C2 乱序版 8 键精确值', () => {
    assert.ok(Math.abs(fDef.actBuyBnb - 1.9) < 1e-9);
    assert.ok(Math.abs(fDef.actSellBnb - 0.8) < 1e-9);
    assert.strictEqual(fDef.actTrades, 4);
    assert.strictEqual(fDef.actTraders, 3);
    assert.strictEqual(fDef.actNewTraders, 3);
  });
}

// ═══════════════ D. actNewTraders firstSeen min 语义 ═══════════════
console.log('D. firstSeen min 语义（先 T2 再回推 T1，按 T1 判新）');
{
  const NOW = T0 + 60000;
  const fa = newFA();
  // wG 窗内事件 T-5s 先到（defer 价格段不写 wallet），回推顺序：先 T-5s 再 T-15s（旧）
  fa.processTick(mkTick({ timestamp: NOW - 15000, trader_address: 'wG', trade_type: 'buy', bnb_amount: 1, block_number: 100, log_index: 0 }), { deferWallet: true });
  fa.processTick(mkTick({ timestamp: NOW - 5000, trader_address: 'wG', trade_type: 'buy', bnb_amount: 1, block_number: 110, log_index: 0 }), { deferWallet: true });
  fa.applyWalletTick(mkTick({ timestamp: NOW - 5000, trader_address: 'wG', trade_type: 'buy', bnb_amount: 1, block_number: 110, log_index: 0, price_accepted: true }));
  fa.applyWalletTick(mkTick({ timestamp: NOW - 15000, trader_address: 'wG', trade_type: 'buy', bnb_amount: 1, block_number: 100, log_index: 0, price_accepted: true }));
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('D1 回推更早 T1 后 firstSeen 取 min → 非新钱包（不随回推序漂移）', () => {
    assert.strictEqual(f.actTraders, 1);
    assert.strictEqual(f.actNewTraders, 0);
  });
  check('D2 对照：无更早事件时同形状判新', () => {
    const fa2 = newFA();
    fa2.processTick(mkTick({ timestamp: NOW - 5000, trader_address: 'wH', trade_type: 'buy', bnb_amount: 1 }), {});
    assert.strictEqual(fa2.buildFactorMap('0xtoken', NOW).actNewTraders, 1);
  });
}

// ═══════════════ E. 裁剪不影响窗内 ═══════════════
console.log('E. 摊销裁剪（>64 且头部越过 2×窗 才 splice）');
{
  const NOW = T0 + 60000;
  const fa = newFA();
  const state = fa._states.get('0xtoken');
  // 直接铺原料：70 笔老事件（ts = NOW-25s，越 2×10s 窗）+ 5 笔窗内
  for (let i = 0; i < 70; i++) {
    state._activityEvents.push({ ts: NOW - 25000, w: 'wOld' + (i % 10), buy: true, bnb: 1 });
  }
  for (let i = 0; i < 5; i++) {
    state._activityEvents.push({ ts: NOW - 4000 + i, w: 'wIn' + i, buy: i % 2 === 0, bnb: 0.5 });
  }
  const before = fa.buildFactorMap('0xtoken', NOW);
  check('E1 触发前长度 75', () => assert.strictEqual(state._activityEvents.length, 75));
  // 写点触发 prune：再喂一笔（此时头部 70 笔老事件全部 < NOW-20s 出局）
  fa.processTick(mkTick({ timestamp: NOW - 1000, trader_address: 'wLast', trade_type: 'buy', bnb_amount: 0.1 }), {});
  const after = fa.buildFactorMap('0xtoken', NOW);
  check('E2 裁剪后长度收缩到窗内 6 笔', () => assert.strictEqual(state._activityEvents.length, 6));
  check('E3 窗内值不受裁剪影响（actTrades 5+1）', () => assert.strictEqual(after.actTrades, 6));
  check('E4 actBuyBnb 窗内累计不变', () => assert.ok(Math.abs(after.actBuyBnb - 1.6) < 1e-9));
  check('E5 未越 2×窗不裁（64 阈内/余量带保护）', () => {
    const fa2 = newFA();
    const st2 = fa2._states.get('0xtoken');
    for (let i = 0; i < 100; i++) st2._activityEvents.push({ ts: NOW - 15000, w: 'wM' + i, buy: true, bnb: 1 }); // 15s > 窗 10s 但 < 2×窗 20s
    fa2.processTick(mkTick({ timestamp: NOW - 1000, trade_type: 'buy', bnb_amount: 0.1 }), {});
    assert.strictEqual(st2._activityEvents.length, 101); // 余量带内不裁
    const f2 = fa2.buildFactorMap('0xtoken', NOW);
    assert.strictEqual(f2.actTrades, 1); // 读点 ts 过滤天然不可见老行
  });
  check('E6 ≤64 不裁（摊销门槛：写点 push 后长度 64 未越阈）', () => {
    const fa3 = newFA();
    const st3 = fa3._states.get('0xtoken');
    for (let i = 0; i < 63; i++) st3._activityEvents.push({ ts: NOW - 25000, w: 'wO' + i, buy: true, bnb: 1 });
    fa3.processTick(mkTick({ timestamp: NOW - 1000, trade_type: 'buy', bnb_amount: 0.1 }), {});
    assert.strictEqual(st3._activityEvents.length, 64); // 63+1=64 ≤ 64 → 不裁
  });
  void before;
}

// ═══════════════ F. 空窗零值 + 探针 ═══════════════
console.log('F. 空窗零值 + getFactorKeys 探针');
{
  const NOW = T0 + 60000;
  const fa = newFA();
  // 只喂一笔窗外远旧事件（无任何窗内交易）
  fa.processTick(mkTick({ timestamp: NOW - 60000, trader_address: 'wX', trade_type: 'buy', bnb_amount: 5 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('F1 空窗 8 键全 0（有证据零值非 null）', () => {
    for (const k of ['actBuyBnb', 'actSellBnb', 'actNetBnb', 'actTrades', 'actTraders', 'actBuyers', 'actSellers', 'actNewTraders']) {
      assert.strictEqual(f[k], 0, `${k} 应为 0，实际 ${f[k]}`);
    }
  });
  check('F2 新 state 零交易（0 ≠ null）', () => {
    const fa2 = newFA();
    const f2 = fa2.buildFactorMap('0xtoken', NOW);
    for (const k of ['actTrades', 'actTraders', 'actNewTraders']) assert.strictEqual(f2[k], 0);
  });
  check('F3 getFactorKeys 含 8 键（探针自动收，condition 可直接引用）', () => {
    const keys = fa.getFactorKeys();
    for (const k of ['actBuyBnb', 'actSellBnb', 'actNetBnb', 'actTrades', 'actTraders', 'actBuyers', 'actSellers', 'actNewTraders']) {
      assert.ok(keys.has(k), `缺 ${k}`);
    }
  });
  check('F4 默认参数 activityWinMs=10000（静态挂载对拍）', () => {
    assert.strictEqual(FourMemeFactorAggregator.FACTOR_PARAM_DEFAULTS.activityWinMs, 10000);
  });
}

// ═══════════════ G. 参数覆盖 ═══════════════
console.log('G. factorParams.activityWinMs 覆盖');
{
  const NOW = T0 + 60000;
  const fa = newFA({ activityWinMs: 3000 });
  fa.processTick(mkTick({ timestamp: NOW - 8000, trader_address: 'wP', trade_type: 'buy', bnb_amount: 1 }), {});
  fa.processTick(mkTick({ timestamp: NOW - 2000, trader_address: 'wQ', trade_type: 'buy', bnb_amount: 2 }), {});
  const f = fa.buildFactorMap('0xtoken', NOW);
  check('G1 3s 窗：8s 前出局、2s 前留', () => {
    assert.strictEqual(f.actTrades, 1);
    assert.ok(Math.abs(f.actBuyBnb - 2) < 1e-9);
    assert.strictEqual(f.actTraders, 1);
  });
  check('G2 部分覆盖不破坏其余默认（_fp 合并垫底）', () => {
    assert.strictEqual(fa._fp.riseMinTicks, 8);
  });
}

// ═══════════════ H. 源码口径断言 ═══════════════
console.log('H. 源码口径断言（防前视/防误删防线）');
{
  const src = read('src/services/FourMemeFactorAggregator.js');
  check('H1 _activityFactors 与 _pruneActivityEvents 无 Date.now（防前视红线）', () => {
    for (const name of ['_activityFactors(state, now)', '_pruneActivityEvents(state, now)']) {
      const start = src.indexOf(name);
      assert.ok(start > 0, `${name} 未找到`);
      const end = src.indexOf('\n    }', start);
      assert.ok(!src.slice(start, end).includes('Date.now'), `${name} 体内禁 Date.now`);
    }
  });
  check('H2 裁剪余量 2×max（activityWinMs 与 netBuyWinMs 两窗取大——T76 起净买窗共用事件环）', () => {
    assert.ok(/_pruneActivityEvents[\s\S]{0,400}2 \* Math\.max\(this\._fp\.activityWinMs, this\._fp\.netBuyWinMs\)/.test(src));
  });
  check('H3 写点在 _applyWalletAggregation 尾部（每 tick 恰一次）', () => {
    const mStart = src.indexOf('_applyWalletAggregation(state, tick, vars) {');
    const mEnd = src.indexOf('\n    }', mStart);
    const body = src.slice(mStart, mEnd);
    assert.ok(body.includes('state._activityEvents.push'), '事件 push 不在 _applyWalletAggregation 体内');
    assert.ok(body.includes('_walletFirstSeenTs.set'), 'firstSeen 更新不在体内');
    // 体内位置在 holderTrend 块之后（尾部）
    assert.ok(body.indexOf('state._activityEvents.push') > body.indexOf('_pushHolderSeriesPoint'), 'push 应在 holderTrend 块后');
  });
  check('H4 读点纯函数无 latch（体内外均无状态写入词）', () => {
    const start = src.indexOf('_activityFactors(state, now) {');
    const end = src.indexOf('\n    }', start);
    const body = src.slice(start, end);
    assert.ok(!body.includes('.set(') && !body.includes('.push(') && !body.includes('.splice(') && !body.includes('.delete('), '读点不得有副作用');
  });
  check('H5 cycle×tickBuildSkip 互斥防线零残留（act* 纯读天然无互斥，勿再加防线）', () => {
    const be = read('src/trading-engine/implementations/BacktestEngine.js');
    assert.ok(!be.includes('_assertNoCycleKeyReference'), '已删防线方法不得回流');
    assert.ok(!/互斥.*throw|throw.*互斥/.test(be), '不得存在 cycle 关联互斥拒启');
  });
}

// ═══════════════ I. tickBuildSkip 无互斥 ═══════════════
console.log('I. tickBuildSkip 无互斥（condition 直引 actTrades 正常装载）');
{
  const { StrategyEngine } = require(path.join(ROOT, 'src', 'strategies', 'StrategyEngine.js'));
  const { getAvailableFactorIds } = require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  check('I1 getAvailableFactorIds 含 8 键（引擎装载键集）', () => {
    const ids = getAvailableFactorIds();
    for (const k of ['actTrades', 'actNewTraders', 'actBuyBnb']) assert.ok(ids.has(k), `缺 ${k}`);
  });
  check('I2 腿 condition 引用 actTrades 装载成功（纯读因子无互斥）', () => {
    const se = new StrategyEngine();
    se.loadStrategies([{
      id: 's1', name: 'act-leg', action: 'buy', priority: 1,
      condition: 'actTrades >= 3 AND actNewTraders >= 1 AND age < 1.5',
    }], getAvailableFactorIds());
    assert.strictEqual(se._strategies.length, 1);
  });
  check('I3 因子求值链可用（ConditionEvaluator 直评 act 键）', () => {
    const { ConditionEvaluator } = require(path.join(ROOT, 'src', 'strategies', 'ConditionEvaluator.js'));
    const ev = new ConditionEvaluator();
    assert.strictEqual(ev.evaluate('actTrades >= 3 AND actNewTraders >= 1', { actTrades: 4, actNewTraders: 2 }), true);
    assert.strictEqual(ev.evaluate('actTrades >= 3', { actTrades: 0 }), false);
  });
}

// ═══════════════ J. 快照透传 ═══════════════
console.log('J. FactorBuilder signal 快照透传（experiment_time_series_data 时序表 2026-10-15 停写，slim 构建器已删）');
{
  const { buildFactorValuesForTimeSeries } =
    require(path.join(ROOT, 'src', 'trading-engine', 'core', 'FactorBuilder.js'));
  const ACT_KEYS = ['actBuyBnb', 'actSellBnb', 'actNetBnb', 'actTrades', 'actTraders', 'actBuyers', 'actSellers', 'actNewTraders'];
  const sample = {
    actBuyBnb: 1.9, actSellBnb: 0.5, actNetBnb: 1.4, actTrades: 6,
    actTraders: 3, actBuyers: 2, actSellers: 2, actNewTraders: 3,
  };
  check('J1 signal 快照（trendFactors）8 键透传', () => {
    const snap = buildFactorValuesForTimeSeries(sample);
    for (const k of ACT_KEYS) assert.strictEqual(snap[k], sample[k], k);
  });
  check('J2 旧输入（FA 无键）→ null 不掩盖', () => {
    const snap = buildFactorValuesForTimeSeries({ currentPrice: 1 });
    for (const k of ACT_KEYS) assert.strictEqual(snap[k], null, k);
  });
  check('J3 null 输入早 return {}', () => {
    assert.deepStrictEqual(buildFactorValuesForTimeSeries(null), {});
  });
}

// ═══════════════ K. StrategyEngine fail-fast 回归 ═══════════════
console.log('K. fail-fast 回归（cycle 机制删除配套，2026-10-15）');
{
  const { StrategyEngine } = require(path.join(ROOT, 'src', 'strategies', 'StrategyEngine.js'));
  const base = { id: 's1', name: 'leg', action: 'buy', priority: 1, condition: 'actTrades >= 3' };
  check('K1 带 groups 字段 throw（含处置指引）', () => {
    const se = new StrategyEngine();
    assert.throws(() => se.loadStrategies([{ ...base, groups: 'cycle==3' }]),
      /groups.*cycle 周期分桶路由.*拒绝启动.*act\*/s);
  });
  check('K2 带 cycle 数字字段 throw（0 也拦）', () => {
    const se = new StrategyEngine();
    assert.throws(() => se.loadStrategies([{ ...base, cycle: 0 }]), /cycle/);
  });
  check('K3 空串 groups 放行（等价无字段）', () => {
    const se = new StrategyEngine();
    se.loadStrategies([{ ...base, groups: '  ' }]);
    assert.strictEqual(se._strategies.length, 1);
  });
  check('K4 干净 act* 腿正常装载', () => {
    const se = new StrategyEngine();
    se.loadStrategies([base]);
    assert.strictEqual(se._strategies.length, 1);
  });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
