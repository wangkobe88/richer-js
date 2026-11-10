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
    // 1bcd0222 拒前 metadata.cheatCheck 落段依赖 _updateSignalMetadata（真实实现
    // 走 DB）；基底 no-op 桩，需要断言的用例（A1）自带收集桩覆盖
    _updateSignalMetadata: async () => {},
    ...fields,
  });
}
const TOKEN = { token: '0xtok', symbol: 'TST', name: 'Test', platform: 'flap', createdAt: 1700000000, creatorAddress: null };
function svcStub(impl) {
  return { gateBuyPoint: async (addr, meta, ctx, opts) => impl(addr, meta, ctx, opts) };
}
// FA 桩：buildFactorMap 出投影后 cheat 数值（grade healthy=0/unhealthy=1），
// getFactorKeys 探针域=常规两键+cheat 三键（_buildCheatGateContext 派生用）。
// ★必须返回 Set 对齐真实 FA（2026-11-04 太空制药门旁路事故：桩曾返回 Array，
// 掩盖引擎 Array.isArray(keys) 对 Set 恒 false → _cheatFactorKeys 恒空 →
// cheatGrade 恒 IS NULL 放行=门 grade→条件拒路径整体失效）
function faStub(cheatGrade) {
  return {
    buildFactorMap: () => ({ marketCap: 50, tradeCount: 99, cheatGrade, cheatBlocked: 0, cheatWashPairCount: 3 }),
    getFactorKeys: () => new Set(['marketCap', 'tradeCount', 'cheatGrade', 'cheatBlocked', 'cheatWashPairCount']),
  };
}

(async () => {

console.log('A. _cheatGateEvaluate 新路径（grade 只投影不决策，拒/放=腿表达式）');
{
  // A1 cheat：拉黑 + 清仓联动 + signal failed + 拒买（不评表达式——buildFactorMap 桩抛错反证）
  const exits = [], signals = [], metas = [];
  const eng = makeEngine({
    _cheatCheckService: svcStub(async () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0 })),
    _cheatExitPosition: async (addr, why) => { exits.push({ addr, why }); },
    _updateSignalStatus: async (id, status, meta) => { signals.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas.push({ id, data }); },
    _factorAggregator: { buildFactorMap: () => { throw new Error('cheat 路径不评表达式不应重建上下文'); } },
  });
  const r = await eng._cheatGateEvaluate('0xtok', TOKEN, null, 'sig-1', 'cheatGrade == 0', {});
  check('cheat → 拒买', r, { pass: false, reason: '作弊盘门拒买（cheat 拉黑+持仓清仓联动 [A_strong:same_block_buy_wave]）' });
  ok('cheat → 引擎侧拉黑（_cheatBlockedTokens）', eng._cheatBlockedTokens.has('0xtok'));
  // 1bcd0222 拒前 metadata.cheatCheck 落段（拒行可观测性：拒因带通道/档位+CD379 exempt 位）
  check('cheat → 拒前 metadata.cheatCheck 段（grade/reasons+exempt:null+unblocked:false 形状）', metas,
    [{ id: 'sig-1', data: { cheatCheck: { status: 'analyzed', grade: 'cheat', cached: false, reasons: [{ level: 'cheat', code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0, levels: null, buckets: null, anchors: null, strongbackerLike: 0, exempt: null, unblocked: false } } }]);
  check('cheat → 清仓联动（why=cheat 判定）', exits, [{ addr: '0xtok', why: 'cheat 判定' }]);
  check('cheat → signal failed reason=cheat_gate_cheat', signals.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_cheat']]);
  check('cheat → FA 投影（grade/blocked/levels/anchors 透传+SB1 观察键）', FA.getCheatFactors('0xtok'),
    { grade: 'cheat', unhealthyGrades: 0, blocked: true, levels: null, anchors: null, strongbackerLike: 0 });
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
  check('unhealthy → FA 投影 blocked=false（strongbackerLike 缺席=0 不冒充）', FA.getCheatFactors('0xtok'),
    { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: null, anchors: null, strongbackerLike: 0 });
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
  check('healthy → FA 投影', FA.getCheatFactors('0xtok'), { grade: 'healthy', unhealthyGrades: 0, blocked: false, levels: null, anchors: null, strongbackerLike: 0 });
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
      getFactorKeys: () => new Set(['marketCap', 'buyVolumeBnb', 'tradeCount', 'cheatGrade', 'cheatBlocked', 'cheatWashPairCount']),
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

console.log('D. FA 投影 45 键往返（因子化：grade 三键 + 16 题档 + 数值锚二十六键——D3.39 abnormalBehavior（改名前 realParticipation）+协同买入四键+创建者峰值+D3.51 尖刺档一键两锚+D3.52 强庄档一键买卖比一锚扩（观察期零门侧消费）；CD381 重检双键 preCheatResult/priceBackToAlmostLaunch）');
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
    posHolderCount: 23, top1Top2HoldCircPct: 76.1, top3HoldCircPct: 78.5,
    clusterHoldSupplyPct: 14.5, t1PlusClusterSupplyPct: 40.1,
    burstMaxGapSec: 65, burstWaveBuyBnb: 1.02, burstWaveWallets: 5, noBuySellPct: 63.3,
    maxBlockBuyCount: 8, maxBlockBuyPct: 58.8, maxBlockPreGapSec: 412,
    sameAmountWalletPct: 66.7, creatorPeakHoldSupplyPct: 35.2,
    spikeBuyPctInBurst: 99.3, spikeHoldPctAll: 96.7, anchorBuySellRatio: 4.74,
    routerEntryBuyPct: 42.9 };
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
    'cheatPosHolderCount', 'cheatTop1Top2HoldCircPct', 'cheatTop3HoldCircPct',
    'cheatBurstMaxGapSec', 'cheatBurstWaveBuyBnb', 'cheatBurstWaveWallets', 'cheatNoBuySellPct',
    'cheatAbnormalBehaviorRatio', 'cheatMaxBlockBuyCount', 'cheatMaxBlockBuyPct',
    'cheatMaxBlockPreGapSec', 'cheatSameAmountWalletPct', 'cheatCreatorPeakHoldSupplyPct',
    'cheatBurstSpikeConcentration', 'cheatSpikeBuyPctInBurst', 'cheatSpikeHoldPctAll',
    'cheatStrongBackerPressure', 'cheatAnchorBuySellRatio', 'cheatStrongbackerLike',
    'cheatRouterEntryBuyPct', 'preCheatResult', 'priceBackToAlmostLaunch'];
  ok('52 键在 FA 因子集（未知因子三防线自动认得，条件串可引用——D3.52 两键+CD159 SB1 观察键+D3.60 持有者基数三锚+D3.62 聚合路由入口锚（G17 N 通道源）纯观察：门侧零消费，条件串/研究侧自由消费；CD381 重检双键）', need.every((k) => keys.includes(k)),
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
  FAmod.setCheatFactors('0xround', { grade: 'unhealthy', unhealthyGrades: 2, blocked: false, levels: LV, anchors: AN, strongbackerLike: 1 });
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
    && fm.cheatPosHolderCount === 23 && fm.cheatTop1Top2HoldCircPct === 76.1
    && fm.cheatTop3HoldCircPct === 78.5
    && fm.cheatBurstMaxGapSec === 65 && fm.cheatBurstWaveBuyBnb === 1.02
    && fm.cheatBurstWaveWallets === 5 && fm.cheatNoBuySellPct === 63.3
    && fm.cheatAbnormalBehaviorRatio === 2 && fm.cheatMaxBlockBuyCount === 8
    && fm.cheatMaxBlockBuyPct === 58.8 && fm.cheatMaxBlockPreGapSec === 412
    && fm.cheatSameAmountWalletPct === 66.7 && fm.cheatCreatorPeakHoldSupplyPct === 35.2
    && fm.cheatBurstSpikeConcentration === 3 && fm.cheatSpikeBuyPctInBurst === 99.3
    && fm.cheatSpikeHoldPctAll === 96.7
    && fm.cheatStrongBackerPressure === 3 && fm.cheatAnchorBuySellRatio === 4.74
    && fm.cheatStrongbackerLike === 1
    && fm.cheatRouterEntryBuyPct === 42.9
    && fm.cheatRealParticipation === undefined,
    fm ? { grade: fm.cheatGrade, bw: fm.cheatSameBlockBuyWave, sb: fm.cheatSameBlockHoldPct,
      dom: fm.cheatFamousDominance, hb: fm.cheatHoldingsBalance, t1pc: fm.cheatT1PlusClusterSupplyPct,
      nbs: fm.cheatNoBuySellPct, abr: fm.cheatAbnormalBehaviorRatio, mbk: fm.cheatMaxBlockBuyCount } : 'build null');
  // CD381 双键发射：preCheatResult 投影上次 grade 字符串；无锚 →
  // priceBackToAlmostLaunch null fail-closed（裸比较恒 false 不触发重检）
  ok('CD381 双键发射：preCheatResult=unhealthy 投影 / 无锚 priceBackToAlmostLaunch=null',
    fm && fm.preCheatResult === 'unhealthy' && fm.priceBackToAlmostLaunch === null,
    fm ? { pc: fm.preCheatResult, pb: fm.priceBackToAlmostLaunch } : 'fm null');
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
    && fm2.cheatStrongBackerPressure === null && fm2.cheatAnchorBuySellRatio === null
    && fm2.cheatStrongbackerLike === 0,
    fm2 ? fm2.cheatGrade : 'build null');
  ok('CD381 清投影后 preCheatResult=null / 仍无锚 priceBackToAlmostLaunch=null',
    fm2 && fm2.preCheatResult === null && fm2.priceBackToAlmostLaunch === null,
    fm2 ? { pc: fm2.preCheatResult, pb: fm2.priceBackToAlmostLaunch } : 'fm2 null');

  // ── CD381 almost_launch 锚语义（第二 token 独立价格轨迹）──
  // 轨迹（2026-11-08 发行价口径修正：platform='fourmeme' → currentVsLaunchPct 分母
  // =主流档常量 FM——价格域乘 FM 使常量口径下百分比仍为 +60/+18，断言数值 bit 不变）：
  // FM（发行 0%）→ 1.6×FM（+60%）→ mark(60) 窗口起算 → 回落 1.08×FM（+8%）
  //   → 1 → 拉回 1.6×FM → 重锚 mark(60) 复位（回落史不延续）→ 0
  const FM = require('../src/market-analysis/launch-price').FOURMEME_LAUNCH_PRICE_BNB;
  fa.registerToken('0xrl2', { createdAtMs: T0, totalSupply: 1e9, symbol: 'RL2' });
  const rlTick = (price, txh, ts, logIdx) => fa.processTick({
    token_address: '0xrl2', trade_type: 'buy', trader_address: '0xt1',
    price_bnb: price, price_usd: price * 600, bnb_amount: 0.01,
    token_amount: 2e6, block_number: 40000002, timestamp: ts, tx_hash: txh,
    log_index: logIdx, price_outlier: false, platform: 'fourmeme' }, { emitFactors: false });
  rlTick(FM, '0xrl-t1', T0 + 1000, 0);
  rlTick(FM * 1.6, '0xrl-t2', T0 + 2000, 1); // +60%
  const fmRa = fa.buildFactorMap('0xrl2', T0 + 2100);
  ok('CD381 无锚（从未过门链）→ priceBackToAlmostLaunch=null（fail-closed 不触发重检）',
    fmRa && fmRa.currentVsLaunchPct === 60 && fmRa.priceBackToAlmostLaunch === null,
    fmRa ? { vs: fmRa.currentVsLaunchPct, pb: fmRa.priceBackToAlmostLaunch } : 'build null');
  FAmod.markCheatGateEvaluated('0xrl2', 60);
  const fmRb = fa.buildFactorMap('0xrl2', T0 + 2200);
  ok('CD381 mark(60) 窗口起算：现价仍 +60% 未回 almost_launch → 0',
    fmRb && fmRb.priceBackToAlmostLaunch === 0 && fmRb.preCheatResult === null,
    fmRb ? { pb: fmRb.priceBackToAlmostLaunch } : 'build null');
  rlTick(FM * 1.08, '0xrl-t3', T0 + 3000, 2); // +8% 回到 almost_launch（2026-11-09 上界 20→10）
  const fmRc = fa.buildFactorMap('0xrl2', T0 + 3100);
  ok('CD381 回落到 +8% → min=8 ≤ 10 → priceBackToAlmostLaunch=1（触发重检）',
    fmRc && fmRc.currentVsLaunchPct === 8 && fmRc.priceBackToAlmostLaunch === 1,
    fmRc ? { vs: fmRc.currentVsLaunchPct, pb: fmRc.priceBackToAlmostLaunch } : 'build null');
  rlTick(FM * 1.6, '0xrl-t4', T0 + 4000, 3); // 拉回 +60%
  FAmod.markCheatGateEvaluated('0xrl2', 60); // 门链再评估 → 锚复位
  const fmRd = fa.buildFactorMap('0xrl2', T0 + 4100);
  ok('CD381 重锚复位：mark(60) 后 min 从 60 重新起算（此前回落史不延续）→ 0',
    fmRd && fmRd.currentVsLaunchPct === 60 && fmRd.priceBackToAlmostLaunch === 0,
    fmRd ? { vs: fmRd.currentVsLaunchPct, pb: fmRd.priceBackToAlmostLaunch } : 'build null');
  check('CD381 锚 API 往返（getCheatGatePriceAnchor 读 min）', FAmod.getCheatGatePriceAnchor('0xrl2'),
    { minVsLaunch: 60 });
  ok('CD381 mark(null/非有限值) → 锚 min=null（未见可靠价，之后首个可靠价开始追踪）',
    FAmod.markCheatGateEvaluated('0xrl2', null) === true
      && FAmod.getCheatGatePriceAnchor('0xrl2').minVsLaunch === null);
  const fmRe = fa.buildFactorMap('0xrl2', T0 + 4200);
  ok('CD381 锚 min=null + 现价可靠 → 首个可靠价接管 min → 60 > 20 → 0（有证据零值非 null）',
    fmRe && fmRe.priceBackToAlmostLaunch === 0,
    fmRe ? { pb: fmRe.priceBackToAlmostLaunch } : 'build null');
  ok('CD381 清锚 API（stop 清单例语义）',
    FAmod.clearCheatGatePriceAnchor('0xrl2') === true
      && FAmod.getCheatGatePriceAnchor('0xrl2') === null);
  const fmRf = fa.buildFactorMap('0xrl2', T0 + 4300);
  ok('CD381 清锚后 → null（回到无锚 fail-closed）', fmRf && fmRf.priceBackToAlmostLaunch === null,
    fmRf ? { pb: fmRf.priceBackToAlmostLaunch } : 'build null');

  // 事故现场反证（2026-11-04 太空制药 0x6a4f…7777 门旁路）：真 FA（非桩）探针
  // 返回 **Set**——旧引擎代码 Array.isArray(keys) 对 Set 恒 false → _cheatFactorKeys
  // 恒空数组 → 门上下文零合并 → cheatGrade 恒缺席（undefined）→ 库 v56 串
  // `cheatGrade IS NULL OR cheatGrade == 0` 走 IS NULL 臂恒放行——unhealthy
  // J+L+R 三通道判定照买（healthy 票 0==0 与 IS NULL 同向放行，无法暴露）
  FAmod.setCheatFactors('0xround', { grade: 'unhealthy', unhealthyGrades: 1, blocked: false, levels: null, anchors: null });
  const engR = makeEngine({ _factorAggregator: fa });
  const ctxR = engR._buildCheatGateContext('0xround', { marketCap: 111 });
  ok('事故反证：真 FA（Set 探针）门上下文合并出投影 cheatGrade=1、非 cheat 键保 fire 值',
    ctxR && ctxR.cheatGrade === 1 && ctxR.marketCap === 111,
    ctxR ? { cheatGrade: ctxR.cheatGrade, marketCap: ctxR.marketCap } : 'ctx null');
  ok('事故反证：_cheatFactorKeys 派生非空含 cheatGrade（Set 形状兼容）',
    Array.isArray(engR._cheatFactorKeys) && engR._cheatFactorKeys.includes('cheatGrade'),
    engR._cheatFactorKeys && engR._cheatFactorKeys.length);
  const { ConditionEvaluator: CEr } = require('../src/strategies/ConditionEvaluator');
  const evR = new CEr();
  ok('事故反证：库 v56 串对 unhealthy 上下文评估 false=拒买（拒路径复活）',
    evR.evaluate(evR.parseCondition('cheatGrade IS NULL OR cheatGrade == 0'), ctxR) === false);
  FAmod.clearCheatFactors('0xround');
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
  // 不得再有块级重复声明（签名锚用前缀匹配——T132 起第 4 参 opts evalExcludeIds）
  const buyPathStart = src.indexOf('async _evaluateBuyPath(token, factorResults, tick');
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
  // E7 unhealthy 不拉黑：_cheatExitPosition 只由 cheat 路径调用（三处=硬拒 helper
  // +迟到 late 链+买路径收口补丁 T117——均 cheat 域；unhealthy 永不触发清仓）。
  // 2026-11-07 门链上移 core/AbstractTradingEngine：定义+硬拒/迟到两调用在基类
  // （ABS 计 3 处），FourMeme 仅买路径收口 1 处——跨文件同口径锁
  const absSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
  const exitCalls = (src.match(/this\._cheatExitPosition\(tokenAddress, 'cheat [^']*'\)/g) || []).length;
  const exitCallsBase = (absSrc.match(/this\._cheatExitPosition\(tokenAddress, 'cheat [^']*'/g) || []).length;
  ok('_cheatExitPosition 调用恰三处且 why 恒 cheat 域（基类硬拒 helper+迟到 2 处+FourMeme 买路径收口 1 处——unhealthy 永不触发清仓）',
    exitCalls === 1 && exitCallsBase === 2, { fourmeme: exitCalls, base: exitCallsBase });
}

// ═══ F. CD379 活跃度豁免（2026-11-07 用户裁定「作弊检测豁免所有活跃度在 high 之上的票」）═══
async function testActivityExempt() {
  console.log('\n── F. CD379 活跃度豁免 ──');
  const svcSrc = fs.readFileSync(path.join(__dirname, '../src/market-analysis/CheatCheckService.js'), 'utf8');
  const { CheatCheckService } = require('../src/market-analysis/CheatCheckService');

  // F1 ctor 解析：缺省 ['high','ultra'] 默认生效；显式 []=关；非法值/非数组 throw fail-fast
  const mkSvc = (levels) => new CheatCheckService(
    { enabled: true, ...(levels !== undefined ? { gate: { activityExemptLevels: levels } } : {}) },
    { info: () => {}, warn: () => {}, error: () => {} }, {});
  ok('F1 缺省=high/ultra 豁免（默认生效）', (() => {
    const s = mkSvc(); return s._isActivityExempt('high') && s._isActivityExempt('ultra') && !s._isActivityExempt('mid');
  })());
  ok('F1 显式 []=关（任何桶不豁免）', (() => {
    const s = mkSvc([]); return !s._isActivityExempt('high') && !s._isActivityExempt('ultra');
  })());
  ok('F1 低档可显式配（low 配置生效——豁免域=配置自由度）', (() => {
    const s = mkSvc(['low']); return s._isActivityExempt('low') && !s._isActivityExempt('high');
  })());
  let threw = null; try { mkSvc(['hyper']); } catch (e) { threw = e.message; }
  ok('F1 非法档位 throw fail-fast', /非法档位/.test(threw || ''), threw);
  threw = null; try { mkSvc('high'); } catch (e) { threw = e.message; }
  ok('F1 非数组 throw fail-fast', /须为数组/.test(threw || ''), threw);

  // F2 _applyActivityExempt 出口变换全分支（CD391「交易活跃度热，cheat 继续豁免」——
  // CD390 全档收紧收回 ultra 单档=CD388 形态恢复：cheat+high 恢复豁免）
  const s2 = mkSvc();
  const cheatHi = { status: 'graded', grade: 'cheat', reasons: [{ code: 'A_slow_grind' }], buckets: { activityLevel: 'high' } };
  const r2a = s2._applyActivityExempt(cheatHi);
  check('F2 cheat+high → CD391 恢复豁免 healthy+activity_high（reasons 保留审计；不登记拉黑/不清仓）',
    { grade: r2a.grade, exemptDenied: r2a.exemptDenied, exempt: r2a.exempt, reasons: r2a.reasons },
    { grade: 'healthy', exemptDenied: undefined, exempt: { code: 'activity_high', originalGrade: 'cheat' }, reasons: [{ code: 'A_slow_grind' }] });
  const r2a2 = s2._applyActivityExempt({ status: 'graded', grade: 'cheat', reasons: [{ code: 'A_slow_grind' }], buckets: { activityLevel: 'ultra' } });
  check('F2 cheat+ultra（无 burst）→ CD388 形态维持：原判保持+exemptDenied ultra_cheat（刷量机器不豁免——bt-v90 ultra∧cheat 亏损 Top 实证）',
    { grade: r2a2.grade, exemptDenied: r2a2.exemptDenied, exempt: r2a2.exempt },
    { grade: 'cheat', exemptDenied: 'ultra_cheat', exempt: undefined });
  const r2b = s2._applyActivityExempt({ status: 'graded', grade: 'unhealthy', buckets: { activityLevel: 'ultra' } });
  check('F2 unhealthy+ultra → healthy+exempt（CD379 原语义照旧）', { grade: r2b.grade, exempt: r2b.exempt },
    { grade: 'healthy', exempt: { code: 'activity_ultra', originalGrade: 'unhealthy' } });
  const r2c = s2._applyActivityExempt({ status: 'graded', grade: 'cheat', buckets: { activityLevel: 'mid' } });
  check('F2 cheat+mid → 原样不豁免（桶不在豁免集=资格缺席，无 exemptDenied 留痕）',
    { grade: r2c.grade, exempt: r2c.exempt, exemptDenied: r2c.exemptDenied }, { grade: 'cheat', exempt: undefined, exemptDenied: undefined });
  const r2d = s2._applyActivityExempt({ status: 'graded', grade: 'unhealthy', buckets: null });
  check('F2 buckets null → 原样（题答案缺席不豁免）', { grade: r2d.grade, exempt: r2d.exempt }, { grade: 'unhealthy', exempt: undefined });
  const beforeCnt = s2.stats.activityExemptions;
  s2._applyActivityExempt({ status: 'analyzed', grade: 'healthy', buckets: { activityLevel: 'high' } });
  s2._applyActivityExempt({ status: 'fail', reason: 'cooldown' });
  s2._applyActivityExempt(null);
  ok('F2 healthy/fail/null 不计数（豁免只发生在 cheat/unhealthy 变换；r2a/r2b 各计 1）+ r2a2 计 ultraCheatDenied 1（CD391 恢复计数）',
    beforeCnt === 2 && s2.stats.activityExemptions === 2 && s2.stats.ultraCheatDenied === 1, s2.stats);
  const s2off = mkSvc([]);
  const r2e = s2off._applyActivityExempt({ status: 'graded', grade: 'cheat', buckets: { activityLevel: 'high' } });
  ok('F2 豁免关（[]）原样返回', r2e.grade === 'cheat' && r2e.exempt === undefined);

  // F3 sticky 出口真调（零 DB 零 LLM：unhealthy 粘滞+recheck=false → 豁免变换 healthy 放行）
  const s3 = mkSvc();
  s3._lastGrade.set('0xexempt', {
    grade: 'unhealthy', reasons: [{ code: 'E_low_activity' }], version: 'G17',
    unhealthyGrades: 2, levels: { activityLevel: 1 }, buckets: { activityLevel: 'high' }, anchors: {},
  });
  const r3 = await s3.gateBuyPoint('0xexempt', {}, {}, { recheckUnhealthy: false });
  check('F3 sticky unhealthy+high recheck=false → 秒回也豁免放行', { grade: r3.grade, exempt: r3.exempt, cached: r3.cached },
    { grade: 'healthy', exempt: { code: 'activity_high', originalGrade: 'unhealthy' }, cached: true });

  // F4 源码口径锁：拉黑登记点跳过豁免票（graded 段）+ bootstrap 恢复检查 + late 包
  ok('F4 拉黑登记点豁免跳过（grade===cheat && !activityExempt 恰一处）',
    (svcSrc.match(/graded\.grade === 'cheat' && !activityExempt/g) || []).length === 1);
  ok('F4 bootstrap 恢复拉黑豁免检查（cheatSeen && !_isCheatExemptEligible——与拉黑登记点同构，CD391 起单一子式三点共用）',
    svcSrc.includes('cheatSeen && !this._isCheatExemptEligible('));
  ok('F4 timeout late 包豁免+翻案变换（迟到结果不把豁免票错拉黑；CD381 重检迟到翻正同解除）',
    svcSrc.includes('chain.then((r) => this._maybeUnblock(token, this._applyActivityExempt(r)))'));
  ok('F4 四出口统一变换（this._applyActivityExempt 调用恰 4 处：blocked/sticky/late/chain）',
    (svcSrc.match(/this\._applyActivityExempt\(/g) || []).length === 4,
    (svcSrc.match(/this\._applyActivityExempt\(/g) || []).length);

  // F5 域一致锁：CJS 豁免域 ⊇ 题集 ACTIVITY_LEVELS（ESM dynamic import 防漂移）
  const q = await import(path.join(__dirname, '../src/market-analysis/llm/cheat-questions.mjs'));
  const lvls = q.ACTIVITY_LEVELS;
  ok('F5 题集 ACTIVITY_LEVELS 四桶（low/mid/high/ultra）', JSON.stringify(lvls) === JSON.stringify(['low', 'mid', 'high', 'ultra']), lvls);
  let allLegal = true;
  for (const l of lvls) { try { mkSvc([l]); } catch (e) { allLegal = false; } }
  ok('F5 题集每个桶都是豁免合法域成员（域漂移=ctor throw 拒启）', allLegal);

  // F6 grade 规则域零改动反证：豁免不碰 gradeObservation/规则版本（只改消费侧）
  const gradeSrc = fs.readFileSync(path.join(__dirname, '../src/market-analysis/cheat-grade.js'), 'utf8');
  ok('F6 gradeObservation 规则域零豁免引用（决策域变换只在 service 层）',
    !gradeSrc.includes('activityExempt') && !gradeSrc.includes('_applyActivityExempt'));

  // F7 CD380 不豁免臂（2026-11-07 bt-v79 六案裁定：pump/wash/holdings 三臂在场
  // =活跃度豁免失效原判保持——刷量/锁仓型形状天然高活跃度，豁免恰好专放这类票，
  // 8 个放行信号 originalGrade 全∈{cheat,unhealthy} 全经豁免放走实证）
  const s7 = mkSvc();
  const dn = (levels) => s7._exemptDeniedReason(levels);
  ok('F7 pump=moderate 不拦（2026-11-08 用户裁定三臂统一 strong——moderate 不用于判定 cheat；0x94ea754b pump=2 信号恢复豁免）',
    dn({ slowGrindPump: 2 }) === null);
  ok('F7 pump=strong 不拦（2026-11-08 四修裁定「把活跃度高的命中 pump 的依然豁免掉」——pump 臂整体移除：slow_grind_pump+burst_spike_concentration 是作弊盘/强庄盘共同特性，pump 臂拦豁免=强庄盘也进不来；价格约束移交 BP 门位置门（PUMP_EXEMPT_LAUNCH_PCT=40）；0xcb70708e/d0fbcc7b/4b3f1f7a 判例留档为臂移除前行为）',
    dn({ slowGrindPump: 3 }) === null);
  ok('F7 pump=weak 不拦（臂线=strong）', dn({ slowGrindPump: 1 }) === null);
  check('F7 washPair=strong → wash_pair（0x06810806 同块对敲判例）',
    dn({ washPair: 3 }), 'wash_pair');
  ok('F7 equalAmountSplit=strong 不拦（2026-11-08 用户裁定 wash 臂收窄「只拦截同区块刷量这一种情况」+「其他的我没说的，依然可以走活跃度豁免」——等额分仓退出不豁免臂恢复 CD379 豁免资格）',
    dn({ equalAmountSplit: 3 }) === null);
  ok('F7 coordinatedSellBack=strong 不拦（协同卖回退出不豁免臂——同上裁定）',
    dn({ coordinatedSellBack: 3 }) === null);
  ok('F7 washPair=moderate 不拦（strong 与 A 通道主判线同档）',
    dn({ washPair: 2 }) === null);
  ok('F7 holdingsBalance=moderate 不拦（三臂统一 strong 档位修正）',
    dn({ holdingsBalance: 2 }) === null);
  ok('F7 holdingsBalance=strong 不拦（2026-11-08 三修裁定「cheat 模块高活跃度豁免 J_holdings_strong」——holdings 臂退出不豁免臂：CD382 重置对拍 bt-s01 0x28ad2c7d #5 锚 activityLevel=high 豁免恰被 holdings 臂拦，重置窗内组合垄断=接盘侧新阵列非刷量形状；0xb788e63b 判例留档为臂移除前行为）',
    dn({ holdingsBalance: 3 }) === null);
  ok('F7 holdings=weak 不拦', dn({ holdingsBalance: 1 }) === null);
  ok('F7 levels null/键缺席（旧档断代/题未答）不拦=豁免照常（缺席不扩大收紧面）',
    dn(null) === null && dn({}) === null && dn({ slowGrindPump: null }) === null);
  const beforeDeny = s7.stats.exemptDenied;
  const beforeAC = s7.stats.activityCheatDenied;
  const r7a = s7._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { slowGrindPump: 3 }, buckets: { activityLevel: 'high' } });
  check('F7 出口：cheat+high+pump strong → CD391 恢复豁免 activity_high（11-09 裁定「交易活跃度热，cheat 继续豁免」收回 CD390 全档收紧=pump 臂移除后的豁免面恢复；价格约束归 BP 门盘型桶位置门同线 40）',
    { grade: r7a.grade, exemptDenied: r7a.exemptDenied, exemptCode: r7a.exempt && r7a.exempt.code },
    { grade: 'healthy', exemptDenied: undefined, exemptCode: 'activity_high' });
  const r7b = s7._applyActivityExempt({ status: 'graded', grade: 'unhealthy', levels: { holdingsBalance: 3 }, buckets: { activityLevel: 'ultra' } });
  check('F7 出口：unhealthy+ultra+holdings strong → 豁免照常放行（三修裁定后 holdings 臂不再拦——J 通道判定不受影响、仅豁免路径放开）',
    { grade: r7b.grade, exemptDenied: r7b.exemptDenied, exemptCode: r7b.exempt && r7b.exempt.code },
    { grade: 'healthy', exemptDenied: undefined, exemptCode: 'activity_ultra' });
  const r7b2 = s7._applyActivityExempt({ status: 'graded', grade: 'unhealthy', levels: { holdingsBalance: 2 }, buckets: { activityLevel: 'ultra' } });
  check('F7 出口：holdings moderate（档位修正后）→ 豁免照常恢复放行（0x94ea754b pump=moderate 信号同形状）',
    { grade: r7b2.grade, exemptDenied: r7b2.exemptDenied, exemptCode: r7b2.exempt && r7b2.exempt.code },
    { grade: 'healthy', exemptDenied: undefined, exemptCode: 'activity_ultra' });
  const r7b3 = s7._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { equalAmountSplit: 3, coordinatedSellBack: 3 }, buckets: { activityLevel: 'high' } });
  check('F7 出口：cheat+high+equalAmountSplit/coordinatedSellBack strong（wash 臂收窄后不在 denied 域）→ CD391 豁免照常（「其他的依然可以走活跃度豁免」裁定域恢复全 grade）',
    { grade: r7b3.grade, exemptDenied: r7b3.exemptDenied, exemptCode: r7b3.exempt && r7b3.exempt.code },
    { grade: 'healthy', exemptDenied: undefined, exemptCode: 'activity_high' });
  ok('F7 0xcb70708e 形状（pump+wash 退出键+holdings 全 3，washPair 不在场）→ 四修后全臂退出豁免放行（pump 臂移除+wash 臂仅同块对敲+holdings 臂移除——价格约束归 BP 门位置门）',
    dn({ slowGrindPump: 3, equalAmountSplit: 3, coordinatedSellBack: 3, holdingsBalance: 3 }) === null);
  const r7c = s7._applyActivityExempt({ status: 'graded', grade: 'unhealthy', levels: { activityLevel: 1 }, buckets: { activityLevel: 'high' } });
  check('F7 出口：三臂不在场（F3 形状）→ 豁免照常（CD379 语义维持）',
    { grade: r7c.grade, exempt: r7c.exempt, exemptDenied: r7c.exemptDenied },
    { grade: 'healthy', exempt: { code: 'activity_high', originalGrade: 'unhealthy' }, exemptDenied: undefined });
  ok('F7 exemptDenied 计数 0 次（CD380 wash 臂不在场不计；r7a/r7b3 两笔走 CD391 豁免不再拒——activityCheatDenied 停用恒 0）',
    s7.stats.exemptDenied - beforeDeny === 0 && s7.stats.activityCheatDenied - beforeAC === 0, s7.stats);
  // F7 sticky 出口：holdings 臂移除后 sticky 秒回同样走豁免变换（粘滞态不改、决策域放行）
  const s7s = mkSvc();
  s7s._lastGrade.set('0xdenied', {
    grade: 'unhealthy', reasons: [{ code: 'J_holdings_strong' }], version: 'G17',
    unhealthyGrades: 2, levels: { holdingsBalance: 3 }, buckets: { activityLevel: 'high' }, anchors: {},
  });
  const r7s = await s7s.gateBuyPoint('0xdenied', {}, {}, { recheckUnhealthy: false });
  check('F7 sticky：unhealthy+high+holdings strong recheck=false → 秒回照豁免放行（三修裁定后同形状翻案）',
    { grade: r7s.grade, cached: r7s.cached, exemptCode: r7s.exempt && r7s.exempt.code, exemptDenied: r7s.exemptDenied },
    { grade: 'healthy', cached: true, exemptCode: 'activity_high', exemptDenied: undefined });
  // F7 源码口径锁：拉黑登记点+bootstrap 恢复同款收紧（denied 票照拉黑/照恢复拉黑）
  // CD391 起 cheat 分支资格=_isCheatExemptEligible 单一子式（activity 桶 high 恢复/
  // ultra 单档拒 ∨ burst 臂）、unhealthy 分支照旧双通道 ∧ !denied
  ok('F7 拉黑登记点收紧在场（cheat → _isCheatExemptEligible；unhealthy → (isExempt ∨ stallBurst) && !deniedReason(levels)）',
    svcSrc.includes("graded.grade === 'cheat'\n        ? this._isCheatExemptEligible(_actBucket, levels, anchors) // CD391：cheat 豁免登记拉黑跳过")
      && svcSrc.includes('|| this._isStallBurstExempt(levels, anchors)) // CD383 burst 资格臂\n          && !this._exemptDeniedReason(levels));'));
  ok('F7 bootstrap 恢复拉黑同款收紧（cheatDigest levelsFromObservation 判臂；CD391 起单一子式三点同构）',
    svcSrc.includes('const cheatLv = cheatDigest ? levelsFromObservation(cheatDigest) : null;')
      && svcSrc.includes("if (cheatSeen && !this._isCheatExemptEligible("));
  ok('F7 豁免收紧收在 cheat 模块内部（引擎/BP 层零豁免逻辑——用户裁定）',
    !fs.readFileSync(path.join(__dirname, '../src/market-analysis/buy-point-result-mapper.js'), 'utf8').includes('activityExempt'));

  // F8 CD383 burst 豁免资格臂（2026-11-08 用户裁定「burst 在作弊检测内部豁免
  // activity low 的，所以外部豁免这里也加一下，将 burst 也豁免」+「高大上应该
  // 是 长期沉积一朝开始操盘，这种情况豁免一下」——高大上 0x838657df t0a 触发
  // 被 cheat 门拒复盘：E 通道内部豁免口径（act=low ∧ sbw=burst ∧ 非弱 burst
  // 不落 E）外移到门豁免资格，与 activityExemptLevels 并列第二臂（∨））
  const s8 = mkSvc();
  const sb = (lv, an) => s8._isStallBurstExempt(lv, an); // levels=档位投影 / anchors=波五键数值锚（levelsFromObservation 两段——对拍实证波键在 anchors 段；CD392 起第四键、D3.66 起判据源=burstExitVsLaunchPct）
  ok('F8 sbw=burst+三键强形状（高大上 06:57:07 形状：gap 780s/buy 1.4B/wallets 9/沉积出口 +2.9%——buy≥0.7 波有力非弱）→ 资格成立',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstExitVsLaunchPct: 2.9 }) === true);
  ok('F8 gap<60 无沉积（sbw=burst 但开盘即密集）→ 资格不成立（B 段夹具反例：gap 2s+tier/同块/内幕三 strong cheat 盘被首版误放——停滞深度是必要维度，E 通道内部不限 gap 是因其语境恒 act=low）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 2, burstWaveBuyBnb: 2.0, burstWaveWallets: 15, burstExitVsLaunchPct: 2.9 }) === false);
  ok('F8 波键 null/缺席（旧档断代/dt 缺失/anchors null）→ 不授予（资格授予方向 fail-closed 与 G8 维持豁免刻意不同向——无沉积/波力正证据不冒充）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: null, burstWaveBuyBnb: null, burstWaveWallets: null, burstExitVsLaunchPct: null }) === false
      && sb({ stallBurstWave: 1 }, {}) === false && sb({ stallBurstWave: 1 }) === false
      && sb({ stallBurstWave: 1 }, { burstMaxGapSec: 90, burstWaveBuyBnb: null, burstWaveWallets: null, burstExitVsLaunchPct: 2.9 }) === false);
  ok('F8 弱 burst（gap≥50 ∧ buy<0.7 ∧ wallets<10——长期停滞后只涌入一点小流量）→ 资格不成立（G8 弱波否定侧）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 90, burstWaveBuyBnb: 0.5, burstWaveWallets: 5, burstExitVsLaunchPct: 2.9 }) === false);
  ok('F8 波有力两键独立过线（buy≥0.7 或 wallets≥10 任一）→ 资格成立',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 90, burstWaveBuyBnb: 2.0, burstWaveWallets: 5, burstExitVsLaunchPct: 2.9 }) === true
      && sb({ stallBurstWave: 1 }, { burstMaxGapSec: 90, burstWaveBuyBnb: 0.5, burstWaveWallets: 15, burstExitVsLaunchPct: 2.9 }) === true);
  // F8b CD383 二修放宽（2026-11-08 M4GA 0xba5ed45b 案用户裁定「这个币应该是 burst，
  // 豁免 cheat」：47324b0b 单票回测 07:40:47 首判 sbw=burst 但三键贴线全差一口气
  // gap 58<60/buy 0.7735<1.05/wallets 11<13=weakBurst 全中不授予；t0a 首判窗仅 83s
  // ——burstMaxGapSec 全窗口径被窗长天然压住，线降至 50/0.7/10）
  ok('F8b M4GA 贴线形状（gap 58/buy 0.7735/wallets 11/沉积出口 +2.9——首版三键全差一口气）→ 二修后资格成立',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 58, burstWaveBuyBnb: 0.7735, burstWaveWallets: 11, burstExitVsLaunchPct: 2.9 }) === true);
  ok('F8b 新线负例（gap 49/buy 0.69/wallets 9 全贴下方）→ 资格不成立（贴线不过就是不过）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 49, burstWaveBuyBnb: 0.69, burstWaveWallets: 9, burstExitVsLaunchPct: 2.9 }) === false);
  ok('F8b 开盘密集反例不回归（gap 2s）→ 仍不成立（沉积维度必要不动摇）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 2, burstWaveBuyBnb: 2.0, burstWaveWallets: 15, burstExitVsLaunchPct: 2.9 }) === false);
  ok('F8b 源码锁：二修线 50/0.7/10 在 _isStallBurstExempt（M4GA 案裁定）',
    (() => { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'market-analysis', 'CheatCheckService.js'), 'utf8');
      return src.includes('gap < 50') && src.includes('buy >= 0.7') && src.includes('wallets >= 10'); })());
  // F8c CD392 burst 起来起点价格腿（2026-11-09 ad80fb7a 案用户裁定「burst 是指 价格
  // 跌到很低再起来，不是价格维持高位再一个流量拉升」——豁免资格加第四腿 ≤+40
  // 才授予；刻意不取段内最低——ad80fb7a 高位横盘 280s 末段砸落 17.5% 的形状必须
  // 拒；M4GA +2.9% 贴地板放行。null fail-closed 不授予——起点价是「起来之前的
  // 价格水平」本质维度，缺席=形状不可判宁不授予（与 CD383 gap null 的「不扩大
  // 收紧面」不同向）。
  // **D3.66（2026-11-10 用户裁定）：判据源=burstExitVsLaunchPct（最后一个 ≥50s
  // 静默段的出口首可靠价 vs launch 地板=T130 min(常量,首买价)）**——D3.65 部署前
  // 对拍取证双向否证旧源（全窗首价/波起点价）：①ba5e/M4GA 生产 1000 帽窗窗首
  // +294.9%/全窗最密波=拉峰 frenzy 波起点 +659.7% 仍拒（立法正例修不了——
  // 「涨幅排名前几的顶级好票」裁定未兑现）；②ad80fb7a 高开全窗首价 +29.7%≤40
  // 反例误放（D3.64 旧拒靠临近段首价 +152% 近似，语义随扩窗滑移）；锚时刻现价
  // 同被否（ad80 末段砸落 +17.5%——「取最低会放行高位砸落再弹」）。沉积出口价
  // 三案全达成：ba5e 最后静默段 07:50:32→07:51:40 出口 +35.4 放（不受 PostgREST
  // 1000 行帽影响）、ad80 高位横盘间歇静默出口 +161.3 拒、M4GA/CD383 原案 +2.9
  // 放。旧键 burstWaveStartVsLaunchPct 保留纯观察（历史档重放兼容，不再进本腿）。
  ok('F8c CD392 正例（D3.66 判据源）：沉积出口 +2.9%（M4GA 贴地板沉积后拉起）→ 资格成立',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstExitVsLaunchPct: 2.9 }) === true);
  ok('F8c D3.66 立法正例：ba5e/M4GA 形状（崩回沉积后再起来，最后静默段出口 +35.4≤40）→ 资格成立（用户「涨幅排名前几的顶级好票」裁定兑现；拉峰 frenzy 波起点 +659.7 旧源拒不了=出口价不受波位置影响）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 68, burstWaveBuyBnb: 2.04, burstWaveWallets: 59, burstExitVsLaunchPct: 35.4 }) === true);
  ok('F8c CD392 反例（D3.66 判据源）：ad80fb7a 高位横盘的流量波（间歇静默出口 +161.3——「价格维持高位再一个流量拉升」非 burst）→ 资格不成立（D3.65 部署形状全窗首价 +29.7≤40 曾误放）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 69, burstWaveBuyBnb: 0.0097, burstWaveWallets: 21, burstExitVsLaunchPct: 161.3 }) === false);
  ok('F8c 贴线：沉积出口恰 +40（near_launch 上界同线）→ 资格成立（≤ 含恰等）；+40.1 → 不成立',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstExitVsLaunchPct: 40 }) === true
      && sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstExitVsLaunchPct: 40.1 }) === false);
  ok('F8c null/缺席（无 ≥50s 段=gap 腿本就不过/段后无可靠价/gang 无常量）→ fail-closed 不授予（三键全过也不放——形状维度缺席宁不授予）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstExitVsLaunchPct: null }) === false
      && sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9 }) === false);
  ok('F8c D3.66 断代反证：旧档形状只带 burstWaveStartVsLaunchPct（<D3.66 存档 anchors 无出口价键）→ 不授予（历史档 burst 豁免失效=fail-closed 设计内；bootstrap 恢复拉黑票的 ultra∧burst 资格臂同失效，多拦不错放方向安全）',
    sb({ stallBurstWave: 1 }, { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstWaveStartVsLaunchPct: 2.9 }) === false);
  ok('F8c 源码锁：D3.66 第四腿 exitVs ≤40 在 _isStallBurstExempt（早退在波有力之后——分层判序；函数体内旧键零代码引用=纯观察——注释留档不算，锁 an./anchors. 属性访问形状防跨函数体误报）',
    (() => { const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'market-analysis', 'CheatCheckService.js'), 'utf8');
      const fnStart = src.indexOf('_isStallBurstExempt(levels, anchors)');
      const fnEnd = src.indexOf('\n  }', fnStart); // 类方法体收口=两空格缩进 }（首次出现即本函数尾——防 [\s\S]*? 跨出函数体）
      const fnBody = src.slice(fnStart, fnEnd);
      return /const exitVs = an\.burstExitVsLaunchPct;[\s\S]*?if \(exitVs == null \|\| exitVs > 40\) return false;[\s\S]*?return true;/.test(fnBody)
        && !/an\.burstWaveStartVsLaunchPct|anchors\.burstWaveStartVsLaunchPct/.test(fnBody); })());
  ok('F8 sbw=none/缺席/null/levels null → 不豁免 fail-closed（无 burst 证据不冒充）',
    sb({ stallBurstWave: 0 }, {}) === false && sb({ stallBurstWave: null }, {}) === false
      && sb({}, {}) === false && sb(null, null) === false);
  // F8 出口变换（主案=高大上：cheat+act=low+burst 强 → 豁免放行）
  const beforeSB = s8.stats.stallBurstExemptions;
  const GDS_AN = { burstMaxGapSec: 780, burstWaveBuyBnb: 1.4, burstWaveWallets: 9, burstExitVsLaunchPct: 2.9, burstWaveStartVsLaunchPct: 2.9 }; // 高大上波五键（anchors 段；exitVs=D3.66 第四腿 M4GA 沉积出口实测贴地板，startVs=纯观察同值）
  const r8a = s8._applyActivityExempt({
    status: 'graded', grade: 'cheat',
    levels: { stallBurstWave: 1, slowGrindPump: 3 },
    anchors: GDS_AN,
    buckets: { activityLevel: 'low' },
    reasons: [{ level: 'cheat', code: 'A_strong:slow_grind_pump+holdings_balance' }],
  });
  check('F8 出口：cheat+low+burst 强（高大上主案，pump strong 同场）→ healthy+exempt stall_burst（pump strong 同场不再有下游专属钳制——BP55 pump 位置门退役，价格约束归盘型桶位置门）',
    { grade: r8a.grade, exempt: r8a.exempt, reasons: r8a.reasons },
    { grade: 'healthy', exempt: { code: 'stall_burst', originalGrade: 'cheat' }, reasons: [{ level: 'cheat', code: 'A_strong:slow_grind_pump+holdings_balance' }] });
  ok('F8 stallBurstExemptions 计数+1（生产对拍观测点）', s8.stats.stallBurstExemptions - beforeSB === 1, s8.stats);
  const r8b = s8._applyActivityExempt({ status: 'graded', grade: 'unhealthy', levels: { stallBurstWave: 1 }, anchors: { burstMaxGapSec: 90, burstWaveBuyBnb: 0.5, burstWaveWallets: 5, burstExitVsLaunchPct: 2.9 }, buckets: { activityLevel: 'low' } });
  check('F8 出口：弱 burst 三键全中 → 资格不成立原判保持（无 exemptDenied=非 CD380 臂，是资格缺席）',
    { grade: r8b.grade, exempt: r8b.exempt, exemptDenied: r8b.exemptDenied },
    { grade: 'unhealthy', exempt: undefined, exemptDenied: undefined });
  const r8c = s8._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { stallBurstWave: 1, washPair: 3 }, anchors: GDS_AN, buckets: { activityLevel: 'low' } });
  check('F8 出口：burst 强+washPair strong（同块对敲）→ CD380 臂优先豁免失效原判保持（资格≠生效）',
    { grade: r8c.grade, exemptDenied: r8c.exemptDenied, exempt: r8c.exempt },
    { grade: 'cheat', exemptDenied: 'wash_pair', exempt: undefined });
  const r8d = s8._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { stallBurstWave: 1 }, anchors: GDS_AN, buckets: { activityLevel: 'high' } });
  check('F8 出口：双臂同中（high+burst）grade=cheat → code 取 activity_high（CD391 恢复 CD379 原形状：双臂同中取 activity 桶为首因——更具体来源；burst 臂独立命中才留 stall_burst 码）',
    { grade: r8d.grade, exempt: r8d.exempt }, { grade: 'healthy', exempt: { code: 'activity_high', originalGrade: 'cheat' } });
  const s8off = mkSvc([]);
  ok('F8 豁免总开关显式 [] 关 → burst 臂同关（豁免机制整体关，原样返回；资格判定本身不读开关但出口不授予）',
    s8off._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { stallBurstWave: 1 }, anchors: GDS_AN, buckets: { activityLevel: 'low' } }).grade === 'cheat');
  // F8 sticky 出口：粘滞 unhealthy 携带 levels/anchors → 秒回同走 burst 豁免
  const s8s = mkSvc();
  s8s._lastGrade.set('0xburst', {
    grade: 'unhealthy', reasons: [{ code: 'E_low_activity' }], version: 'G17',
    unhealthyGrades: 1, levels: { stallBurstWave: 1 }, buckets: { activityLevel: 'low' }, anchors: GDS_AN,
  });
  const r8s = await s8s.gateBuyPoint('0xburst', {}, {}, { recheckUnhealthy: false });
  check('F8 sticky：unhealthy+low+burst 强 recheck=false → 秒回豁免放行 stall_burst（四出口统一）',
    { grade: r8s.grade, cached: r8s.cached, exemptCode: r8s.exempt && r8s.exempt.code },
    { grade: 'healthy', cached: true, exemptCode: 'stall_burst' });
  ok('F8 源码锁：_isStallBurstExempt 四消费点（出口/拉黑登记 unhealthy 分支/_isCheatBurstExempt/_isCheatExemptEligible——bootstrap 经子式间接同构）+ grade 层零豁免逻辑（gradeObservation 不动）',
    (svcSrc.match(/this\._isStallBurstExempt\(/g) || []).length === 4
      && !fs.readFileSync(path.join(__dirname, '../src/market-analysis/cheat-grade.js'), 'utf8').includes('StallBurstExempt'));

  // F9 CD391 cheat 豁免资格（2026-11-09 用户裁定「交易活跃度热，cheat 继续豁免」
  // ——CD390「cheat 只有 burst 豁免」全档收紧收回 ultra 单档=CD388 形态恢复）：
  // cheat ∧ activity=high → 恢复豁免；cheat ∧ ultra ∧ burst 资格不在场 → 原判
  // 保持 exemptDenied='ultra_cheat'（刷量机器不豁免，bt-v90 ultra∧cheat 亏损 Top
  // 实证维持）；cheat ∧ burst 强（任意桶）→ 豁免（M4GA 语义）；unhealthy 两通道
  // 照旧（CD379 原语义）。CD388/CD390 案史留档：bt-v91 全档对照曾显 cheat∧activity
  // 两桶全负，CD390 据此全档关闭后被 CD391 收回——grade 方差（CD319 同族）与单窗
  // 噪声下用户裁定回到 CD388 线。
  const s9 = mkSvc();
  const cbe = (lv, an) => s9._isCheatBurstExempt(lv, an); // cheat∧ultra 桶的 burst 资格子式（出口/单一子式两点共用）
  ok('F9 资格子式：burst 强（CD383 二修线+CD392 四腿）→ true；burst 缺席/弱波/null → false',
    cbe({ stallBurstWave: 1 }, GDS_AN) === true
    && cbe({}, GDS_AN) === false && cbe(null, null) === false
    && cbe({ stallBurstWave: 1 }, { burstMaxGapSec: 90, burstWaveBuyBnb: 0.5, burstWaveWallets: 5, burstExitVsLaunchPct: 2.9 }) === false);
  ok('F9 资格子式：burst 强 ∧ washPair strong（CD380 臂）→ false（wash 臂对 cheat 豁免同样否决）',
    cbe({ stallBurstWave: 1, washPair: 3 }, GDS_AN) === false);
  const beforeUC9 = s9.stats.ultraCheatDenied;
  const r9a = s9._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: {}, buckets: { activityLevel: 'ultra' } });
  check('F9 出口：ultra∧cheat（bt-v90 亏损 Top1/2/4/5 形状：45ec0489/68bb8cd4/04323e04/BEM 全此组合）→ 原判保持+exemptDenied ultra_cheat（CD388 码恢复；拉黑+清仓联动照常）',
    { grade: r9a.grade, exemptDenied: r9a.exemptDenied, exempt: r9a.exempt },
    { grade: 'cheat', exemptDenied: 'ultra_cheat', exempt: undefined });
  const r9c = s9._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: {}, buckets: { activityLevel: 'high' } });
  check('F9 出口：high∧cheat → CD391 恢复豁免 activity_high（CD390 行为被「交易活跃度热，cheat 继续豁免」推翻收回 ultra 单档）',
    { grade: r9c.grade, exemptDenied: r9c.exemptDenied, exempt: r9c.exempt },
    { grade: 'healthy', exemptDenied: undefined, exempt: { code: 'activity_high', originalGrade: 'cheat' } });
  ok('F9 ultraCheatDenied 计数+1（生产对拍观测点；activityCheatDenied 停用恒 0 保留键）',
    s9.stats.ultraCheatDenied - beforeUC9 === 1 && s9.stats.activityCheatDenied === 0, s9.stats);
  const r9b = s9._applyActivityExempt({ status: 'graded', grade: 'unhealthy', levels: {}, buckets: { activityLevel: 'ultra' } });
  check('F9 出口：ultra∧unhealthy（bt-v90 盈利三票形状：c84a0ff2 +0.4023/32f18a98 +0.1592/f485ec1d 全此组合——纯 M 通道密度超标）→ 照旧豁免 activity_ultra（CD379 原语义）',
    { grade: r9b.grade, exempt: r9b.exempt },
    { grade: 'healthy', exempt: { code: 'activity_ultra', originalGrade: 'unhealthy' } });
  const r9b2 = s9._applyActivityExempt({ status: 'graded', grade: 'unhealthy', levels: { stallBurstWave: 1 }, anchors: GDS_AN, buckets: { activityLevel: 'high' } });
  check('F9 出口：unhealthy 双臂同中（high+burst）→ code 取 activity_high（unhealthy 侧双通道照旧、activity 桶为首因原语义）',
    { grade: r9b2.grade, exempt: r9b2.exempt },
    { grade: 'healthy', exempt: { code: 'activity_high', originalGrade: 'unhealthy' } });
  const r9d = s9._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { washPair: 3 }, buckets: { activityLevel: 'ultra' } });
  check('F9 出口：ultra∧cheat∧washPair strong → CD380 特定形状臂优先报码 wash_pair（两臂同向原判保持，denied 检查在 ultra 分支前）',
    { grade: r9d.grade, exemptDenied: r9d.exemptDenied },
    { grade: 'cheat', exemptDenied: 'wash_pair' });
  const r9e = s9._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { stallBurstWave: 1 }, anchors: GDS_AN, buckets: { activityLevel: 'low' } });
  check('F9 出口：low∧cheat∧burst 强（CD383 高大上主案形状）→ stall_burst 豁免（桶不在豁免集=burst 臂独立命中）',
    { grade: r9e.grade, exempt: r9e.exempt },
    { grade: 'healthy', exempt: { code: 'stall_burst', originalGrade: 'cheat' } });
  const r9f = s9._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: { stallBurstWave: 1 }, anchors: GDS_AN, buckets: { activityLevel: 'ultra' } });
  check('F9 出口：ultra∧cheat∧burst 强（双臂同中 grade=cheat）→ 豁免 code=activity_ultra（burst 资格在场解除 ultra 拒绝臂；code 取 activity 桶首因=CD379 原形状，与 r9b2 同构）',
    { grade: r9f.grade, exempt: r9f.exempt, exemptDenied: r9f.exemptDenied },
    { grade: 'healthy', exempt: { code: 'activity_ultra', originalGrade: 'cheat' }, exemptDenied: undefined });
  const r9g = s9._applyActivityExempt({ status: 'graded', grade: 'cheat', levels: {}, buckets: { activityLevel: 'mid' } });
  check('F9 出口：mid∧cheat（桶不在豁免集 ∧ 无 burst）→ 原样返回无 exemptDenied（资格缺席非 denied，早退在桶判定前）',
    { grade: r9g.grade, exempt: r9g.exempt, exemptDenied: r9g.exemptDenied },
    { grade: 'cheat', exempt: undefined, exemptDenied: undefined });
  ok('F9 源码锁：_isCheatExemptEligible 单一子式两消费点（拉黑登记/bootstrap——与出口逐案等价三点同构）+ _isCheatBurstExempt 两消费点（出口 ultra 分支/子式 ultra 分支）+ ultraCheatDenied 计数器恢复 + _isUltraCheatDenied 全删',
    (svcSrc.match(/this\._isCheatExemptEligible\(/g) || []).length === 2
    && (svcSrc.match(/this\._isCheatBurstExempt\(/g) || []).length === 2
    && svcSrc.includes('ultraCheatDenied: 0')
    && (svcSrc.match(/this\._isUltraCheatDenied\(/g) || []).length === 0);
}

// ═══ G. CD389 alwaysRecheck 每信号重判（2026-11-09 用户裁定「cheat 检测每一次
// 都重新做，不缓存 cheat 的结果，每一次都重新算」——bt-v91 回测引出）═══
async function testAlwaysRecheck() {
  console.log('\n── G. CD389 alwaysRecheck 每信号重判 ──');
  const { CheatCheckService } = require('../src/market-analysis/CheatCheckService');
  const mkSvcG = (gate) => new CheatCheckService(
    { enabled: true, ...(gate !== undefined ? { gate } : {}) },
    { info: () => {}, warn: () => {}, error: () => {} }, {});
  // _chain 拦截桩：零 DB 零 LLM，捕获 opts 断言归一化透传
  const chainStub = (log) => async (tok, meta, ctx, o) => {
    log.push({ token: tok, forceRecheck: o.forceRecheck === true });
    return { status: 'graded', grade: 'healthy', reasons: [], buckets: { activityLevel: 'mid' }, levels: {}, anchors: {} };
  };

  // G1 ctor/getter：缺省 false 生产零变化；gate.alwaysRecheck=true 生效
  ok('G1 缺省 alwaysRecheck=false（CD158 粘滞语义 bit 不变）', mkSvcG().alwaysRecheck === false);
  ok('G1 gate.alwaysRecheck=true → getter true', mkSvcG({ alwaysRecheck: true }).alwaysRecheck === true);
  ok('G1 gate 其它键在场不影响开关（awaitMs 同段共存）',
    mkSvcG({ awaitMs: 60000, alwaysRecheck: true }).alwaysRecheck === true);

  // G2 入口拉黑秒回绕过：flag 开 → 不走 _blockedResult、chain 收到 forceRecheck=true
  const s2 = mkSvcG({ alwaysRecheck: true });
  s2._gateBlocked.add('0xblk');
  const c2 = []; s2._chain = chainStub(c2);
  const r2 = await s2.gateBuyPoint('0xblk', {}, {});
  check('G2 拉黑票真调重判（chain 1 次、翻案通路 forceRecheck 透传）',
    { grade: r2.grade, chainCalls: c2.length, chainForce: c2[0] && c2[0].forceRecheck },
    { grade: 'healthy', chainCalls: 1, chainForce: true });
  // 对照：flag 关 → 拉黑秒回零 chain（CD158 原语义）
  const s2b = mkSvcG();
  s2b._gateBlocked.add('0xblk');
  const c2b = []; s2b._chain = chainStub(c2b);
  const r2b = await s2b.gateBuyPoint('0xblk', {}, {});
  check('G2 对照（缺省关）：拉黑秒回 blocked=true、chain 零调用',
    { grade: r2b.grade, blocked: r2b.blocked, chainCalls: c2b.length },
    { grade: 'cheat', blocked: true, chainCalls: 0 });

  // G3 healthy 粘滞绕过：flag 开 → 不秒回；缺省 → 秒回 cached 零 chain
  const s3 = mkSvcG({ alwaysRecheck: true });
  s3._lastGrade.set('0xst', { grade: 'healthy', reasons: [], version: 'G17', unhealthyGrades: 0, levels: {}, buckets: { activityLevel: 'mid' }, anchors: {} });
  const c3 = []; s3._chain = chainStub(c3);
  const r3 = await s3.gateBuyPoint('0xst', {}, {});
  check('G3 healthy 粘滞绕过（chain 真调非 cached 秒回）',
    { grade: r3.grade, cached: r3.cached === true, chainCalls: c3.length },
    { grade: 'healthy', cached: false, chainCalls: 1 });
  const s3b = mkSvcG();
  s3b._lastGrade.set('0xst', { grade: 'healthy', reasons: [], version: 'G17', unhealthyGrades: 0, levels: {}, buckets: { activityLevel: 'mid' }, anchors: {} });
  const c3b = []; s3b._chain = chainStub(c3b);
  const r3b = await s3b.gateBuyPoint('0xst', {}, {});
  check('G3 对照（缺省关）：healthy 秒回 cached 零 chain（CD158 语义维持）',
    { grade: r3b.grade, cached: r3b.cached === true, chainCalls: c3b.length },
    { grade: 'healthy', cached: true, chainCalls: 0 });

  // G4 观测计数分账：flag 计 alwaysRechecks；显式 opts.forceRecheck 优先计 forceRechecks
  const s4 = mkSvcG({ alwaysRecheck: true });
  const c4 = []; s4._chain = chainStub(c4);
  const b4a = { al: s4.stats.alwaysRechecks, fo: s4.stats.forceRechecks };
  await s4.gateBuyPoint('0xcnt1', {}, {});
  await s4.gateBuyPoint('0xcnt2', {}, {}, { forceRecheck: true });
  check('G4 分账（flag 开 2 调：1 计 alwaysRechecks / 显式 forceRecheck 1 计 forceRechecks）',
    { al: s4.stats.alwaysRechecks - b4a.al, fo: s4.stats.forceRechecks - b4a.fo }, { al: 1, fo: 1 });
  const s4b = mkSvcG();
  const c4b = []; s4b._chain = chainStub(c4b);
  const b4b = s4b.stats.alwaysRechecks;
  await s4b.gateBuyPoint('0xcnt3', {}, {});
  ok('G4 对照（缺省关）：alwaysRechecks 零增长（观测域零污染）', s4b.stats.alwaysRechecks - b4b === 0, s4b.stats);

  // G5 inflight join 边缘：同 token 并发第二调用 join 已起链不归一化二次（chain 恰 1 次）
  const s5 = mkSvcG({ alwaysRecheck: true });
  let release; const c5 = [];
  s5._chain = (tok, meta, ctx, o) => { c5.push(o.forceRecheck === true); return new Promise((res) => { release = () => res({ status: 'graded', grade: 'healthy', buckets: { activityLevel: 'mid' } }); }); };
  const p1 = s5.gateBuyPoint('0xinf', {}, {});
  const p2 = s5.gateBuyPoint('0xinf', {}, {});
  release && release();
  await Promise.all([p1, p2]);
  check('G5 inflight join：并发两调 chain 恰 1 次（join 不重复归一化）', { chainCalls: c5.length, force: c5[0] }, { chainCalls: 1, force: true });

  // G6 源码口径锁：_force 归一化 + _chainOpts 透传（4b/4c bootstrap 秒回同绕过）+ stats 键
  const svcSrc = fs.readFileSync(path.join(__dirname, '../src/market-analysis/CheatCheckService.js'), 'utf8');
  ok('G6 入口归一化（_force = opts.forceRecheck ∨ alwaysRecheck——两秒回点同判）',
    svcSrc.includes('const _force = opts.forceRecheck === true || this._alwaysRecheck === true;'));
  ok('G6 链归一化透传（_chainOpts 注入 forceRecheck:true——_chain 4b/4c bootstrap 复检读 opts.forceRecheck 天然绕过）',
    svcSrc.includes('const _chainOpts = this._alwaysRecheck === true && opts.forceRecheck !== true')
    && svcSrc.includes('? { ...opts, forceRecheck: true } : opts;'));
  ok('G6 stats.alwaysRechecks 独立计数器在场（与 forceRechecks 分账）',
    svcSrc.includes('alwaysRechecks: 0'));
  ok('G6 _chain 4b bootstrap 拉黑复检读 opts.forceRecheck（归一化后天然绕过）',
    svcSrc.includes('if (this._gateBlocked.has(token) && opts.forceRecheck !== true) return this._blockedResult(token);'));

  // G7 引擎侧拉黑短路放行臂（虚拟引擎预信号短路——flag 开不做引擎级终态短路）
  const engSrc = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  ok('G7 引擎短路条件含 alwaysRecheck 放行臂（拉黑票送门重判而非引擎级秒拒）',
    engSrc.includes('|| this._cheatCheckService.alwaysRecheck === true'));

  // G8 web-server 配置校验：布尔类型门（非布尔 400）
  ok('G8 web-server alwaysRecheck 布尔校验在场',
    fs.readFileSync(path.join(__dirname, '../src/web-server.js'), 'utf8').includes('alwaysRecheck 须为布尔'));
}

await testActivityExempt();
await testAlwaysRecheck();

console.log(`\n${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);

})().catch((e) => { console.error(e); process.exit(1); });
