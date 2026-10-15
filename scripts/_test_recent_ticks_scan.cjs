#!/usr/bin/env node
/**
 * P2c _recentTicks 单趟扫描单测（2026-10-12 回测性能案）——零 DB。
 *
 * 改动语义：FA _recentTicks 的读取消费方原先各自遍历（crashSpeed 窗高点 /
 * risePct5m 谷 / trend reliable 提取；rate 族随 2026-10-13 因子清理删除、
 * cycle 族随 2026-10-15 分桶路由机制删除），合并为 _scanRecentTicks 单趟产出
 * {reliable, csWh, csWhT, riseTrough, riseTroughTs, riseRn}。
 * winTicks 产出已删（2026-10-15 批次 5c：cycle 删除后 FA 内零消费方，子数组
 * 物化=纯死产出；cycle 会话「保留产出防自遍历」的决定由本批裁定覆盖）——
 * A1 锁死返回键缺位 + 源码零标识符。
 * 对拍等价红线：
 *   - reliable = 全数组 priceReliable && priceBnb>0 提取 {t,p} 原序收集后稳定升序 sort
 *     （trend widened 全历史分支用全量 reliable，不可预切 5min 窗）
 *   - csWh/csWhT：crashSpeed 窗高点，`>` 严格大于 = 首达峰优先（原序敏感）
 *   - rise 谷三件：rsCut = max(now-5min, buyTs)；buyTs<=0 → Infinity 哨兵 = 旧代码
 *     `if (_buyTs > 0)` 整块跳过；`<=` = 最近触谷；_rn 计数在谷判定前
 *   - 窗口全读取时 now 相关（防前视红线：now 由 buildFactorMap(state, asOf) 传入）
 *
 * reference 为内嵌旧口径独立重算（filter/循环复刻），勿依赖 git show——commit 后
 * HEAD 即新实现会假绿。
 *
 * 运行：node scripts/_test_recent_ticks_scan.cjs
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

const FA_PATH = path.join(__dirname, '..', 'src', 'services', 'FourMemeFactorAggregator.js');
const FourMemeFactorAggregator = require(FA_PATH);
const { FACTOR_PARAM_DEFAULTS } = FourMemeFactorAggregator;

const RATE_WINDOW_MS = 5 * 60 * 1000; // 与 FA 模块常量同值（改窗须同步——此处仅测试镜像）

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`); }
}

function newFA() {
  return new FourMemeFactorAggregator({}, { info() {}, warn() {}, error() {} });
}

const T0 = 1790802000000;
const ADDR = '0xtok';

/** 造 tick（processTick 最小 shape） */
function mkTick(o) {
  return Object.assign({
    token_address: ADDR,
    trade_type: 'buy',
    trader_address: '0xA1',
    sender_address: '0xA1',
    price_bnb: 0.00001,
    price_usd: 0.006,
    bnb_amount: 1,
    token_amount: 1000,
    block_number: 100,
    timestamp: T0,
  }, o);
}

// ═════════════════ reference：旧口径独立重算（filter/循环复刻）═════════════════
const ref = {
  reliable(ticks) {
    const out = [];
    for (const tk of ticks) {
      if (tk.priceReliable && Number(tk.priceBnb) > 0) out.push({ t: Number(tk.ts), p: Number(tk.priceBnb) });
    }
    out.sort((a, b) => a.t - b.t); // 旧实现：原序收集后同式稳定 sort
    return out;
  },
  crashHigh(ticks, now, winMs) {
    const cut = now - winMs;
    let wh = 0, whT = 0;
    for (const tk of ticks) {
      if (!tk.priceReliable || tk.ts < cut) continue;
      const _p = Number(tk.priceBnb);
      if (_p > wh) { wh = _p; whT = tk.ts; }
    }
    return { wh, whT };
  },
  rise(ticks, now, buyTs) {
    const rateCut = now - RATE_WINDOW_MS;
    const rsCut = buyTs > 0 ? Math.max(rateCut, buyTs) : Infinity;
    let trough = Infinity, troughTs = 0, rn = 0;
    if (buyTs > 0) {
      for (const tk of ticks) {
        if (tk.ts < rsCut) continue;
        if (!tk.priceReliable || !(Number(tk.priceBnb) > 0)) continue;
        rn++;
        if (Number(tk.priceBnb) <= trough) { trough = Number(tk.priceBnb); troughTs = tk.ts; }
      }
    }
    return { trough, troughTs, rn };
  },
};

// ═══════════ A 节：_scanRecentTicks 输出 vs reference（混合形状矩阵） ═══════════
console.log('\nA 节：_scanRecentTicks vs reference');
{
  const fa = newFA();
  fa.registerToken(ADDR, { totalSupply: 1e9, createdAtMs: T0 });
  let ts = T0, price = 1e-8, block = 1000;
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    ts += 250 + Math.floor(rnd() * 600);
    if (rnd() < 0.06) ts -= Math.floor(rnd() * 9000);   // 乱序回跳（分配序≠提交序）
    price *= 0.88 + rnd() * 0.28;
    if (rnd() < 0.03) price *= 3 + rnd() * 2;             // spike（crash/rise 形状）
    let pB = price;
    if (rnd() < 0.01) pB = price * 10000;                 // 毒价（离群剔除）
    if (rnd() < 0.06) pB = 0;                             // 非价 tick
    fa.processTick(mkTick({
      timestamp: ts,
      trade_type: rnd() < 0.35 ? 'sell' : 'buy',
      price_bnb: pB,
      price_usd: pB > 0 ? pB * 600 : 0,
      bnb_amount: rnd() < 0.12 ? 0.0005 : 0.5 + rnd() * 2, // 12% 尘额（priceReliable=false）
      block_number: (block += rnd() < 0.5 ? 0 : 1),
    }));
  }
  const st = fa._states.get(ADDR);
  const ticks = st._recentTicks;
  check('A0 序列已产生超窗残留（摊销裁剪语义下数组非纯窗内）',
    () => assert.ok(ticks.length > 0));

  // 多时点 × 有/无 buyTs 对拍
  const probes = [
    ['无仓', 0], ['有仓', ts - 60000], ['有仓(近)', ts - 5000],
  ];
  for (const [label, buyTs] of probes) {
    const now = ts + 120000; // 2min 后（含窗边界滑动）
    const s = fa._scanRecentTicks(st, now, buyTs);
    const rR = ref.reliable(ticks);
    const rC = ref.crashHigh(ticks, now, FACTOR_PARAM_DEFAULTS.crashSpeedWindowMs);
    const rRise = ref.rise(ticks, now, buyTs);
    check(`A1 [${label}] winTicks 死产出已删（返回键缺位）`,
      () => assert.ok(!('winTicks' in s)));
    check(`A2 [${label}] reliable 提取+升序一致`,
      () => assert.deepStrictEqual(s.reliable, rR));
    check(`A3 [${label}] crashSpeed 窗高点/首达时刻一致`,
      () => assert.deepStrictEqual({ wh: s.csWh, whT: s.csWhT }, rC));
    check(`A4 [${label}] rise 谷三件一致`,
      () => assert.deepStrictEqual({ trough: s.riseTrough, troughTs: s.riseTroughTs, rn: s.riseRn }, rRise));
  }

  // buyTs=0 → Infinity 哨兵（旧代码整块跳过 = 零样本）
  const s0 = fa._scanRecentTicks(st, ts + 1000, 0);
  check('A5 buyTs=0 → rise 三件零样本（Infinity/0/0）',
    () => assert.deepStrictEqual(
      [s0.riseTrough, s0.riseTroughTs, s0.riseRn], [Infinity, 0, 0]));

  // 重复 ts 触谷：`<=` = 最近触谷（后写同价胜出）
  const fa2 = newFA();
  fa2.registerToken(ADDR, { totalSupply: 1e9, createdAtMs: T0 });
  fa2.processTick(mkTick({ timestamp: T0, price_bnb: 0.001, bnb_amount: 1 }));
  fa2.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.002, bnb_amount: 1 }));
  fa2.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.002, bnb_amount: 1, trade_type: 'sell' })); // 重复 ts 同价
  const st2 = fa2._states.get(ADDR);
  const s2 = fa2._scanRecentTicks(st2, T0 + 2000, T0 + 500);
  const r2 = ref.rise(st2._recentTicks, T0 + 2000, T0 + 500);
  check('A6 重复 ts 同价触谷：最近触谷一致（troughTs=T0+1000）',
    () => assert.strictEqual(s2.riseTroughTs, T0 + 1000) && assert.deepStrictEqual(
      { t: s2.riseTrough, x: s2.riseTroughTs, n: s2.riseRn }, { t: r2.trough, x: r2.troughTs, n: r2.rn }));

  // 乱序首达峰：先写高价后写同价 → 严格大于 = 首写者胜
  const fa3 = newFA();
  fa3.registerToken(ADDR, { totalSupply: 1e9, createdAtMs: T0 });
  fa3.processTick(mkTick({ timestamp: T0 + 5000, price_bnb: 0.005, bnb_amount: 1, block_number: 102 }));
  fa3.processTick(mkTick({ timestamp: T0 + 1000, price_bnb: 0.005, bnb_amount: 1, block_number: 101 })); // 迟到同价
  const s3 = fa3._scanRecentTicks(fa3._states.get(ADDR), T0 + 6000, 0);
  check('A7 crashSpeed 窗高点首达语义（严格大于：迟到同价不夺峰）',
    () => assert.strictEqual(s3.csWhT, T0 + 5000));
}

// ═══════════ B 节：buildFactorMap 关键因子 vs reference 重算 ═══════════
console.log('\nB 节：buildFactorMap 关键因子 vs reference');
{
  const fa = newFA();
  fa.registerToken(ADDR, { totalSupply: 1e9, createdAtMs: T0 });
  let ts = T0, price = 1e-8, block = 1000;
  let seed = 99;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 1200; i++) {
    ts += 300 + Math.floor(rnd() * 700);
    if (rnd() < 0.05) ts -= Math.floor(rnd() * 7000);
    price *= 0.9 + rnd() * 0.25;
    if (rnd() < 0.04) price *= 2.5;
    let pB = price;
    if (rnd() < 0.02) pB = price * 5000;
    if (rnd() < 0.05) pB = 0;
    fa.processTick(mkTick({
      timestamp: ts,
      trade_type: rnd() < 0.4 ? 'sell' : 'buy',
      price_bnb: pB,
      price_usd: pB > 0 ? pB * 600 : 0,
      bnb_amount: rnd() < 0.15 ? 0.001 : 0.5 + rnd() * 2,
      block_number: (block += rnd() < 0.5 ? 0 : 1),
    }));
    if (i === 600) fa.setBuyState(ADDR, { buyPriceBnb: price, buyPriceUsd: price * 600, buyTime: ts });
  }
  const st = fa._states.get(ADDR);
  const now = ts + 90000;
  const f = fa.buildFactorMap(ADDR, now);

  // rate 族（2026-10-13 删除）与 cycle 族（2026-10-15 删除）不再对拍——
  // winTicks 死产出已删（批次 5c），B 节直接从 crashSpeed 起

  // crashSpeed
  const rC = ref.crashHigh(st._recentTicks, now, FACTOR_PARAM_DEFAULTS.crashSpeedWindowMs);
  let csExp = null;
  if (rC.wh > 0 && rC.whT > 0 && now > rC.whT) {
    const ddW = ((st._relPriceBnb - rC.wh) / rC.wh) * 100;
    if (ddW < 0) csExp = ddW / Math.max((now - rC.whT) / 1000, FACTOR_PARAM_DEFAULTS.crashSpeedMinDtMs / 1000);
  }
  check('B3 crashSpeedPctPerSec 一致', () => assert.strictEqual(JSON.stringify(f.crashSpeedPctPerSec), JSON.stringify(csExp)));

  // risePct5m/riseVel5m（持仓口径）
  const pos = st._positions.get(st._lastPositionKey);
  const buyTs = Number(pos?.buyTime) || 0;
  const rRise = ref.rise(st._recentTicks, now, buyTs);
  let riseExp = null, velExp = null;
  if (buyTs > 0 && rRise.rn >= FACTOR_PARAM_DEFAULTS.riseMinTicks && rRise.trough > 0
    && rRise.troughTs > 0 && st._relPriceBnb > 0) {
    riseExp = (st._relPriceBnb / rRise.trough - 1) * 100;
    velExp = riseExp / Math.max((now - rRise.troughTs) / 60000, FACTOR_PARAM_DEFAULTS.riseMinElapsedMin);
  }
  check('B4 risePct5m/riseVel5m 一致',
    () => assert.strictEqual(JSON.stringify(f.risePct5m), JSON.stringify(riseExp))
      && assert.strictEqual(JSON.stringify(f.riseVel5m), JSON.stringify(velExp)));

  // trend 2 因子：输入等价 → 输出等价（_computePriceTrendFactors 纯函数，输入 = reference reliable；
  // spikeCurve/riseFromLow6s/ddWinHigh 族已随 2026-10-13 因子清理删除）
  const tf = fa._computePriceTrendFactors(ref.reliable(st._recentTicks), now, st.firstTickAt);
  check('B5 trend 2 因子一致（reliable 输入等价路径）',
    () => assert.strictEqual(JSON.stringify({
      a: f.priceTrendSlope, c: f.recentRiseFromWindowLowPct,
    }), JSON.stringify({
      a: tf.priceTrendSlope, c: tf.recentRiseFromWindowLowPct,
    })));

  // B6/B7（cycleGapMedianMs/tokenCycle）已随 cycle 分桶路由机制删除（2026-10-15）
}

// ═══════════ C 节：防前视红线——扫描窗 now 全由 asOf 传入 ═══════════
console.log('\nC 节：防前视红线');
{
  const fa = newFA();
  fa.registerToken(ADDR, { totalSupply: 1e9, createdAtMs: T0 });
  fa.processTick(mkTick({ timestamp: T0, price_bnb: 0.001, bnb_amount: 1 }));
  fa.processTick(mkTick({ timestamp: T0 + 10000, price_bnb: 0.002, bnb_amount: 1 }));
  const st = fa._states.get(ADDR);
  // 同一 state，不同 asOf → 窗内容不同（证明窗口判定吃 asOf 而非墙钟；
  // winTicks 已删，改用 crashSpeed 窗高点观察：近点两 tick 在窗内高点 0.002 /
  // 远点全出窗高点 0——crashSpeedWindowMs 默认 60s 窄于 5min 窗，判据同族）
  const sA = fa._scanRecentTicks(st, T0 + 11000, 0);
  const sB = fa._scanRecentTicks(st, T0 + 400000, 0); // 远点：两 tick 全出 crashSpeed 窗
  check('C1 窗判定吃 asOf（近点 csWh=0.002 / 远点 csWh=0）',
    () => assert.strictEqual(sA.csWh, 0.002) && assert.strictEqual(sB.csWh, 0));
  // 源码口径：_scanRecentTicks / _computePriceTrendFactors 内无 Date.now
  //（_cycleFactors 已随 cycle 机制删除，2026-10-15）
  const src = fs.readFileSync(FA_PATH, 'utf8');
  const slice = (fromName, toName) => {
    const i = src.indexOf(fromName);
    const j = src.indexOf(toName, i);
    return src.slice(i, j);
  };
  const scanBody = slice('_scanRecentTicks(state, now, buyTs) {', '_pruneClsTicks');
  const trendBody = slice('_computePriceTrendFactors(reliable, now, firstTickAt) {', '_positionFactors(state, pos, now)');
  // 匹配真实调用形式 Date.now()——注释里的红线说明文字（「禁 Date.now」）无括号不误报
  check('C2 两函数体内零 Date.now() 调用（防前视红线）',
    () => assert.ok(!/Date\.now\(\)/.test(scanBody)
      && !/Date\.now\(\)/.test(trendBody) && scanBody.length > 0 && trendBody.length > 0));
}

// ═══════════ D 节：源码口径——_recentTicks 引用收口 ═══════════
console.log('\nD 节：源码口径（防第六个直接遍历）');
{
  const src = fs.readFileSync(FA_PATH, 'utf8').split('\n');
  const hits = [];
  src.forEach((line, i) => { if (line.includes('state._recentTicks') || line.includes('this._recentTicks')) hits.push(`${i + 1}:${line.trim()}`); });
  check('D1 state._recentTicks 引用仅三处（push 写入 / prune 摊销 / scan 单趟读取）',
    () => assert.strictEqual(hits.length, 3, `实际 ${hits.length} 处: ${hits.join(' | ')}`)
      && assert.ok(hits[0].includes('push(') || hits.some(h => h.includes('push(')))
      && assert.ok(hits.some(h => h.includes('const ticks = state._recentTicks'))));
  // 消费方签名收口：trend 收 reliable（不再自己摸 state；rate/cycle 消费方已随
  // 2026-10-13 / 2026-10-15 两轮因子清理删除；winTicks 死产出批次 5c 删除）
  check('D2 消费方签名已收口（_computePriceTrendFactors(reliable, now, firstTickAt)）',
    () => assert.ok(/_computePriceTrendFactors\(reliable, now, firstTickAt\)/.test(src.join('\n'))));
  // winTicks 产出形状零残留（死产出删除防回流；头注历史说明文字刻意保留不算）
  check('D2b winTicks 产出形状零残留（无物化/无返回键）',
    () => assert.ok(!/winTicks\s*=\s*\[\]|winTicks\.push|winTicks,/.test(src.join('\n'))));
  // buildFactorMap 挂载点：单次 _scanRecentTicks 调用喂全部消费方
  const joined = src.join('\n');
  check('D3 挂载点单次调用（_scan 调用恰一处）且消费方全吃 _scan 产物',
    () => {
      const calls = joined.match(/this\._scanRecentTicks\(/g) || [];
      return assert.strictEqual(calls.length, 1)
        && assert.ok(/_computePriceTrendFactors\(_scan\.reliable, now, state\.firstTickAt\)/.test(joined))
        && assert.ok(/_scan\.csWh/.test(joined) && /_scan\.riseTrough/.test(joined));
    });
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
