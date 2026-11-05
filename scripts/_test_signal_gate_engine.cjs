#!/usr/bin/env node
/**
 * T117 信号源门链引擎接线单测（2026-11-05 买入策略整体调整）——零 DB 零网络
 *
 * 背景：买腿 condition 语义变为「初始买入信号源」（触发策略，per token
 * maxTriggers 默认 1，触发即消耗），fire 且 signal 落库成功后依次走
 * 作弊门（二元版 grade 直接决策）→ 买入点位分析（BP）门，两门都过才买。
 * 双门故障语义刻意不同向：cheat 检测层故障 fail-open 放行进 BP
 * （CD158/GMGN 同向，BP 门兜底）；BP 门 fail-closed（超时/Jev 错/disabled
 * 均拒——BP 是点位判定唯一来源无据不买）——**insufficient_ticks 唯一例外
 * 放行**（BP9 2026-11-05 用户裁定「bp_gate_insufficient_ticks 去掉」：
 * 极早触发 tick<minTicks=early_bird 常态不判不拦，留痕放行）。
 *
 * 覆盖：
 *   A. _cheatGateEvaluateBinary（二元版）：service 缺失·enabled=false 放行
 *      （skipped 留痕）/ cheat 硬拒（拉黑+清仓+signal failed cheat_gate_cheat）/
 *      unhealthy 拒（不拉黑；cached=true 粘滞秒回同拒）/ healthy 放行 info 全
 *      形状 / timeout_fail_open 放行+late 挂钩 _cheatGateLateConsume /
 *      insufficient_ticks·fail 放行 / service 异常放行 / recheckUnhealthy
 *      两态透传（gateBuyPoint 第 4 参 opts）
 *   B. _bpGateEvaluate（fail-closed，insufficient_ticks 例外放行）：good·neutral
 *      过 / poor·bucket=null 拒（bp_gate_assessment）/ insufficient_ticks 放行
 *      不打 failed（BP9）/ timeout·fail·disabled·异常全拒（reason 域
 *      bp_gate_*）/ bpPassLevels 自定义集收紧 / 通过·拒绝均落
 *      signal metadata buyPoint 段（metadata 更新失败吞不外抛）/ ctx 四键透传
 *   C. 触发计数三件套：_sgTriggerCount 无计数 0 / _sgRecordTrigger 只增不返还 /
 *      _signalGateExcludedIds 耗尽收集（非 signalGate 腿恒在集外；无耗尽 null；
 *      per-token 隔离）
 *   D. StrategyEngine：signalGate 归一化默认值+显式值 / 非法形状 fail-fast
 *      throw / 卖腿携带 throw / 七旧门字段互斥 throw / evaluate 第 6 参
 *      excludeStrategyIds（耗尽次腿顶上）/ 导出 normalizeSignalGate·
 *      SIGNAL_GATE_BP_LEVELS
 *   E. 引擎侧源码口径锁：门链块顺序（记账在两门前）/ triggerNo 预读 +1 /
 *      双透传白名单两处（漏透传=门静默失效 v15/v69 事故形状）/ finally 收口
 *      cheat 拉黑复查（超时放行→迟到拉黑 buying 窗缺口）/ BacktestEngine
 *      全量排除集 / 实时 evaluate 传参 / 计数无回滚路径（记账点全源码恰 2 处）
 *
 * 用法：node scripts/_test_signal_gate_engine.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { FourMemeWssTradingEngine } = require('../src/trading-engine/implementations/FourMemeWssTradingEngine');
const { StrategyEngine, normalizeSignalGate, SIGNAL_GATE_BP_LEVELS } = require('../src/strategies/StrategyEngine');

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
async function throwsWith(name, fn, needle) {
  try { await fn(); fail++; console.log(`  ✗ ${name}（未 throw）`); return null; }
  catch (e) {
    if (String(e.message).includes(needle)) { pass++; console.log(`  ✓ ${name}`); return e; }
    fail++; console.log(`  ✗ ${name}\n    期望消息含 "${needle}" 实际 "${e.message}"`); return e;
  }
}
const flush = () => new Promise((r) => setImmediate(r));

// 轻量引擎实例（prototype 直挂+手动注入；对齐 _test_cheat_gate_engine 形状）
function makeEngine(fields = {}) {
  const eng = Object.create(FourMemeWssTradingEngine.prototype);
  return Object.assign(eng, {
    _experimentId: 'test-exp',
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    _cheatGateAwaitMs: 15000,
    _bpGateAwaitMs: 15000,
    _cheatBlockedTokens: new Set(),
    _signalSourceTriggerCounts: new Map(),
    _projectCheatFactors: () => {},
    ...fields,
  });
}
const TOKEN = { token: '0xtok', symbol: 'TST', name: 'Test', platform: 'flap', createdAt: 1700000000, creatorAddress: null };
// 归一化后 signalGate 桩（loadStrategies 产物形状）
const SG = (o = {}) => Object.assign({ maxTriggers: 1, cheatRecheck: false, bpPassLevels: ['good', 'neutral'] }, o);
function cheatSvc(impl) {
  return { enabled: true, gateBuyPoint: async (addr, meta, ctx, opts) => impl(addr, meta, ctx, opts) };
}
function bpSvc(impl) {
  return { enabled: true, gateBuyPoint: async (addr, meta, ctx, opts) => impl(addr, meta, ctx, opts) };
}

(async () => {

console.log('A. _cheatGateEvaluateBinary（二元版——grade 直接决策不走腿表达式）');
{
  // A1 service 缺失 / enabled=false → fail-open 放行进 BP（skipped 留痕，warn 不拦买点）
  const engA = makeEngine({});
  check('service 缺失 → 放行 skipped', await engA._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-1', SG()),
    { pass: true, info: { status: 'skipped', reason: 'service_disabled' } });
  const engA2 = makeEngine({ _cheatCheckService: { enabled: false, gateBuyPoint: async () => { throw new Error('不应调用'); } } });
  check('enabled=false → 放行 skipped（零调用）', await engA2._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-1', SG()),
    { pass: true, info: { status: 'skipped', reason: 'service_disabled' } });

  // A2 cheat → 拉黑 + 清仓联动 + signal failed + 拒（hardReject 共用段）
  const exits = [], signals = [], projections = [];
  const eng = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0 })),
    _cheatExitPosition: async (addr, why) => { exits.push({ addr, why }); },
    _updateSignalStatus: async (id, status, meta) => { signals.push({ id, status, meta }); },
    _projectCheatFactors: (addr, res) => { projections.push(res.grade); },
  });
  const r = await eng._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-1', SG());
  ok('cheat → 拒买', r.pass === false && r.reason.includes('cheat'), r);
  ok('cheat → 引擎侧拉黑', eng._cheatBlockedTokens.has('0xtok'));
  check('cheat → 清仓联动（why=cheat 判定）', exits, [{ addr: '0xtok', why: 'cheat 判定' }]);
  check('cheat → signal failed reason=cheat_gate_cheat', signals.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_cheat']]);
  check('cheat → grade 照投影（cheat 56 键快照/卖腿可消费）', projections, ['cheat']);

  // A3 unhealthy → signal failed 拒（不拉黑不清仓——cheatRecheck 下个买信号重判）
  const signals3 = [];
  const eng3 = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'D_famous_dominance' }], unhealthyGrades: 2 })),
    _cheatExitPosition: async () => { throw new Error('unhealthy 不应清仓'); },
    _updateSignalStatus: async (id, status, meta) => { signals3.push({ id, status, meta }); },
  });
  const r3 = await eng3._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-2', SG());
  ok('unhealthy → 拒买', r3.pass === false && r3.reason.includes('unhealthy'), r3);
  ok('unhealthy → 不拉黑', !eng3._cheatBlockedTokens.has('0xtok'));
  check('unhealthy → signal failed reason=cheat_gate_unhealthy', signals3.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_unhealthy']]);

  // A3b unhealthy + cached=true（cheatRecheck=false 粘滞秒回）→ 同拒
  const signals3b = [];
  const eng3b = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'unhealthy', cached: true, reasons: [{ level: 'unhealthy', code: 'E_low_activity' }], unhealthyGrades: 1 })),
    _updateSignalStatus: async (id, status, meta) => { signals3b.push({ id, status, meta }); },
  });
  const r3b = await eng3b._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-3', SG({ cheatRecheck: false }));
  ok('unhealthy 粘滞秒回（cached）→ 同拒', r3b.pass === false, r3b);
  check('unhealthy 粘滞 → reason 同域', signals3b.map((s) => s.meta.reason), ['cheat_gate_unhealthy']);

  // A4 healthy → 放行 info 全形状（levels/buckets/strongbackerLike 透传）
  const eng4 = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({
      status: 'analyzed', grade: 'healthy', reasons: [], unhealthyGrades: 0,
      levels: { same_block_buy_wave: 'none' }, buckets: { activity: 'mid' }, strongbackerLike: 1,
    })),
  });
  check('healthy → 放行 info 全形状', await eng4._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4', SG()), {
    pass: true,
    info: {
      status: 'analyzed', grade: 'healthy', cached: false, reasons: [], unhealthyGrades: 0,
      levels: { same_block_buy_wave: 'none' }, buckets: { activity: 'mid' }, strongbackerLike: 1,
    },
  });
  // healthy 缺席键 → 缺省形状（不冒充）
  const eng4b = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'healthy' })) });
  check('healthy 缺席键 → 缺省形状', (await eng4b._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4b', SG())).info, {
    status: 'analyzed', grade: 'healthy', cached: false, reasons: [], unhealthyGrades: 0,
    levels: null, buckets: null, strongbackerLike: 0,
  });

  // A5 timeout_fail_open → 放行 + late 挂钩 _cheatGateLateConsume（迟到拉黑下轮生效）
  const lateCalls = [];
  const eng5 = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'timeout_fail_open', late: Promise.resolve({ grade: 'cheat', reasons: [] }) })),
    _cheatGateLateConsume: (addr, late) => { lateCalls.push({ addr, grade: late && late.grade }); },
  });
  check('timeout → 放行 fail-open', await eng5._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-5', SG()),
    { pass: true, info: { status: 'timeout_fail_open', awaitMs: 15000 } });
  await flush();
  check('timeout → late 链消费（迟到 cheat 补拉黑）', lateCalls, [{ addr: '0xtok', grade: 'cheat' }]);

  // A6 insufficient_ticks / fail（无 grade）→ fail-open 放行进 BP（BP 门兜底）
  const eng6 = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'insufficient_ticks' })) });
  check('insufficient_ticks → 放行', await eng6._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-6', SG()),
    { pass: true, info: { status: 'insufficient_ticks' } });
  const eng6b = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'fail', reason: 'jev_error' })) });
  check('fail → 放行（info 原样透传）', await eng6b._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-6b', SG()),
    { pass: true, info: { status: 'fail', reason: 'jev_error' } });

  // A7 service 抛错 → 放行 error 留痕（检测层故障不拦买点）
  const eng7 = makeEngine({ _cheatCheckService: cheatSvc(async () => { throw new Error('rpc down'); }) });
  const r7 = await eng7._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-7', SG());
  check('service 异常 → 放行 error', r7, { pass: true, info: { status: 'error', reason: 'rpc down' } });

  // A8 recheckUnhealthy 两态透传（gateBuyPoint 第 4 参 opts）
  const optsSeen = [];
  const mkEng8 = (sg) => makeEngine({
    _cheatCheckService: cheatSvc(async (a, m, c, opts) => { optsSeen.push(opts); return { status: 'analyzed', grade: 'healthy', reasons: [] }; }),
  });
  await mkEng8(SG({ cheatRecheck: true }))._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-8', SG({ cheatRecheck: true }));
  await mkEng8(SG())._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-8b', SG({ cheatRecheck: false }));
  check('recheckUnhealthy 透传（true/false 两态）', optsSeen,
    [{ awaitMs: 15000, recheckUnhealthy: true }, { awaitMs: 15000, recheckUnhealthy: false }]);
}

console.log('B. _bpGateEvaluate（BP 门 fail-closed——BP 是点位判定唯一来源无据不买；insufficient_ticks 唯一例外放行）');
{
  // B1 good → 过（默认 pass 集 good/neutral；通过不打 failed）
  const sts = [], metas = [];
  const eng = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'good', prob: 0.72 }, dimensions: { pace: 'mid' }, anchors: { mcapBnb: 5.1 }, model: 'jev', usage: { calls: 1 } })),
    _updateSignalStatus: async (id, status, meta) => { sts.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas.push({ id, data }); },
  });
  const r = await eng._bpGateEvaluate('0xtok', TOKEN, null, 'sig-1', SG(), { firePriceBnb: 1.5e-9, strategyName: 't1', signalCreatedAt: 123 });
  ok('good → 过', r.pass === true, r);
  check('good → 不打 signal failed', sts, []);
  ok('good → buyPoint metadata 形状（passed/passLevels/anchors/model/usage）',
    metas.length === 1 && metas[0].id === 'sig-1' && metas[0].data.buyPoint.status === 'assessed'
    && metas[0].data.buyPoint.passed === true && metas[0].data.buyPoint.passLevels.join('/') === 'good/neutral'
    && metas[0].data.buyPoint.anchors.mcapBnb === 5.1 && metas[0].data.buyPoint.usage.calls === 1,
    metas);

  // B2 neutral → 过
  const eng2 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'neutral', prob: 0.55 } })),
    _updateSignalStatus: async () => {}, _updateSignalMetadata: async () => {},
  });
  ok('neutral → 过（默认 pass 集）', (await eng2._bpGateEvaluate('0xtok', TOKEN, null, 'sig-2', SG(), {})).pass === true);

  // B3 poor → 拒（bp_gate_assessment）
  const sts3 = [];
  const eng3 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'poor', prob: 0.8 } })),
    _updateSignalStatus: async (id, status, meta) => { sts3.push({ id, status, meta }); },
    _updateSignalMetadata: async () => {},
  });
  const r3 = await eng3._bpGateEvaluate('0xtok', TOKEN, null, 'sig-3', SG(), {});
  ok('poor → 拒', r3.pass === false && r3.reason.includes('poor'), r3);
  check('poor → signal failed reason=bp_gate_assessment', sts3.map((s) => [s.status, s.meta.reason]),
    [['failed', 'bp_gate_assessment']]);

  // B4 assessed 但 bucket=null → 拒（不冒充不放过）
  const sts4 = [];
  const eng4 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: null })),
    _updateSignalStatus: async (id, status, meta) => { sts4.push({ id, status, meta }); },
    _updateSignalMetadata: async () => {},
  });
  ok('bucket=null → 拒', (await eng4._bpGateEvaluate('0xtok', TOKEN, null, 'sig-4', SG(), {})).pass === false);
  check('bucket=null → reason 同 bp_gate_assessment', sts4.map((s) => s.meta.reason), ['bp_gate_assessment']);

  // B5 insufficient_ticks → 唯一例外放行（BP9 2026-11-05 用户裁定
  // 「bp_gate_insufficient_ticks 去掉」：极早触发 tick<minTicks=early_bird
  // 常态不判不拦；不打 failed、reason 域绝迹、metadata 留 anchorTickCount）
  const sts5 = [], metas5 = [];
  const eng5 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'insufficient_ticks', anchorTickCount: 5 })),
    _updateSignalStatus: async (id, status, meta) => { sts5.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas5.push({ id, data }); },
  });
  const r5 = await eng5._bpGateEvaluate('0xtok', TOKEN, null, 'sig-5', SG(), {});
  ok('insufficient_ticks → 放行（BP9 去拒）', r5.pass === true, r5);
  check('insufficient_ticks → 不打 signal failed（非拒单）', sts5, []);
  ok('insufficient_ticks → buyPoint metadata 形状（passed=true+anchorTickCount 留痕）',
    metas5.length === 1 && metas5[0].data.buyPoint.status === 'insufficient_ticks'
    && metas5[0].data.buyPoint.passed === true
    && metas5[0].data.buyPoint.anchorTickCount === 5,
    metas5);

  // B6-B7 timeout / fail → 全拒（reason 域 bp_gate_<status>）
  for (const [name, res, reason] of [
    ['timeout', { status: 'timeout' }, 'bp_gate_timeout'],
    ['fail(jev_error)', { status: 'fail', reason: 'jev_error' }, 'bp_gate_fail'],
  ]) {
    const stsX = [];
    const engX = makeEngine({
      _buyPointCheckService: bpSvc(async () => res),
      _updateSignalStatus: async (id, status, meta) => { stsX.push({ id, status, meta }); },
      _updateSignalMetadata: async () => {},
    });
    const rX = await engX._bpGateEvaluate('0xtok', TOKEN, null, 'sig-x', SG(), {});
    ok(`${name} → 拒`, rX.pass === false, rX);
    check(`${name} → signal failed reason=${reason}`, stsX.map((s) => s.meta.reason), [reason]);
  }

  // B8 disabled（service 缺失）→ 拒 + metadata 落 disabled（配置矛盾可见）
  const sts8 = [], metas8 = [];
  const eng8 = makeEngine({
    _updateSignalStatus: async (id, status, meta) => { sts8.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas8.push({ id, data }); },
  });
  const r8 = await eng8._bpGateEvaluate('0xtok', TOKEN, null, 'sig-8', SG(), {});
  ok('disabled → 拒（fail-closed）', r8.pass === false && r8.reason.includes('disabled'), r8);
  check('disabled → signal failed reason=bp_gate_disabled', sts8.map((s) => s.meta.reason), ['bp_gate_disabled']);
  ok('disabled → buyPoint metadata 照落', metas8.length === 1 && metas8[0].data.buyPoint.status === 'disabled', metas8);

  // B9 service 抛错 → 接线级异常 fail-closed 拒（与 cheat 门 catch 放行刻意不同向）
  const sts9 = [];
  const eng9 = makeEngine({
    _buyPointCheckService: bpSvc(async () => { throw new Error('wired wrong'); }),
    _updateSignalStatus: async (id, status, meta) => { sts9.push({ id, status, meta }); },
    _updateSignalMetadata: async () => {},
  });
  const r9 = await eng9._bpGateEvaluate('0xtok', TOKEN, null, 'sig-9', SG(), {});
  ok('service 异常 → 拒（fail-closed）', r9.pass === false && r9.reason.includes('error'), r9);
  check('service 异常 → signal failed reason=bp_gate_error', sts9.map((s) => s.meta.reason), ['bp_gate_error']);

  // B10 bpPassLevels 自定义集收紧：['good'] 下 neutral 拒
  const sts10 = [];
  const eng10 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'neutral', prob: 0.6 } })),
    _updateSignalStatus: async (id, status, meta) => { sts10.push({ id, status, meta }); },
    _updateSignalMetadata: async () => {},
  });
  const r10 = await eng10._bpGateEvaluate('0xtok', TOKEN, null, 'sig-10', SG({ bpPassLevels: ['good'] }), {});
  ok('bpPassLevels=[good] 收紧 → neutral 拒', r10.pass === false, r10);
  ok('bpPassLevels=[good] 下 good 仍过',
    (await makeEngine({
      _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'good', prob: 0.7 } })),
      _updateSignalStatus: async () => {}, _updateSignalMetadata: async () => {},
    })._bpGateEvaluate('0xtok', TOKEN, null, 'sig-10b', SG({ bpPassLevels: ['good'] }), {})).pass === true);

  // B11 metadata 更新失败 → 吞不外抛（门结论不变）
  const eng11 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'good', prob: 0.9 } })),
    _updateSignalStatus: async () => {},
    _updateSignalMetadata: async () => { throw new Error('db down'); },
  });
  ok('metadata 更新失败 → 不外抛（good 照过）',
    (await eng11._bpGateEvaluate('0xtok', TOKEN, null, 'sig-11', SG(), {})).pass === true);

  // B12 ctx 四键透传（fire 价/策略名/信号时刻进 BP state 信号溯源行）
  const ctxSeen = [];
  const eng12 = makeEngine({
    _buyPointCheckService: bpSvc(async (a, m, ctx) => { ctxSeen.push(ctx); return { status: 'assessed', assessment: { bucket: 'good', prob: 0.6 } }; }),
    _updateSignalStatus: async () => {}, _updateSignalMetadata: async () => {},
  });
  await eng12._bpGateEvaluate('0xtok', TOKEN, null, 'sig-12', SG(), { firePriceBnb: 1.5e-9, strategyName: 't1', signalCreatedAt: 123456 });
  check('ctx 透传（signalId/firePriceBnb/strategyName/signalCreatedAt）', ctxSeen.map((c) => ({
    experimentId: c.experimentId, signalId: c.signalId, firePriceBnb: c.firePriceBnb,
    strategyName: c.strategyName, signalCreatedAt: c.signalCreatedAt,
  })), [{ experimentId: 'test-exp', signalId: 'sig-12', firePriceBnb: 1.5e-9, strategyName: 't1', signalCreatedAt: 123456 }]);

  // B12b signalId 缺省（防御路径）→ 不落 metadata 不炸
  const eng12b = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'assessed', assessment: { bucket: 'good', prob: 0.6 } })),
    _updateSignalStatus: async () => {}, _updateSignalMetadata: async () => { throw new Error('signalId 空不应更新 metadata'); },
  });
  ok('signalId=null → 不落 metadata 照常返回',
    (await eng12b._bpGateEvaluate('0xtok', TOKEN, null, null, SG(), {})).pass === true);
}

console.log('C. 触发计数三件套（触发即消耗——门拒/超时不返还）');
{
  // C1 无计数 → 0 / 排除集 null（evaluate 短路零开销）
  const eng = makeEngine({ _strategyEngine: { getAllStrategies: () => [] } });
  check('无计数 → _sgTriggerCount=0', eng._sgTriggerCount('0xtok', 't1'), 0);
  check('无计数 → 排除集 null（零开销短路）', eng._signalGateExcludedIds('0xtok'), null);

  // C2 记账只增（两次触发=2；无任何回滚 API——门拒不返还）
  eng._sgRecordTrigger('0xtok', 't1');
  eng._sgRecordTrigger('0xtok', 't1');
  check('两次触发 → count=2', eng._sgTriggerCount('0xtok', 't1'), 2);
  ok('无回滚路径（_sgRecordTrigger 外无计数递减调用点——E7 源码锁兜底）', true);

  // C3 排除集：maxTriggers 耗尽才进集；非 signalGate 腿恒在集外
  const eng3 = makeEngine({
    _strategyEngine: { getAllStrategies: () => [
      { id: 't1', signalGate: { maxTriggers: 1 } },
      { id: 't2', signalGate: { maxTriggers: 2 } },
      { id: 't3', signalGate: null },
    ] },
  });
  eng3._sgRecordTrigger('0xtok', 't1');   // t1 耗尽（1 >= 1）
  eng3._sgRecordTrigger('0xtok', 't2');   // t2 未耗尽（1 < 2）
  eng3._sgRecordTrigger('0xtok', 't3');   // 非 signalGate 腿计数不进集
  const ex3 = eng3._signalGateExcludedIds('0xtok');
  ok('耗尽收集：t1 进集 / t2 未耗尽不进 / t3 非 signalGate 不进', ex3 instanceof Set && ex3.size === 1 && ex3.has('t1'), ex3);
  eng3._sgRecordTrigger('0xtok', 't2');   // t2 第二次 → 耗尽
  const ex3b = eng3._signalGateExcludedIds('0xtok');
  ok('t2 二次触发耗尽 → 双腿进集', ex3b.size === 2 && ex3b.has('t1') && ex3b.has('t2'), ex3b);

  // C4 有计数但全未耗尽 → null
  const eng4 = makeEngine({
    _strategyEngine: { getAllStrategies: () => [{ id: 't1', signalGate: { maxTriggers: 5 } }] },
  });
  eng4._sgRecordTrigger('0xtok', 't1');
  check('计数未达 maxTriggers → null', eng4._signalGateExcludedIds('0xtok'), null);

  // C5 per-token 隔离（tokenB 无 t1 计数）
  eng3._sgRecordTrigger('0xtokB', 't9');
  ok('per-token 隔离：tokenB 不见 tokenA 计数', eng3._sgTriggerCount('0xtokB', 't1') === 0);
}

console.log('D. StrategyEngine（归一化/fail-fast/互斥/evaluate 排除）');
{
  const leg = (o) => Object.assign({ id: 't1', name: 't1', action: 'buy', priority: 1, condition: 'tradeCount >= 1' }, o);
  const load = (legs) => { const se = new StrategyEngine({}); se.loadStrategies(legs); return se; };

  // D1 缺省默认值（maxTriggers=1 / cheatRecheck=false / bpPassLevels=good+neutral）
  const se1 = load([leg({ signalGate: {} })]);
  check('signalGate={} → 归一化默认值', se1.getAllStrategies()[0].signalGate,
    { maxTriggers: 1, cheatRecheck: false, bpPassLevels: ['good', 'neutral'] });
  const se1b = load([leg({ signalGate: { maxTriggers: 3, cheatRecheck: true, bpPassLevels: ['good'] } })]);
  check('显式值原样归一化', se1b.getAllStrategies()[0].signalGate,
    { maxTriggers: 3, cheatRecheck: true, bpPassLevels: ['good'] });
  ok('无 signalGate 腿 → null（零变化）', load([leg({ id: 'plain' })]).getAllStrategies()[0].signalGate === null);

  // D2 非法形状 fail-fast throw
  await throwsWith('signalGate=字符串 → throw', () => load([leg({ signalGate: 'x' })]).getAllStrategies(), 'signalGate');
  await throwsWith('signalGate 未知键 → throw', () => load([leg({ signalGate: { foo: 1 } })]), '未知键');
  await throwsWith('maxTriggers=0 → throw', () => load([leg({ signalGate: { maxTriggers: 0 } })]), 'maxTriggers');
  await throwsWith('maxTriggers=1.5 → throw', () => load([leg({ signalGate: { maxTriggers: 1.5 } })]), 'maxTriggers');
  await throwsWith('cheatRecheck=字符串 → throw', () => load([leg({ signalGate: { cheatRecheck: 'yes' } })]), 'cheatRecheck');
  await throwsWith('bpPassLevels=[] → throw', () => load([leg({ signalGate: { bpPassLevels: [] } })]), 'bpPassLevels');
  await throwsWith('bpPassLevels 非法桶 → throw', () => load([leg({ signalGate: { bpPassLevels: ['excellent'] } })]), 'bpPassLevels');

  // D3 卖腿携带 → throw（仅买腿可配）
  await throwsWith('卖腿携带 signalGate → throw',
    () => load([{ id: 's1', name: 's1', action: 'sell', priority: 1, condition: 'tradeCount >= 1', cards: 'all', signalGate: {} }]),
    '仅买腿');

  // D4 七旧门字段互斥 throw（并存=两套门行为未定义）
  for (const f of ['narrativeTriggerCondition', 'narrativeCallCondition', 'narrativePrefetchCondition',
    'preBuyCheckCondition', 'repeatBuyCheckCondition', 'gmgnCheckCondition', 'cheatCheckCondition']) {
    await throwsWith(`signalGate ∧ ${f} → throw（互斥）`,
      () => load([leg({ signalGate: {}, [f]: 'tradeCount >= 1' })]), '互斥');
  }

  // D5 evaluate 第 6 参排除（耗尽次腿顶上——阶梯接棒）
  const se5 = load([
    leg({ id: 't1', name: 't1', priority: 1 }),
    leg({ id: 't2', name: 't2', priority: 2, condition: 'tradeCount >= 2' }),
  ]);
  const fr = { tradeCount: 5 };
  check('不传 opts → t1 优先', se5.evaluate(fr, '0xtok', Date.now(), null, 'buy', null)?.id, 't1');
  check('排除 t1 → t2 顶上（阶梯接棒）', se5.evaluate(fr, '0xtok', Date.now(), null, 'buy', { excludeStrategyIds: new Set(['t1']) })?.id, 't2');
  check('全排除 → null', se5.evaluate(fr, '0xtok', Date.now(), null, 'buy', { excludeStrategyIds: new Set(['t1', 't2']) }), null);
  check('排除集空 Set → 恒 null（has 恒 false 不影响）', se5.evaluate(fr, '0xtok', Date.now(), null, 'buy', { excludeStrategyIds: new Set() })?.id, 't1');

  // D6 导出形状
  check('normalizeSignalGate(null) → {normalized:null}', normalizeSignalGate(null), { normalized: null, error: null });
  check('SIGNAL_GATE_BP_LEVELS 四桶', SIGNAL_GATE_BP_LEVELS, ['good', 'neutral', 'poor', 'insufficient']);
}

console.log('E. 引擎侧源码口径锁（事故形状反证）');
{
  const ENG = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const BT = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  const SE = fs.readFileSync(path.join(__dirname, '../src/strategies/StrategyEngine.js'), 'utf8');

  // E1 门链块顺序：记账在作弊门前（触发即消耗先落账，门拒时已消耗=阶梯多次机会设计）
  const blockStart = ENG.indexOf('// ── T117 信号源门链（2026-11-05 买入策略整体调整）──');
  const iRec = ENG.indexOf('this._sgRecordTrigger(tokenAddress, strategy.id);', blockStart);
  const iCheat = ENG.indexOf('await this._cheatGateEvaluateBinary(', blockStart);
  const iBp = ENG.indexOf('await this._bpGateEvaluate(', blockStart);
  ok('门链块定位', blockStart > 0 && iRec > blockStart && iCheat > blockStart && iBp > blockStart, { blockStart, iRec, iCheat, iBp });
  ok('门链顺序：记账 → cheat 门 → BP 门', iRec < iCheat && iCheat < iBp);
  ok('cheat 拒短路在 BP 门前（cheat 拒时 BP 不被调）',
    ENG.indexOf('if (!cheatGate.pass) return', blockStart) < iBp);

  // E2 triggerNo 预读 +1（落库时预读=第 N 次触发 1 起；落库成功后门链块正式记账）
  ok('triggerNo 预读形状', ENG.includes('triggerNo: this._sgTriggerCount(tokenAddress, strategy.id) + 1'));
  ok('metadata 段在门链记账前（预读时计数尚未 +1）',
    ENG.indexOf('triggerNo: this._sgTriggerCount') < iRec);

  // E3 双透传白名单（漏透传=门静默失效，v15 GMGN/v69 cheat 透传事故同款形状）
  ok('实时引擎透传 signalGate: s.signalGate || null', ENG.includes('signalGate: s.signalGate || null'));
  ok('回测引擎同位透传', BT.includes('signalGate: s.signalGate || null'));

  // E4 finally 收口：buying 锁释放后复查 cheat 拉黑（超时放行→迟到拉黑 buying 窗持仓滞留缺口）。
  // 锚定买路径 finally（lastIndexOf 会撞手工买路径同款 delete——切片后取最近一处）
  const iLateClose = ENG.indexOf("'cheat 迟到判定（买路径收口）'");
  const iFinallyDel = ENG.slice(0, iLateClose).lastIndexOf('this._buyingTokens.delete(tokenAddress);');
  ok('finally 收口复查在场', iLateClose > 0);
  ok('收口复查在 buying 锁释放之后', iFinallyDel > 0 && iLateClose > iFinallyDel);

  // E5 BacktestEngine 全量排除集（回测恒拒——用户裁定 2026-11-05）
  ok('回测排除集组装（loadStrategies 后一次性）', BT.includes('.filter(s => s.signalGate).map(s => s.id)'));
  ok('回测买 evaluate 传排除集', BT.includes('this._sgExcludedIds ? { excludeStrategyIds: this._sgExcludedIds } : null'));

  // E6 实时 evaluate 传排除集（阶梯接棒接线点）
  ok('实时 evaluate 第 6 参接线', ENG.includes('{ excludeStrategyIds: this._signalGateExcludedIds(tokenAddress) })'));

  // E7 计数无回滚：_sgRecordTrigger 全源码恰 2 处（定义+门链块唯一调用）——
  // 多一处=有旁路记账点；无「门拒回退」代码（触发即消耗用户裁定）
  check('_sgRecordTrigger 调用点恰 2 处（定义+门链）', ENG.split('_sgRecordTrigger').length - 1, 2);
  ok('无计数回滚形状（源码不含减法回退）', !/_sgRecordTrigger[\s\S]{0,40}-\s*1/.test(ENG));

  // E8 StrategyEngine 互斥七字段清单在场（防字段漏配回退成静默并存）
  ok('互斥七字段数组', SE.includes("'narrativeTriggerCondition', 'narrativeCallCondition'") && SE.includes("'cheatCheckCondition'"));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`信号源门链引擎单测：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('单测运行异常:', e); process.exit(1); });
