#!/usr/bin/env node
/**
 * 作弊盘门引擎接线单测（G1，2026-11-01）——零 DB 零网络
 *
 * 背景：CD1 观察层升级为买门（用户裁定）。引擎硬门挂 GMGN 层之前
 * （_cheatGateEvaluate await gateBuyPoint）+ 买条件评估后拉黑短路（省叙事
 * 直调/preBuy/signal 落库整条链）+ cheat 拉黑清仓联动（_cheatExitPosition
 * 走 _emitSellSignal 全清链 stallClose 同构）+ FA 三键观测投影
 * （setCheatFactors 模块级，纯观测不进条件串）+ stop 清理。
 *
 * 覆盖：
 *   A. _cheatGateEvaluate 六路径：cheat（拉黑+清仓+signal failed+拒买）/
 *      unhealthy（拦买不拉黑+signal failed 第 N 次）/ healthy（放行+投影）/
 *      timeout_fail_open（本笔放行+late 挂钩）/ insufficient_ticks·fail（放行）/
 *      service 异常（放行 error 留痕）
 *   B. _cheatGateLateConsume：迟到 cheat 补拉黑+清仓（下轮生效）；迟到
 *      unhealthy 仅投影
 *   C. _cheatExitPosition：bought 持仓全清 strategy 形状（id=cheatExit/
 *      cards='all'/sellPercentage=1/bypassDebounce=true/不锁再买）/ 卖买执行中
 *      跳过 / 非 bought 跳过 / factors null 跳过 / 异常吞不外抛
 *   D. FA 投影三键往返（cheatGrade/cheatUnhealthyGrades/cheatBlocked——
 *      模块级真 FA，用例后 clear 防跨用例残留）
 *   E. 引擎侧源码口径锁：拉黑短路位置（买条件评估后）/ stop 清理 /
 *      gate 配置物化（enabled ∧ gate.enabled 双开关）
 *
 * 用法：node scripts/_test_cheat_gate_engine.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const FA = require('../src/services/FourMemeFactorAggregator');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail !== undefined ? ` | ${JSON.stringify(detail)}` : ''}`); }
}

// 轻量引擎实例（_test_stall_close.cjs 同款 harness：prototype 直挂+手动注入）
function makeEngine(fields = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _cheatGateAwaitMs: 15000,
    _cheatBlockedTokens: new Set(),
    _cheatProjectedTokens: new Set(),
    ...fields,
  });
}
const TOKEN = { token: '0xtok', symbol: 'TST', name: 'Test', platform: 'flap', createdAt: 1700000000, creatorAddress: null };
function svcStub(impl) {
  return { gateBuyPoint: async (addr, meta, ctx, opts) => impl(addr, meta, ctx, opts) };
}
const FLAT = { sameBlockHoldPct: 1 };

(async () => {

console.log('A. _cheatGateEvaluate 六路径');
{
  // A1 cheat：拉黑 + 清仓联动 + signal failed + 拒买
  const exits = [], signals = [];
  const eng = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0 })),
    _cheatExitPosition: async (addr, why) => { exits.push({ addr, why }); },
    _updateSignalStatus: async (id, status, meta) => { signals.push({ id, status, meta }); },
  });
  const r = await eng._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-1');
  check('cheat → 拒买', r, { pass: false, reason: '作弊盘门拒买（cheat 拉黑+持仓清仓联动 [A_strong:same_block_buy_wave]）' });
  ok('cheat → 引擎侧拉黑（_cheatBlockedTokens）', eng._cheatBlockedTokens.has('0xtok'));
  check('cheat → 清仓联动（why=cheat 判定）', exits, [{ addr: '0xtok', why: 'cheat 判定' }]);
  check('cheat → signal failed reason=cheat_gate_cheat', signals.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_cheat']]);
  check('cheat → FA 投影（grade/blocked/levels/anchors 透传）', FA.getCheatFactors('0xtok'),
    { grade: 'cheat', unhealthyGrades: 0, blocked: true, levels: null, anchors: null });
  FA.clearCheatFactors('0xtok');

  // A2 unhealthy：拦买不拉黑（重判在 service 侧计数）
  const signals2 = [];
  const eng2 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'F_sbHold60' }], unhealthyGrades: 2 })),
    _cheatExitPosition: async () => { throw new Error('不应清仓'); },
    _updateSignalStatus: async (id, status, meta) => { signals2.push({ id, status, meta }); },
  });
  const r2 = await eng2._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-2');
  ok('unhealthy → 拒买（reason 带第 N 次）', r2.pass === false && r2.reason.includes('unhealthy 第 2 次'), r2);
  ok('unhealthy → 不拉黑（增量门满足自动重判）', !eng2._cheatBlockedTokens.has('0xtok'));
  check('unhealthy → signal failed reason=cheat_gate_unhealthy', signals2.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_unhealthy']]);
  check('unhealthy → FA 投影 blocked=false（levels/anchors 随 service 返回透传）', FA.getCheatFactors('0xtok'),
    { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: null, anchors: null });
  FA.clearCheatFactors('0xtok');

  // A3 healthy：放行 + 投影
  const eng3 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'healthy', reasons: [], unhealthyGrades: 0 })),
    _updateSignalStatus: async () => { throw new Error('healthy 不应落 signal failed'); },
  });
  const r3 = await eng3._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-3');
  ok('healthy → 放行', r3.pass === true && r3.info.grade === 'healthy', r3);
  check('healthy → FA 投影', FA.getCheatFactors('0xtok'), { grade: 'healthy', unhealthyGrades: 0, blocked: false, levels: null, anchors: null });
  FA.clearCheatFactors('0xtok');

  // A4 timeout_fail_open：本笔放行 + late 挂钩迟到消费
  const lateCloses = [];
  const eng4 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'timeout_fail_open', late: Promise.resolve({ status: 'analyzed', grade: 'cheat', reasons: [{ code: 'C_sbHold90' }], unhealthyGrades: 0 }) })),
    _cheatExitPosition: async (addr, why) => { lateCloses.push({ addr, why }); },
    _updateSignalStatus: async () => {},
  });
  const r4 = await eng4._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-4');
  ok('竞速超时 → 本笔放行（不阻塞买点）', r4.pass === true && r4.info.status === 'timeout_fail_open', r4);
  await new Promise((res) => setTimeout(res, 10)); // late 微任务消费
  ok('迟到 cheat → 补拉黑（下轮生效）', eng4._cheatBlockedTokens.has('0xtok'));
  check('迟到 cheat → 补清仓（why=cheat 迟到判定）', lateCloses, [{ addr: '0xtok', why: 'cheat 迟到判定' }]);
  ok('迟到 cheat → FA 投影补齐', FA.getCheatFactors('0xtok').grade === 'cheat');
  FA.clearCheatFactors('0xtok');

  // A5 放行态：insufficient_ticks / fail（含 reason 透传）
  const eng5 = makeEngine({ _cheatCheckService: svcStub(async () => ({ status: 'insufficient_ticks' })) });
  const r5 = await eng5._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-5');
  ok('insufficient_ticks → 放行（info 透传）', r5.pass === true && r5.info.status === 'insufficient_ticks', r5);
  const eng6 = makeEngine({ _cheatCheckService: svcStub(async () => ({ status: 'fail', reason: 'jev_timeout' })) });
  const r6 = await eng6._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-6');
  ok('fail → 放行（GMGN fail-open 同向：检测层故障不得拦买点）', r6.pass === true && r6.info.reason === 'jev_timeout', r6);

  // A6 service 异常：接线级异常放行（不抛出引擎）
  const eng7 = makeEngine({ _cheatCheckService: svcStub(async () => { throw new Error('wired wrong'); }) });
  const r7 = await eng7._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-7');
  ok('service 异常 → 放行不外抛（error 留痕）', r7.pass === true && r7.info.status === 'error', r7);
}

console.log('B. _cheatGateLateConsume');
{
  const closes = [];
  const eng = makeEngine({
    _cheatExitPosition: async (addr, why) => { closes.push({ addr, why }); },
  });
  eng._cheatGateLateConsume('0xtok', { grade: 'unhealthy', reasons: [{ code: 'D_famous_dominance' }], unhealthyGrades: 3 });
  ok('迟到 unhealthy → 仅投影不拉黑不清仓', !eng._cheatBlockedTokens.has('0xtok') && closes.length === 0
    && FA.getCheatFactors('0xtok').grade === 'unhealthy');
  FA.clearCheatFactors('0xtok');
  eng._cheatGateLateConsume('0xtok', null);
  eng._cheatGateLateConsume('0xtok', { status: 'insufficient_ticks' });
  ok('迟到无 grade（insufficient/fail）→ no-op', FA.getCheatFactors('0xtok') === null);
}

console.log('C. _cheatExitPosition');
{
  // C1 bought 持仓 → _emitSellSignal 全清 strategy 形状
  const sells = [];
  const eng = makeEngine({
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _tokenPool: { getToken: (addr) => ({ token: addr, symbol: 'TST', status: 'bought' }) },
    _factorAggregator: { buildFactorMap: (addr, now) => ({ tokenAddress: addr, nowIsFinite: Number.isFinite(now), profitPercent: 12.5 }) },
    _emitSellSignal: async (token, strategy, factors, tick) => { sells.push({ token, strategy, factors, tick }); },
  });
  await eng._cheatExitPosition('0xtok', 'cheat 判定');
  check('持仓 → 全清链恰一次', sells.length, 1);
  check('strategy 形状（stallClose 同构：id/cards=all/sellPercentage=1/bypassDebounce/不锁再买/无限次）',
    (({ id, action, sellPercentage, cards, bypassDebounce, priority, lockTokenAfterSell, maxExecutions }) =>
      ({ id, action, sellPercentage, cards, bypassDebounce, priority, lockTokenAfterSell, maxExecutions }))(sells[0].strategy),
    { id: 'cheatExit', action: 'sell', sellPercentage: 1, cards: 'all', bypassDebounce: true, priority: 0, lockTokenAfterSell: false, maxExecutions: null });
  ok('factors=buildFactorMap(Date.now())', sells[0].factors.nowIsFinite === true && sells[0].tick === null);

  // C2 卖/买执行中跳过（不重入）
  const eng2 = makeEngine({
    _sellingTokens: new Set(['0xtok']), _buyingTokens: new Set(),
    _tokenPool: { getToken: () => { throw new Error('不应查池'); } },
    _emitSellSignal: async () => { throw new Error('不应卖'); },
  });
  await eng2._cheatExitPosition('0xtok', 'cheat 判定');
  ok('卖执行中 → 跳过不重入', true);
  const eng2b = makeEngine({
    _sellingTokens: new Set(), _buyingTokens: new Set(['0xtok']),
    _tokenPool: { getToken: () => { throw new Error('不应查池'); } },
  });
  await eng2b._cheatExitPosition('0xtok', 'cheat 判定');
  ok('买执行中 → 跳过不重入', true);

  // C3 非 bought / 无 token 跳过
  const eng3 = makeEngine({
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _tokenPool: { getToken: () => ({ token: '0xtok', status: 'monitoring' }) },
    _factorAggregator: { buildFactorMap: () => { throw new Error('不应构建'); } },
  });
  await eng3._cheatExitPosition('0xtok', 'cheat 判定');
  ok('非 bought（monitoring）→ 静默跳过', true);
  const eng3b = makeEngine({
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _tokenPool: { getToken: () => null },
  });
  await eng3b._cheatExitPosition('0xtok', 'cheat 判定');
  ok('池无 token → 静默跳过', true);

  // C4 factors null（出窗票 build null）跳过
  const eng4 = makeEngine({
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _tokenPool: { getToken: () => ({ token: '0xtok', status: 'bought' }) },
    _factorAggregator: { buildFactorMap: () => null },
    _emitSellSignal: async () => { throw new Error('不应卖'); },
  });
  await eng4._cheatExitPosition('0xtok', 'cheat 判定');
  ok('buildFactorMap null → 静默跳过（无快照不硬卖）', true);

  // C5 异常吞（清仓链失败不外抛、不影响拉黑主路径）
  const eng5 = makeEngine({
    _sellingTokens: new Set(), _buyingTokens: new Set(),
    _tokenPool: { getToken: () => { throw new Error('pool down'); } },
  });
  let threw = false;
  try { await eng5._cheatExitPosition('0xtok', 'cheat 判定'); } catch (e) { threw = true; }
  ok('内部异常 → 吞掉不外抛（warn 留痕，拉黑不受影响）', threw === false);
}

console.log('D. FA 投影 34 键往返（因子化：grade 三键 + 13 题档 + 数值锚十八键——G8 burst 波三键+纯卖占比扩）');
{
  const FAmod = require('../src/services/FourMemeFactorAggregator');
  check('初始 null', FAmod.getCheatFactors('0xround'), null);
  const LV = { equalAmountSplit: 2, coordinatedSellBack: null, creatorFrontRun: 1,
    sellDispersion: 0, stallBurstWave: 1, amountTiering: null, sameBlockBuyWave: 3,
    insiderSupplySell: null, slowGrindPump: 2, washPair: 3, activityLevel: 0, bundledDominance: 2,
    holdingsBalance: 3 };
  const AN = { sameBlockHoldPct: 66.1, equalBandHoldPct: 57.2, washPairCount: 10,
    washPairSellPct: 95.1, washPairBuyPct: 27.3, top1HoldSupplyPct: 25.6,
    top1HoldCircPct: 53.4, famousDominancePct: 87.5, famousDominanceLevel: 'high', famousDominance: 2,
    top2HoldSupplyPct: 9.4, top1Top2HoldSupplyPct: 35.0, top1Top2FirstBuyGapSec: 1,
    clusterHoldSupplyPct: 14.5, t1PlusClusterSupplyPct: 40.1,
    burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5, noBuySellPct: 63.3 };
  FAmod.setCheatFactors('0xround', { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: LV, anchors: AN });
  check('set → get unhealthy（levels/anchors 原样往返）', FAmod.getCheatFactors('0xround'),
    { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: LV, anchors: AN });
  FAmod.setCheatFactors('0xround', { grade: 'cheat', unhealthyGrades: 0, blocked: true });
  check('同 token 二次 set 整包替换（无 levels/anchors 键原样存=引擎路径恒显式传）',
    FAmod.getCheatFactors('0xround'), { grade: 'cheat', unhealthyGrades: 0, blocked: true });
  FAmod.clearCheatFactors('0xround');
  check('clear → null', FAmod.getCheatFactors('0xround'), null);
  // _buildFactorMap 发射 30 键：探针（实例化真实 FA）验证键名在因子集内
  const fa = new FAmod({}, null);
  const keys = [...fa.getFactorKeys()]; // Set → 数组
  const need = ['cheatGrade', 'cheatUnhealthyGrades', 'cheatBlocked',
    'cheatEqualAmountSplit', 'cheatCoordinatedSellBack', 'cheatCreatorFrontRun', 'cheatSellDispersion',
    'cheatStallBurstWave', 'cheatAmountTiering', 'cheatSameBlockBuyWave', 'cheatInsiderSupplySell',
    'cheatSlowGrindPump', 'cheatWashPair', 'cheatActivityLevel', 'cheatBundledDominance',
    'cheatSameBlockHoldPct', 'cheatEqualBandHoldPct', 'cheatWashPairCount', 'cheatWashPairSellPct',
    'cheatWashPairBuyPct', 'cheatTop1HoldSupplyPct', 'cheatTop1HoldCircPct',
    'cheatFamousDominancePct', 'cheatFamousDominance',
    'cheatHoldingsBalance', 'cheatTop2HoldSupplyPct', 'cheatTop1Top2HoldSupplyPct',
    'cheatTop1Top2FirstBuyGapSec', 'cheatClusterHoldSupplyPct', 'cheatT1PlusClusterSupplyPct',
    'cheatBurstMaxGapSec', 'cheatBurstWaveBuyBnb', 'cheatBurstWaveWallets', 'cheatNoBuySellPct'];
  ok('34 键在 FA 因子集（未知因子三防线自动认得，条件串可引用）', need.every((k) => keys.includes(k)),
    need.filter((k) => !keys.includes(k)));
  // 数值序出口（grade healthy=0/unhealthy=1/cheat=2；题档 0-3；锚 % 数值直传；null 透传）——
  // registerToken+单 tick 建 state 后 buildFactorMap 直读（cheat 块纯投影）
  const T0 = 1700000000000;
  fa.registerToken('0xround', { createdAtMs: T0, totalSupply: 1e9, symbol: 'TST' });
  fa.processTick({ token_address: '0xround', trade_type: 'buy', trader_address: '0xtrader1',
    price_bnb: 5e-9, price_usd: 3e-6, bnb_amount: 0.01, token_amount: 2e6,
    block_number: 40000001, timestamp: T0 + 1000, tx_hash: '0xtx1', log_index: 0,
    price_outlier: false, platform: 'fourmeme' }, { emitFactors: false });
  FAmod.setCheatFactors('0xround', { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: LV, anchors: AN });
  const fm = fa.buildFactorMap('0xround', T0 + 2000);
  ok('buildFactorMap 出口数值化（unhealthy=1/档位映射/锚 % 直传/null 不冒充）',
    fm && fm.cheatGrade === 1 && fm.cheatUnhealthyGrades === 2 && fm.cheatBlocked === 0
    && fm.cheatSameBlockBuyWave === 3 && fm.cheatStallBurstWave === 1
    && fm.cheatActivityLevel === 0 && fm.cheatBundledDominance === 2
    && fm.cheatCoordinatedSellBack === null && fm.cheatEqualAmountSplit === 2
    && fm.cheatWashPair === 3 && fm.cheatWashPairCount === 10
    && fm.cheatWashPairSellPct === 95.1 && fm.cheatWashPairBuyPct === 27.3
    && fm.cheatSameBlockHoldPct === 66.1 && fm.cheatEqualBandHoldPct === 57.2
    && fm.cheatTop1HoldSupplyPct === 25.6 && fm.cheatTop1HoldCircPct === 53.4
    && fm.cheatFamousDominancePct === 87.5 && fm.cheatFamousDominance === 2
    && fm.cheatHoldingsBalance === 3 && fm.cheatTop2HoldSupplyPct === 9.4
    && fm.cheatTop1Top2HoldSupplyPct === 35 && fm.cheatTop1Top2FirstBuyGapSec === 1
    && fm.cheatClusterHoldSupplyPct === 14.5 && fm.cheatT1PlusClusterSupplyPct === 40.1
    && fm.cheatBurstMaxGapSec === 65 && fm.cheatBurstWaveBuyBnb === 1.02
    && fm.cheatBurstWaveWallets === 5 && fm.cheatNoBuySellPct === 63.3,
    fm ? { grade: fm.cheatGrade, bw: fm.cheatSameBlockBuyWave, sb: fm.cheatSameBlockHoldPct,
      dom: fm.cheatFamousDominance, hb: fm.cheatHoldingsBalance, t1pc: fm.cheatT1PlusClusterSupplyPct,
      nbs: fm.cheatNoBuySellPct } : 'build null');
  FAmod.clearCheatFactors('0xround');
  const fm2 = fa.buildFactorMap('0xround', T0 + 3000);
  ok('清投影 → 全 null/0（未判定语义，条件裸比较恒 false fail-closed）',
    fm2 && fm2.cheatGrade === null && fm2.cheatUnhealthyGrades === 0 && fm2.cheatBlocked === 0
    && fm2.cheatSameBlockBuyWave === null && fm2.cheatSameBlockHoldPct === null
    && fm2.cheatFamousDominance === null
    && fm2.cheatHoldingsBalance === null && fm2.cheatT1PlusClusterSupplyPct === null
    && fm2.cheatBurstMaxGapSec === null && fm2.cheatNoBuySellPct === null,
    fm2 ? fm2.cheatGrade : 'build null');
}

console.log('E. 引擎侧源码口径锁');
{
  const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  // E1 双开关物化：cheatCheck.enabled ∧ gate.enabled（两级默认关——观察层语义保留）
  ok('gate 双开关物化（service enabled ∧ gate.enabled===true）',
    src.includes("gate && _cheatCfg.gate.enabled === true") && src.includes('this._cheatCheckService.enabled'));
  // E2 拉黑短路位置：叙事否决/买入熔断短路同段之后（省叙事直调/preBuy/signal 整条链）
  const shortIdx = src.indexOf('_cheatGateEnabled && this._cheatBlockedTokens.has(tokenAddress)');
  const breakerIdx = src.indexOf('this._buyBlockedTokens.has(tokenAddress)');
  const narrativeIdx = src.indexOf('this._narrativeBlockedTokens.has(tokenAddress)');
  ok('拉黑短路在买评估链（叙事否决/熔断短路之后，preBuy 之前）',
    shortIdx > 0 && breakerIdx > 0 && narrativeIdx > 0 && narrativeIdx < breakerIdx && breakerIdx < shortIdx);
  // E3 gate 挂点在 GMGN 层之前（无 GMGN 条件腿照样硬门）
  const gateCallIdx = src.indexOf('const gate = await this._cheatGateEvaluate(tokenAddress');
  const gmgnCondIdx = src.indexOf("const gmgnCheckCondition = String(strategy.gmgnCheckCondition || '').trim();");
  ok('gate 挂点在 GMGN 条件构建之前', gateCallIdx > 0 && gmgnCondIdx > 0 && gateCallIdx < gmgnCondIdx);
  // E4 stop 清理：FA 投影逐 token 清 + 两 Set clear
  const cleanCount = (src.match(/clearCheatFactors/g) || []).length;
  ok('stop 清理在场（clearCheatFactors 引擎恰一处=stop 段逐 token 清）', cleanCount === 1);
  ok('拉黑/投影两 Set stop 清理', src.includes('_cheatProjectedTokens.clear()')
    && src.includes('this._cheatBlockedTokens.clear()'));
  // E5 gate 关（默认）时挂点走原 noteBuyPoint 观察路径（观察层语义 bit 一致）
  ok('gate 关 → 原 noteBuyPoint 观察路径保留（存量实验 bit 一致）',
    src.includes('cheatCheckInfo = this._cheatCheckService.noteBuyPoint(tokenAddress'));
  // E6 因子化预触发挂点：tick 管线买腿分支（_narrativeTriggerCheck 同位后）
  const trigIdx = src.indexOf('this._narrativeTriggerCheck(tokenAddress, factors, token);');
  const pfIdx = src.indexOf('this._cheatPrefetchCheck(tokenAddress, factors, token);');
  ok('预触发挂点在 tick 管线买腿分支（C84 触发模型同位——条件串引用 cheat 因子的自锁死防线）',
    trigIdx > 0 && pfIdx > trigIdx);
  ok('消费端扫描 /cheat[A-Z]/ 在源码（条件串引用检测）', src.includes('_scanCheatFactorConsumers'));
  // E7 faState 作用域事故现场反证（v67 首日 2026-11-02：`faState is not defined` 炸断
  // 买路径）：声明原在 preBuy 块内，C84 trigger 腿跳过 preBuy 时块外 gate 调用
  //（_cheatGateEvaluate/noteBuyPoint meta）越界引用 ReferenceError——每次 fire 即抛、
  // trades 零行。防线=声明必须提升到 _evaluateBuyPath 函数域且先于 preBuy 块，
  // 函数体内不得再有块级重复声明
  const buyPathStart = src.indexOf('async _evaluateBuyPath(token, factorResults, tick) {');
  const gateCallIdx2 = src.indexOf('this._cheatGateEvaluate(tokenAddress, token, faState', buyPathStart);
  const buyPathSlice = src.slice(buyPathStart, gateCallIdx2);
  const declIdx = buyPathSlice.indexOf('const faState = this._factorAggregator.getTokenState(tokenAddress);');
  const preBuyIdx = buyPathSlice.indexOf('shouldPerformPreCheck && this._preBuyCheckService');
  ok('faState 声明提升到 _evaluateBuyPath 函数域且先于 preBuy 块（事故现场反证）',
    buyPathStart > 0 && gateCallIdx2 > buyPathStart && declIdx > 0 && preBuyIdx > 0 && declIdx < preBuyIdx);
  ok('faState 函数体内无块级重复声明（唯一声明=提升点）',
    (buyPathSlice.match(/const faState/g) || []).length === 1);
}

console.log('F. G1 因子化预触发 _cheatPrefetchCheck（tick 管线量门→后台分析→FA 投影）');
{
  // F1 激活判定：gate 开 → 预触发跑；纯观察+无因子消费 → 不激活（配额零增量）
  const notes = [];
  const mk = (over) => makeEngine(Object.assign({
    _cheatPrefetchCondition: 'tradeCount >= 15',
    _cheatPrefetchIntervalMs: 60000,
    _cheatPrefetchAt: new Map(),
    _cheatFactorsConsumed: undefined,
    _cheatGateEnabled: false,
    _cheatCheckService: { enabled: true, noteBuyPoint: (a, m, c, cb) => { notes.push({ a, c }); } },
    _strategyEngine: {
      evaluateCondition: (cond, f) => f.__pass === true,
      getAllStrategies: () => [{ action: 'buy', condition: 'marketCap > 5' }],
    },
  }, over));
  const FACTORS_PASS = { buyVolumeBnb: 0.5, __pass: true };
  mk({ _cheatGateEnabled: true })._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  check('gate 开 → 预触发发起（noteBuyPoint 调用，source=prefetch）', notes.length, 1);

  mk({})._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN); // 观察模式+无 cheat 因子消费
  check('纯观察+条件串无 cheat 因子 → 不激活（不烧配额）', notes.length, 1);
  mk({ _cheatFactorsConsumed: true })._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  check('观察模式+条件串引用 cheat 因子 → 激活（因子门消费端在场）', notes.length, 2);
  mk({ _cheatGateEnabled: true, _cheatCheckService: { enabled: false } })
    ._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  check('service.enabled=false → 不激活', notes.length, 2);

  // F2 量门/节流/拉黑跳过
  const eng = mk({ _cheatGateEnabled: true });
  eng._cheatPrefetchCheck('0xtok', { __pass: false }, TOKEN);
  ok('量门不满足 → 不发起', eng._cheatPrefetchAt.size === 0);
  eng._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN); // 发起+记时
  eng._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  check('节流窗内 → 第二次不发起（60s 引擎侧节流，防每 tick DB tail）', notes.length, 3);
  const eng2 = mk({ _cheatGateEnabled: true, _cheatBlockedTokens: new Set(['0xtok']) });
  eng2._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  ok('gate 开+已拉黑 → 跳过（投影已终值）', notes.length === 3 && eng2._cheatPrefetchAt.size === 0);
  const eng3 = mk({ _cheatGateEnabled: true, _cheatPrefetchCondition: '' });
  eng3._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  ok('prefetchCondition 空串=显式禁用', notes.length === 3);

  // F2b 重判门分叉（2026-11-02 因子化）：未析票恒走首析门；已析票未配 reanalyze
  // → 照旧走首析门+无 factorGated（现状 bit 一致）；配了 → 已析票走重判门+
  // factorGated=true（service 跳过内部数字增量门）；重判门不过 → 不发起
  const evals = [];
  const calls = [];
  const mkGate = (over) => makeEngine(Object.assign({
    _cheatPrefetchCondition: 'tradeCount >= 15',
    _cheatReanalyzeCondition: null,
    _cheatPrefetchIntervalMs: 60000,
    _cheatPrefetchAt: new Map(),
    _cheatFactorsConsumed: true,
    _cheatGateEnabled: true,
    _cheatProjectedTokens: new Set(),
    _cheatCheckService: { enabled: true,
      noteBuyPoint: (a, m, c) => { calls.push(c); } },
    _strategyEngine: {
      evaluateCondition: (cond, f) => { evals.push(cond); return f.__pass === true; },
      getAllStrategies: () => [{ action: 'buy', condition: 'cheatGrade == 0' }],
    },
  }, over));
  const RA = { tradeCount: 60, __pass: true };
  mkGate({ _cheatReanalyzeCondition: 'tradeCount >= 40' })._cheatPrefetchCheck('0xnew', RA, TOKEN);
  ok('未析票 → 恒走首析门（配了重判门不影响首析路径）',
    evals.length === 1 && evals[0] === 'tradeCount >= 15'
    && calls.length === 1 && !calls[0].factorGated);
  evals.length = 0; calls.length = 0;
  mkGate({ _cheatProjectedTokens: new Set(['0xnew']) })._cheatPrefetchCheck('0xnew', RA, TOKEN);
  ok('已析票未配重判门 → 照旧走首析门（现状 bit 一致）+ 无 factorGated',
    evals.length === 1 && evals[0] === 'tradeCount >= 15'
    && calls.length === 1 && !calls[0].factorGated);
  evals.length = 0; calls.length = 0;
  mkGate({ _cheatProjectedTokens: new Set(['0xnew']), _cheatReanalyzeCondition: 'tradeCount >= 40' })
    ._cheatPrefetchCheck('0xnew', RA, TOKEN);
  ok('已析票配重判门 → 评重判门条件（非首析门）+ factorGated=true 传递',
    evals.length === 1 && evals[0] === 'tradeCount >= 40'
    && calls.length === 1 && calls[0].source === 'prefetch' && calls[0].factorGated === true);
  evals.length = 0; calls.length = 0;
  mkGate({ _cheatProjectedTokens: new Set(['0xnew']), _cheatReanalyzeCondition: 'tradeCount >= 40' })
    ._cheatPrefetchCheck('0xnew', { tradeCount: 20, __pass: false }, TOKEN);
  ok('重判门不满足 → 不发起（evaluateCondition false 短路）',
    evals.length === 1 && calls.length === 0);

  // F3 onResult 投影：回调收 grade → FA 20 键投影（预触发是条件串消费的供源）
  const eng4 = mk({
    _cheatGateEnabled: true,
    _cheatCheckService: { enabled: true, noteBuyPoint: (a, m, c, cb) => cb && cb({
      grade: 'cheat', reasons: [{ code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0,
      levels: { sameBlockBuyWave: 3, stallBurstWave: null },
      anchors: { sameBlockHoldPct: 72.6, famousDominance: null },
    }) },
  });
  eng4._cheatPrefetchCheck('0xtok', FACTORS_PASS, TOKEN);
  const pf = FA.getCheatFactors('0xtok');
  ok('onResult 回调 → FA 投影（预触发路径写者；anchors 随包透传）',
    pf && pf.grade === 'cheat' && pf.blocked === true && pf.levels.sameBlockBuyWave === 3
    && pf.anchors && pf.anchors.sameBlockHoldPct === 72.6 && pf.anchors.famousDominance === null);
  FA.clearCheatFactors('0xtok');

  // F4 _scanCheatFactorConsumers 字段覆盖：七字段任一含 cheatXxx 即真；卖腿不扫
  const mkScan = (legs) => makeEngine({
    _strategyEngine: { getAllStrategies: () => legs },
  });
  ok('condition 含 cheatGrade → true',
    mkScan([{ action: 'buy', condition: 'cheatGrade == 0' }])._scanCheatFactorConsumers() === true);
  ok('gmgnCheckCondition 含 cheatSameBlockBuyWave → true',
    mkScan([{ action: 'buy', gmgnCheckCondition: 'cheatSameBlockBuyWave < 3' }])._scanCheatFactorConsumers() === true);
  ok('preBuyCheckCondition/repeatBuyCheckCondition 域也扫',
    mkScan([{ action: 'buy', preBuyCheckCondition: 'x > 1', repeatBuyCheckCondition: 'cheatStallBurstWave == 0' }])._scanCheatFactorConsumers() === true);
  ok('narrativeTriggerCondition 域也扫',
    mkScan([{ action: 'buy', narrativeTriggerCondition: 'cheatActivityLevel >= 2' }])._scanCheatFactorConsumers() === true);
  ok('无关条件串 → false（常规因子/小写 cheat 前缀词不误检 /cheat[A-Z]/）',
    mkScan([{ action: 'buy', condition: 'marketCap > 5 AND cheatcoinName != 1' }])._scanCheatFactorConsumers() === false);
  ok('卖腿不扫（cheat 因子仅买腿消费）',
    mkScan([{ action: 'sell', condition: 'cheatGrade == 2' }])._scanCheatFactorConsumers() === false);

  // F5 首析门缺省口径锁（2026-11-02 用户裁定「盘面需要一定的数据量才能分析，触发
  // 条件要更严格一些」）：缺省 = tradeCount >= 15（笔数门贴 13 题证据量；高于叙事
  // 发起 0.1 BNB、低于 fire 量门 0.25 BNB 防首析晚于 fire 自锁）。旧缺省
  // buyVolumeBnb >= 0.1 不得回流（约 1-3 笔买入即过门，首析证据薄）
  const pfSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  ok('预触发首析门缺省 = tradeCount >= 15（源码口径锁）',
    pfSrc.includes("? _cheatCfg.prefetchCondition.trim() : 'tradeCount >= 15';")
    && !pfSrc.includes("'buyVolumeBnb >= 0.1'"));
}
process.exit(fail === 0 ? 0 : 1);

})().catch((e) => { console.error(e); process.exit(1); });
