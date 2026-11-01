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
  check('cheat → FA 投影（grade/blocked）', FA.getCheatFactors('0xtok'), { grade: 'cheat', unhealthyGrades: 0, blocked: true });
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
  check('unhealthy → FA 投影 blocked=false', FA.getCheatFactors('0xtok'), { grade: 'unhealthy', unhealthyGrades: 2, blocked: false });
  FA.clearCheatFactors('0xtok');

  // A3 healthy：放行 + 投影
  const eng3 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'healthy', reasons: [], unhealthyGrades: 0 })),
    _updateSignalStatus: async () => { throw new Error('healthy 不应落 signal failed'); },
  });
  const r3 = await eng3._cheatGateEvaluate('0xtok', TOKEN, FLAT, 'sig-3');
  ok('healthy → 放行', r3.pass === true && r3.info.grade === 'healthy', r3);
  check('healthy → FA 投影', FA.getCheatFactors('0xtok'), { grade: 'healthy', unhealthyGrades: 0, blocked: false });
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

console.log('D. FA 投影三键往返');
{
  const FAmod = require('../src/services/FourMemeFactorAggregator');
  check('初始 null', FAmod.getCheatFactors('0xround'), null);
  FAmod.setCheatFactors('0xround', { grade: 'unhealthy', unhealthyGrades: 2, blocked: false });
  check('set → get unhealthy', FAmod.getCheatFactors('0xround'), { grade: 'unhealthy', unhealthyGrades: 2, blocked: false });
  FAmod.setCheatFactors('0xround', { grade: 'cheat', unhealthyGrades: 0, blocked: true });
  check('同 token 二次 set 覆盖', FAmod.getCheatFactors('0xround'), { grade: 'cheat', unhealthyGrades: 0, blocked: true });
  FAmod.clearCheatFactors('0xround');
  check('clear → null', FAmod.getCheatFactors('0xround'), null);
  // _buildFactorMap 发射三键：探针（实例化真实 FA）验证键名在因子集内
  const fa = new FAmod({}, null);
  const keys = [...fa.getFactorKeys()]; // Set → 数组
  const need = ['cheatGrade', 'cheatUnhealthyGrades', 'cheatBlocked'];
  ok('三键在 FA 因子集（未知因子三防线自动认得）', need.every((k) => keys.includes(k)),
    need.filter((k) => !keys.includes(k)));
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
}

console.log(`\n${fail === 0 ? '✅' : '❌'} _test_cheat_gate_engine ${pass} 过 / ${fail} 败`);
process.exit(fail === 0 ? 0 : 1);

})().catch((e) => { console.error(e); process.exit(1); });
