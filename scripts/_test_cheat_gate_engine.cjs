#!/usr/bin/env node
/**
 * 作弊盘门引擎接线单测（CD158 重构，2026-11-03）——零 DB 零网络
 *
 * 背景：作弊门重构为「买信号驱动的最后一层买条件」（用户裁定）——腿携带
 * cheatCheckCondition（FA 因子表达式）才走门（GMGN 前）；判定粘滞
 * （cheat=拉黑终态 / healthy=同版秒回 / unhealthy=每买信号重判）；拒/放由
 * 腿表达式在 grade 投影后的因子表上评估（只合并 cheat 键进 fire 快照——防
 * settle+Jev 竞速窗内非 cheat 臂漂移）；预触发/观察模式/增量门/顶帽全退役。
 *
 * 覆盖：
 *   A. _cheatGateEvaluate 新路径：cheat（拉黑+清仓+signal failed，不评表达式）/
 *      healthy·unhealthy 条件评估（false=cheat_gate_condition 拒 / true=放行
 *      info 带 cached·condition·conditionPassed）/ 表达式异常 fail-closed
 *      （cheat_gate_condition_error）/ buildFactorMap null fail-open
 *      （cheat_gate_context_null）/ timeout（放行+late 挂钩）/
 *      insufficient_ticks·fail（放行）/ service 异常（放行 error 留痕）
 *   A9. _buildCheatGateContext 只合并 cheat 键（fire 快照非 cheat 键保留原值
 *      =两门同刻防线）；cheat 键集惰性派生；null 透传
 *   B. _cheatGateLateConsume：迟到 cheat 补拉黑+清仓（下轮生效）；迟到
 *      unhealthy 仅投影
 *   C. _cheatExitPosition：bought 持仓全清 strategy 形状（id=cheatExit/
 *      cards='all'/sellPercentage=1/bypassDebounce=true/不锁再买）/ 卖买执行中
 *      跳过 / 非 bought 跳过 / factors null 跳过 / 异常吞不外抛
 *   D. FA 投影 45 键往返（cheatGrade/cheatUnhealthyGrades/cheatBlocked——
 *      模块级真 FA，用例后 clear 防跨用例残留）
 *   E. 引擎侧源码口径锁：拉黑双源短路位置 / 门挂点（腿字段+GMGN 前）/
 *      stop 清理（FA 投影+两 Set+throttle）/ faState 提升（v67 事故反证）/
 *      预触发·观察模式·增量门·顶帽全链退役反证
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

// 轻量引擎实例（prototype 直挂+手动注入；_cheatFactorKeys=null 对齐真 ctor）
function makeEngine(fields = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _cheatGateAwaitMs: 15000,
    _cheatBlockedTokens: new Set(),
    _cheatProjectedTokens: new Set(),
    _cheatFactorKeys: null,
    ...fields,
  });
}
const TOKEN = { token: '0xtok', symbol: 'TST', name: 'Test', platform: 'flap', createdAt: 1700000000, creatorAddress: null };
function svcStub(impl) {
  return { gateBuyPoint: async (addr, meta, ctx, opts) => impl(addr, meta, ctx, opts) };
}
// FA 桩：buildFactorMap 出投影后 cheat 数值（grade healthy=0/unhealthy=1），
// getFactorKeys 探针域=常规两键+cheat 三键（_buildCheatGateContext 派生用）
function faStub(cheatGrade) {
  return {
    buildFactorMap: () => ({ marketCap: 50, tradeCount: 99, cheatGrade, cheatBlocked: 0, cheatWashPairCount: 3 }),
    getFactorKeys: () => ['marketCap', 'tradeCount', 'cheatGrade', 'cheatBlocked', 'cheatWashPairCount'],
  };
}

(async () => {

console.log('A. _cheatGateEvaluate 新路径（grade 只投影不决策，拒/放=腿表达式）');
{
  // A1 cheat：拉黑 + 清仓联动 + signal failed + 拒买（不评表达式——buildFactorMap 桩抛错反证）
  const exits = [], signals = [];
  const eng = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0 })),
    _cheatExitPosition: async (addr, why) => { exits.push({ addr, why }); },
    _updateSignalStatus: async (id, status, meta) => { signals.push({ id, status, meta }); },
    _factorAggregator: { buildFactorMap: () => { throw new Error('cheat 路径不评表达式不应重建上下文'); } },
  });
  const r = await eng._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-1', 'cheatGrade == 0', {});
  check('cheat → 拒买', r, { pass: false, reason: '作弊盘门拒买（cheat 拉黑+持仓清仓联动 [A_strong:same_block_buy_wave]）' });
  ok('cheat → 引擎侧拉黑（_cheatBlockedTokens）', eng._cheatBlockedTokens.has('0xtok'));
  check('cheat → 清仓联动（why=cheat 判定）', exits, [{ addr: '0xtok', why: 'cheat 判定' }]);
  check('cheat → signal failed reason=cheat_gate_cheat', signals.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_cheat']]);
  check('cheat → FA 投影（grade/blocked/levels/anchors 透传）', FA.getCheatFactors('0xtok'),
    { grade: 'cheat', unhealthyGrades: 0, blocked: true, levels: null, anchors: null });
  FA.clearCheatFactors('0xtok');

  // A2 unhealthy + 条件 false → signal failed reason=cheat_gate_condition
  const signals2 = [];
  const eng2 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'D_famous_dominance' }], unhealthyGrades: 2 })),
    _cheatExitPosition: async () => { throw new Error('unhealthy 不应清仓'); },
    _updateSignalStatus: async (id, status, meta) => { signals2.push({ id, status, meta }); },
    _factorAggregator: faStub(1),
  });
  const r2 = await eng2._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-2', 'cheatGrade == 0', {});
  ok('unhealthy + cheatGrade==0（投影值 1）→ 拒买', r2.pass === false && r2.reason.includes('grade=unhealthy'), r2);
  ok('unhealthy 拒 → 不拉黑（下个买信号自动重判）', !eng2._cheatBlockedTokens.has('0xtok'));
  check('unhealthy 条件拒 → signal failed reason=cheat_gate_condition',
    signals2.map((s) => [s.status, s.meta.reason]), [['failed', 'cheat_gate_condition']]);
  check('unhealthy → FA 投影 blocked=false', FA.getCheatFactors('0xtok'),
    { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: null, anchors: null });
  FA.clearCheatFactors('0xtok');

  // A2b unhealthy + 条件 true（如 cheatGrade != 2 放行 unhealthy）→ 放行 info 带 conditionPassed
  const eng2b = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [], unhealthyGrades: 3 })),
    _factorAggregator: faStub(1),
  });
  const r2b = await eng2b._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-2b', 'cheatGrade != 2', {});
  ok('unhealthy + 条件 true → 放行', r2b.pass === true, r2b);
  check('info 形状（grade/cached=false/condition/conditionPassed=true/unhealthyGrades）',
    (({ status, grade, cached, condition, conditionPassed, unhealthyGrades }) =>
      ({ status, grade, cached, condition, conditionPassed, unhealthyGrades }))(r2b.info),
    { status: 'analyzed', grade: 'unhealthy', cached: false, condition: 'cheatGrade != 2', conditionPassed: true, unhealthyGrades: 3 });
  FA.clearCheatFactors('0xtok');

  // A3 healthy + 条件 true → 放行 + info.cached 透传（粘滞秒回形状）
  const eng3 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'graded', grade: 'healthy', cached: true, reasons: [], unhealthyGrades: 0 })),
    _updateSignalStatus: async () => { throw new Error('条件过不应落 signal failed'); },
    _factorAggregator: faStub(0),
  });
  const r3 = await eng3._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-3', 'cheatGrade == 0', {});
  ok('healthy（粘滞秒回）+ 条件 true → 放行', r3.pass === true
    && r3.info.grade === 'healthy' && r3.info.cached === true && r3.info.conditionPassed === true, r3.info);
  check('healthy → FA 投影', FA.getCheatFactors('0xtok'), { grade: 'healthy', unhealthyGrades: 0, blocked: false, levels: null, anchors: null });
  FA.clearCheatFactors('0xtok');

  // A3b healthy + 条件 false → 拒（粘滞不豁免腿表达式）
  const signals3 = [];
  const eng3b = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'graded', grade: 'healthy', cached: true, reasons: [], unhealthyGrades: 0 })),
    _updateSignalStatus: async (id, status, meta) => { signals3.push({ id, status, meta }); },
    _factorAggregator: faStub(0),
  });
  const r3b = await eng3b._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-3b', 'cheatGrade == 2', {});
  ok('healthy + 条件 false → 拒买（grade 过门条件不过）', r3b.pass === false && r3b.reason.includes('grade=healthy'), r3b);
  check('healthy 条件拒 → signal failed reason=cheat_gate_condition',
    signals3.map((s) => s.meta.reason), ['cheat_gate_condition']);
  FA.clearCheatFactors('0xtok');

  // A4 表达式评估异常 → fail-closed 拒（GMGN 同向裁定：语法/键集错=配置错误）
  const signals4 = [];
  const eng4 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'healthy', reasons: [], unhealthyGrades: 0 })),
    _updateSignalStatus: async (id, status, meta) => { signals4.push({ id, status, meta }); },
    _factorAggregator: faStub(0),
  });
  const r4 = await eng4._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-4', '(cheatGrade ==', {});
  ok('表达式语法异常 → fail-closed 拒（不 fail-open 放行）', r4.pass === false, r4);
  check('表达式异常 → signal failed reason=cheat_gate_condition_error',
    signals4.map((s) => s.meta.reason), ['cheat_gate_condition_error']);

  // A5 buildFactorMap null（token 出池）→ fail-open 放行（接线级异常不拦买点）
  const eng5 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'healthy', reasons: [], unhealthyGrades: 0 })),
    _factorAggregator: faStub(0),
  });
  eng5._buildCheatGateContext = () => null; // 出池形状直挂
  const r5 = await eng5._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-5', 'cheatGrade == 0', {});
  check('context null → fail-open 放行（reason=cheat_gate_context_null）', r5,
    { pass: true, info: { status: 'error', grade: 'healthy', reason: 'cheat_gate_context_null' } });
  FA.clearCheatFactors('0xtok');

  // A6 timeout_fail_open：本笔放行 + late 挂钩迟到消费
  const lateCloses = [];
  const eng6 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'timeout_fail_open', late: Promise.resolve({ status: 'analyzed', grade: 'cheat', reasons: [{ code: 'A_strong:wash_pair' }], unhealthyGrades: 0 }) })),
    _cheatExitPosition: async (addr, why) => { lateCloses.push({ addr, why }); },
    _updateSignalStatus: async () => {},
  });
  const r6 = await eng6._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-6', 'cheatGrade == 0', {});
  ok('竞速超时 → 本笔放行（不阻塞买点）', r6.pass === true && r6.info.status === 'timeout_fail_open', r6);
  await new Promise((res) => setTimeout(res, 10)); // late 微任务消费
  ok('迟到 cheat → 补拉黑（下轮生效）', eng6._cheatBlockedTokens.has('0xtok'));
  check('迟到 cheat → 补清仓（why=cheat 迟到判定）', lateCloses, [{ addr: '0xtok', why: 'cheat 迟到判定' }]);
  ok('迟到 cheat → FA 投影补齐', FA.getCheatFactors('0xtok').grade === 'cheat');
  FA.clearCheatFactors('0xtok');

  // A7 放行态：insufficient_ticks / fail（含 reason 透传）——不评表达式
  const eng7 = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'insufficient_ticks' })),
    _factorAggregator: { buildFactorMap: () => { throw new Error('放行态不应重建上下文'); } },
  });
  const r7 = await eng7._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-7', 'cheatGrade == 0', {});
  ok('insufficient_ticks → 放行（info 透传，不评表达式）', r7.pass === true && r7.info.status === 'insufficient_ticks', r7);
  const eng8 = makeEngine({ _cheatCheckService: svcStub(async () => ({ status: 'fail', reason: 'jev_timeout' })) });
  const r8 = await eng8._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-8', 'cheatGrade == 0', {});
  ok('fail → 放行（GMGN fail-open 同向：检测层故障不得拦买点）', r8.pass === true && r8.info.reason === 'jev_timeout', r8);

  // A8 service 异常：接线级异常放行（不抛出引擎）
  const eng9 = makeEngine({ _cheatCheckService: svcStub(async () => { throw new Error('wired wrong'); }) });
  const r9 = await eng9._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-9', 'cheatGrade == 0', {});
  ok('service 异常 → 放行不外抛（error 留痕）', r9.pass === true && r9.info.status === 'error', r9);
}

console.log('A9. _buildCheatGateContext 只合并 cheat 键（两门同刻防线）');
{
  const eng = makeEngine({
    _factorAggregator: {
      // rebuilt 带 fire 后漂移的常规键（marketCap 999 vs fire 111）+ 投影后的 cheat 键
      buildFactorMap: () => ({ marketCap: 999, buyVolumeBnb: 999, cheatGrade: 1, cheatBlocked: 0, cheatWashPairCount: 7 }),
      getFactorKeys: () => ['marketCap', 'buyVolumeBnb', 'tradeCount', 'cheatGrade', 'cheatBlocked', 'cheatWashPairCount'],
    },
  });
  const ctx = eng._buildCheatGateContext('0xtok', { marketCap: 111, buyVolumeBnb: 222, cheatGrade: null });
  check('fire 快照非 cheat 键保留原值 / cheat 键覆盖为投影后新值', ctx,
    { marketCap: 111, buyVolumeBnb: 222, cheatGrade: 1, cheatBlocked: 0, cheatWashPairCount: 7 });
  check('cheat 键集惰性派生（cheat 前缀过滤，题集加键免改引擎）', eng._cheatFactorKeys,
    ['cheatGrade', 'cheatBlocked', 'cheatWashPairCount']);
  const eng2 = makeEngine({ _factorAggregator: { buildFactorMap: () => null, getFactorKeys: () => [] } });
  check('buildFactorMap null → null（调用方 fail-open）', eng2._buildCheatGateContext('0xtok', {}), null);
  const eng3 = makeEngine({
    _factorAggregator: { buildFactorMap: () => ({ x: 1 }), getFactorKeys: () => [] },
  });
  check('fireFactors null 安全（空快照打底）', eng3._buildCheatGateContext('0xtok', null), {});
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

console.log('D. FA 投影 45 键往返（因子化：grade 三键 + 16 题档 + 数值锚二十六键——D3.39 abnormalBehavior（改名前 realParticipation）+协同买入四键+创建者峰值+D3.51 尖刺档一键两锚+D3.52 强庄档一键买卖比一锚扩（观察期零门侧消费））');
{
  const FAmod = require('../src/services/FourMemeFactorAggregator');
  check('初始 null', FAmod.getCheatFactors('0xround'), null);
  const LV = { equalAmountSplit: 2, coordinatedSellBack: null, creatorFrontRun: 1,
    sellDispersion: 0, stallBurstWave: 1, amountTiering: null, sameBlockBuyWave: 3,
    insiderSupplySell: null, slowGrindPump: 2, washPair: 3, activityLevel: 0, bundledDominance: 2,
    holdingsBalance: 3, abnormalBehavior: 2, burstSpikeConcentration: 3, strongBackerPressure: 3 };
  const AN = { sameBlockHoldPct: 66.1, equalBandHoldPct: 57.2, washPairCount: 10,
    washPairSellPct: 95.1, washPairBuyPct: 27.3, top1HoldSupplyPct: 25.6,
    top1HoldCircPct: 53.4, famousDominancePct: 87.5, famousDominanceLevel: 'high', famousDominance: 2,
    top2HoldSupplyPct: 9.4, top1Top2HoldSupplyPct: 35.0, top1Top2FirstBuyGapSec: 1,
    clusterHoldSupplyPct: 14.5, t1PlusClusterSupplyPct: 40.1,
    burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5, noBuySellPct: 63.3,
    maxBlockBuyCount: 8, maxBlockBuyPct: 58.8, maxBlockPreGapSec: 412,
    sameAmountWalletPct: 66.7, creatorPeakHoldSupplyPct: 35.2,
    spikeBuyPctInBurst: 99.3, spikeHoldPctAll: 96.7, anchorBuySellRatio: 4.74 };
  FAmod.setCheatFactors('0xround', { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: LV, anchors: AN });
  check('set → get unhealthy（levels/anchors 原样往返）', FAmod.getCheatFactors('0xround'),
    { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: LV, anchors: AN });
  FAmod.setCheatFactors('0xround', { grade: 'cheat', unhealthyGrades: 0, blocked: true });
  check('同 token 二次 set 整包替换（无 levels/anchors 键原样存=引擎路径恒显式传）',
    FAmod.getCheatFactors('0xround'), { grade: 'cheat', unhealthyGrades: 0, blocked: true });
  FAmod.clearCheatFactors('0xround');
  check('clear → null', FAmod.getCheatFactors('0xround'), null);
  // _buildFactorMap 发射 45 键：探针（实例化真实 FA）验证键名在因子集内
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
    'cheatBurstMaxGapSec', 'cheatBurstWaveBuyBnb', 'cheatBurstWaveWallets', 'cheatNoBuySellPct',
    'cheatAbnormalBehaviorRatio', 'cheatMaxBlockBuyCount', 'cheatMaxBlockBuyPct',
    'cheatMaxBlockPreGapSec', 'cheatSameAmountWalletPct', 'cheatCreatorPeakHoldSupplyPct',
    'cheatBurstSpikeConcentration', 'cheatSpikeBuyPctInBurst', 'cheatSpikeHoldPctAll',
    'cheatStrongBackerPressure', 'cheatAnchorBuySellRatio'];
  ok('45 键在 FA 因子集（未知因子三防线自动认得，条件串可引用——D3.52 两键纯观察：门侧零消费，条件串/研究侧自由消费）', need.every((k) => keys.includes(k)),
    need.filter((k) => !keys.includes(k)));
  ok('旧 FA 键 cheatRealParticipation 不得残留（D3.39 改名=换键——库/实验 config 已核零引用，改名零爆炸半径防线）',
    !keys.includes('cheatRealParticipation'));
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
    && fm.cheatBurstWaveWallets === 5 && fm.cheatNoBuySellPct === 63.3
    && fm.cheatAbnormalBehaviorRatio === 2 && fm.cheatMaxBlockBuyCount === 8
    && fm.cheatMaxBlockBuyPct === 58.8 && fm.cheatMaxBlockPreGapSec === 412
    && fm.cheatSameAmountWalletPct === 66.7 && fm.cheatCreatorPeakHoldSupplyPct === 35.2
    && fm.cheatBurstSpikeConcentration === 3 && fm.cheatSpikeBuyPctInBurst === 99.3
    && fm.cheatSpikeHoldPctAll === 96.7
    && fm.cheatStrongBackerPressure === 3 && fm.cheatAnchorBuySellRatio === 4.74
    && fm.cheatRealParticipation === undefined,
    fm ? { grade: fm.cheatGrade, bw: fm.cheatSameBlockBuyWave, sb: fm.cheatSameBlockHoldPct,
      dom: fm.cheatFamousDominance, hb: fm.cheatHoldingsBalance, t1pc: fm.cheatT1PlusClusterSupplyPct,
      nbs: fm.cheatNoBuySellPct, abr: fm.cheatAbnormalBehaviorRatio, mbk: fm.cheatMaxBlockBuyCount } : 'build null');
  FAmod.clearCheatFactors('0xround');
  const fm2 = fa.buildFactorMap('0xround', T0 + 3000);
  ok('清投影 → 全 null/0（未判定语义，条件裸比较恒 false fail-closed）',
    fm2 && fm2.cheatGrade === null && fm2.cheatUnhealthyGrades === 0 && fm2.cheatBlocked === 0
    && fm2.cheatSameBlockBuyWave === null && fm2.cheatSameBlockHoldPct === null
    && fm2.cheatFamousDominance === null
    && fm2.cheatHoldingsBalance === null && fm2.cheatT1PlusClusterSupplyPct === null
    && fm2.cheatBurstMaxGapSec === null && fm2.cheatNoBuySellPct === null
    && fm2.cheatAbnormalBehaviorRatio === null && fm2.cheatMaxBlockBuyCount === null
    && fm2.cheatCreatorPeakHoldSupplyPct === null
    && fm2.cheatBurstSpikeConcentration === null && fm2.cheatSpikeBuyPctInBurst === null
    && fm2.cheatSpikeHoldPctAll === null
    && fm2.cheatStrongBackerPressure === null && fm2.cheatAnchorBuySellRatio === null,
    fm2 ? fm2.cheatGrade : 'build null');
}

console.log('E. 引擎侧源码口径锁（CD158 形状）');
{
  const src = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  // E1 拉黑双源短路：service.enabled ∧（引擎 Set ∪ service.isGateBlocked）——重启
  // bootstrap 恢复的拉黑也在信号行之前短路；位置=叙事否决/熔断短路之后 preBuy 前
  const shortIdx = src.indexOf('this._cheatBlockedTokens.has(tokenAddress) || this._cheatCheckService.isGateBlocked(tokenAddress)');
  const breakerIdx = src.indexOf('this._buyBlockedTokens.has(tokenAddress)');
  const narrativeIdx = src.indexOf('this._narrativeBlockedTokens.has(tokenAddress)');
  ok('拉黑双源短路在买评估链（叙事否决/熔断短路之后，preBuy/signal 落库之前）',
    shortIdx > 0 && breakerIdx > 0 && narrativeIdx > 0 && narrativeIdx < breakerIdx && breakerIdx < shortIdx);
  // E2 门挂点=腿携带 cheatCheckCondition 才走（无字段零作弊交互）；GMGN 前
  const condIdx = src.indexOf("const cheatCheckCondition = String(strategy.cheatCheckCondition || '').trim();");
  const gateCallIdx = src.indexOf('const gate = await this._cheatGateEvaluate(');
  const gmgnCondIdx = src.indexOf("const gmgnCheckCondition = String(strategy.gmgnCheckCondition || '').trim();");
  ok('门挂点：腿字段非空才走（观察模式退役=无字段零交互）', condIdx > 0 && gateCallIdx > condIdx);
  ok('门挂点在 GMGN 条件构建之前（CD158 裁定门序：作弊门→GMGN）',
    gateCallIdx > 0 && gmgnCondIdx > 0 && gateCallIdx < gmgnCondIdx);
  // E3 腿配门但 service 未启用 → fail-open skipped（唯一暴露点，warn 留痕）
  ok('service disabled → fail-open skipped（warn 留痕）',
    src.includes("cheatCheckInfo = { status: 'skipped', reason: 'service_disabled' }"));
  // E4 stop 清理：FA 投影逐 token 清 + 两 Set clear + throttle clear
  const cleanCount = (src.match(/clearCheatFactors/g) || []).length;
  ok('stop 清理在场（clearCheatFactors 引擎恰一处=stop 段逐 token 清）', cleanCount === 1);
  ok('拉黑/投影两 Set stop 清理', src.includes('_cheatProjectedTokens.clear()')
    && src.includes('this._cheatBlockedTokens.clear()'));
  ok('买信号节流 stop 清理', /if \(this\._buySignalThrottle\) this\._buySignalThrottle\.clear\(\);/.test(src));
  // E5 faState 作用域事故现场反证（v67 首日 2026-11-02：`faState is not defined` 炸断
  // 买路径）：声明必须提升到 _evaluateBuyPath 函数域且先于 preBuy 块，函数体内
  // 不得再有块级重复声明
  const buyPathStart = src.indexOf('async _evaluateBuyPath(token, factorResults, tick) {');
  const gateCallIdx2 = src.indexOf('tokenAddress, token, faState, signalId, cheatCheckCondition, factorResults);', buyPathStart);
  const buyPathSlice = src.slice(buyPathStart, gateCallIdx2);
  const declIdx = buyPathSlice.indexOf('const faState = this._factorAggregator.getTokenState(tokenAddress);');
  const preBuyIdx = buyPathSlice.indexOf('shouldPerformPreCheck && this._preBuyCheckService');
  ok('faState 声明提升到 _evaluateBuyPath 函数域且先于 preBuy 块（事故现场反证）',
    buyPathStart > 0 && gateCallIdx2 > buyPathStart && declIdx > 0 && preBuyIdx > 0 && declIdx < preBuyIdx);
  ok('faState 函数体内无块级重复声明（唯一声明=提升点）',
    (buyPathSlice.match(/const faState/g) || []).length === 1);
  // E6 预触发/观察模式/增量门/顶帽全链退役反证（CD158 删除后不得回流）
  ok('预触发整链退役反证（_cheatPrefetchCheck/_scanCheatFactorConsumers 零出现）',
    !src.includes('_cheatPrefetchCheck') && !src.includes('_scanCheatFactorConsumers'));
  ok('观察模式退役反证（noteBuyPoint 零出现——service API 已删）', !src.includes('noteBuyPoint'));
  ok('gate.enabled 双开关退役反证（_cheatGateEnabled 零出现——腿字段即门）', !src.includes('_cheatGateEnabled'));
  ok('unhealthyReanalyses 升级臂退役反证（引擎侧零出现）', !src.includes('unhealthyReanalyses'));
  // E7 unhealthy 不拉黑：_cheatExitPosition 只由 cheat 路径调用（两处=硬拒+迟到）
  const exitCalls = (src.match(/this\._cheatExitPosition\(tokenAddress, 'cheat [^']*'\)/g) || []).length;
  ok('_cheatExitPosition 调用恰两处且 why 恒 cheat 域（硬拒+迟到——unhealthy 永不触发清仓）',
    exitCalls === 2, exitCalls);
}

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

})().catch((e) => { console.error(e); process.exit(1); });
