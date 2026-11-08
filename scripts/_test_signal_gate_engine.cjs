#!/usr/bin/env node
/**
 * T117 信号源门链引擎接线单测（2026-11-05 买入策略整体调整）——零 DB 零网络
 *
 * 背景：买腿 condition 语义变为「初始买入信号源」（触发策略，per token
 * maxTriggers 默认 1，触发即消耗），fire 且 signal 落库成功后依次走
 * 作弊门（二元版 grade 直接决策）→ 买入点位分析（BP）门，两门都过才买。
 * 双门故障语义刻意不同向：cheat 检测层故障 fail-open 放行进 BP
 * （CD158/GMGN 同向，BP 门兜底）；BP 门 fail-closed（超时/Jev 错/disabled
 * 均拒——BP 是点位判定唯一来源无据不买）——**insufficient_ticks 同拒**
 * （BP10 翻案 2026-11-07 用户裁定「数据不够就挡住而不是放行」，推翻 BP9
 * 2026-11-05 放行；例票 0x18cf6407 anchorTickCount=3 放行买入 15s 后止损）。
 *
 * 覆盖：
 *   A. _cheatGateEvaluateBinary（二元版）：service 缺失·enabled=false 放行
 *      （skipped 留痕）/ cheat 硬拒（拉黑+清仓+signal failed cheat_gate_cheat）/
 *      unhealthy 拒（不拉黑；cached=true 粘滞秒回同拒）/ healthy 放行 info 全
 *      形状 / timeout_fail_open 放行+late 挂钩 _cheatGateLateConsume /
 *      insufficient_ticks·fail 放行 / service 异常放行 / recheckUnhealthy
 *      两态透传（gateBuyPoint 第 4 参 opts）
 *   B. _bpGateEvaluate（fail-closed 全拒含 insufficient_ticks）：good·neutral
 *      过 / poor·bucket=null 拒（bp_gate_assessment）/ insufficient_ticks 拒
 *      打 failed（BP10 翻案）/ timeout·fail·disabled·异常全拒（reason 域
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
    _updateSignalStatus: async () => {},
    _updateSignalMetadata: async () => {},
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
  const exits = [], signals = [], projections = [], metas = [];
  const eng = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:same_block_buy_wave' }], unhealthyGrades: 0 })),
    _cheatExitPosition: async (addr, why) => { exits.push({ addr, why }); },
    _updateSignalStatus: async (id, status, meta) => { signals.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas.push({ id, data }); },
    _projectCheatFactors: (addr, res) => { projections.push(res.grade); },
  });
  const r = await eng._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-1', SG());
  ok('cheat → 拒买', r.pass === false && r.reason.includes('cheat'), r);
  ok('cheat → 引擎侧拉黑', eng._cheatBlockedTokens.has('0xtok'));
  check('cheat → 清仓联动（why=cheat 判定）', exits, [{ addr: '0xtok', why: 'cheat 判定' }]);
  check('cheat → signal failed reason=cheat_gate_cheat', signals.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_cheat']]);
  check('cheat → grade 照投影（cheat 56 键快照/卖腿可消费）', projections, ['cheat']);
  // 拒前先落 cheatCheck 段（拒行可观测性——通道/档位明细，2026-11-07）
  ok('cheat → 拒前落 metadata.cheatCheck 段（grade+reasons）',
    metas.length === 1 && metas[0].data.cheatCheck.grade === 'cheat'
    && metas[0].data.cheatCheck.reasons[0].code === 'A_strong:same_block_buy_wave', metas);

  // A3 unhealthy → signal failed 拒（不拉黑不清仓——cheatRecheck 下个买信号重判）
  const signals3 = [], metas3 = [];
  const eng3 = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'D_famous_dominance' }], unhealthyGrades: 2 })),
    _cheatExitPosition: async () => { throw new Error('unhealthy 不应清仓'); },
    _updateSignalStatus: async (id, status, meta) => { signals3.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas3.push({ id, data }); },
  });
  const r3 = await eng3._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-2', SG());
  ok('unhealthy → 拒买', r3.pass === false && r3.reason.includes('unhealthy'), r3);
  ok('unhealthy → 不拉黑', !eng3._cheatBlockedTokens.has('0xtok'));
  check('unhealthy → signal failed reason=cheat_gate_unhealthy', signals3.map((s) => [s.status, s.meta.reason]),
    [['failed', 'cheat_gate_unhealthy']]);
  ok('unhealthy → 拒前落 metadata.cheatCheck 段（grade+reasons+unhealthyGrades）',
    metas3.length === 1 && metas3[0].data.cheatCheck.grade === 'unhealthy'
    && metas3[0].data.cheatCheck.reasons[0].code === 'D_famous_dominance'
    && metas3[0].data.cheatCheck.unhealthyGrades === 2, metas3);

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
      exempt: null, // CD379 活跃度豁免留痕位（service 出口变换才有值）
      unblocked: false, // CD381 翻案留痕位（forceRecheck 重检解除拉黑才有 true）
    },
    pumpExempt: false, // BP42 位置门透传位（exempt ∧ slowGrindPump≥3 才 true——本行无豁免）
  });
  // healthy 缺席键 → 缺省形状（不冒充）
  const eng4b = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'healthy' })) });
  check('healthy 缺席键 → 缺省形状', (await eng4b._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4b', SG())).info, {
    status: 'analyzed', grade: 'healthy', cached: false, reasons: [], unhealthyGrades: 0,
    levels: null, buckets: null, strongbackerLike: 0, exempt: null, unblocked: false,
  });

  // A4b CD381 重锚：grade 路径 markCheatGateEvaluated（fire 时刻 vsLaunch 透传）
  const FA = require('../src/services/FourMemeFactorAggregator');
  FA.clearCheatGatePriceAnchor('0xtok');
  const eng4c = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'healthy' })) });
  await eng4c._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4c', SG(),
    { factorResults: { currentVsLaunchPct: 35.2 } });
  check('grade 路径 → FA 重锚（fire vsLaunch 原值）', FA.getCheatGatePriceAnchor('0xtok'), { minVsLaunch: 35.2 });
  const eng4d = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'healthy' })) });
  await eng4d._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4d', SG(), {});
  check('factorResults 缺席 → 重锚 min:null（未见可靠价不冒充）', FA.getCheatGatePriceAnchor('0xtok'), { minVsLaunch: null });
  // insufficient/fail 无 grade → 不重锚（重检窗保持武装，下轮信号自动重试）
  const eng4e = makeEngine({ _cheatCheckService: cheatSvc(async () => ({ status: 'insufficient_ticks' })) });
  await eng4e._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4e', SG(),
    { factorResults: { currentVsLaunchPct: 10 } });
  check('insufficient 无 grade → 不重锚（锚保持）', FA.getCheatGatePriceAnchor('0xtok'), { minVsLaunch: null });
  FA.clearCheatGatePriceAnchor('0xtok');

  // A4c CD381 翻案：res.unblocked=true → 引擎侧拉黑 Set 同步解除
  const eng4f = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'analyzed', grade: 'healthy', unblocked: true })),
  });
  eng4f._cheatBlockedTokens.add('0xtok');
  const r4f = await eng4f._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4f', SG());
  ok('翻案 → 放行', r4f.pass === true);
  ok('翻案 → 引擎侧拉黑解除', !eng4f._cheatBlockedTokens.has('0xtok'));
  ok('翻案 → info.unblocked 留痕', r4f.info.unblocked === true);

  // A4d BP42 pump 豁免票位置门透传（2026-11-08 用户裁定「把活跃度高的命中 pump 的
  //     依然豁免掉，但是把信息传入购买前检查，只允许 near_launch 范围内的价格买入」）：
  //     CD379 豁免出口（exempt 在场）∧ levels.slowGrindPump≥3（strong，与 A 通道主判
  //     线同档）→ cheat 门出口打标 pumpExempt → 调用方透传 _bpGateEvaluate ctx →
  //     service opts.pumpExempt（BuyPointCheckService 位置门 PUMP_EXEMPT_LAUNCH_PCT=40）
  const eng4g = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({
      status: 'analyzed', grade: 'healthy',
      exempt: { code: 'activity_high', originalGrade: 'cheat' }, // CD379 豁免已发生
      levels: { slowGrindPump: 3 }, buckets: { activityLevel: 'high' },
    })),
  });
  const r4g = await eng4g._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4g', SG());
  ok('豁免 pump strong → 放行+打标 pumpExempt', r4g.pass === true && r4g.pumpExempt === true, r4g);
  const eng4h = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({
      status: 'analyzed', grade: 'healthy',
      exempt: { code: 'activity_high', originalGrade: 'unhealthy' },
      levels: { slowGrindPump: 2, washPair: 3 }, buckets: { activityLevel: 'high' }, // pump=moderate（≠strong）+wash strong 非豁免票路径
    })),
  });
  const r4h = await eng4h._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-4h', SG());
  ok('pump=moderate/无 pump → 不打标（strong 档与 A 通道主判线同档）', r4h.pumpExempt === false, r4h);
  // service opts 透传：_bpGateEvaluate ctx.pumpExempt → gateBuyPoint opts.pumpExempt
  const bpOptsSeen = [];
  const eng4i = makeEngine({
    _buyPointCheckService: bpSvc(async (_a, _m, _c, opts) => {
      bpOptsSeen.push(opts);
      return { status: 'assessed', assessment: { bucket: 'good', prob: 0.8, rule: 'any_good' } };
    }),
  });
  await eng4i._bpGateEvaluate('0xtok', TOKEN, null, 'sig-4i', SG(), { pumpExempt: true });
  ok('BP 门 opts.pumpExempt 透传（service 收到 true）', bpOptsSeen.length === 1 && bpOptsSeen[0].pumpExempt === true, bpOptsSeen);
  await eng4i._bpGateEvaluate('0xtok', TOKEN, null, 'sig-4i2', SG(), {});
  ok('ctx 不带 pumpExempt → opts 无键（普通票位置门不触发）', !('pumpExempt' in bpOptsSeen[1]), bpOptsSeen[1]);
  // 门链调用点源码锁：两引擎门链 cheat 结果 → BP ctx 透传在场（FourMemeWss + Backtest）
  const srcFm = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/FourMemeWssTradingEngine.js'), 'utf8');
  const srcBt = fs.readFileSync(path.join(__dirname, '../src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  ok('门链调用点透传在场（FourMemeWss/Backtest 两处 cheatGate.pumpExempt === true）',
    srcFm.includes('pumpExempt: cheatGate.pumpExempt === true') && srcBt.includes('pumpExempt: cheatGate.pumpExempt === true'));

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

  // A6b CD384 reset_insufficient_ticks → fail-closed 硬拒不进 BP（bt-v83 完整窗口
  // 87/87 实证：reset 截窗制造的不足放行 → BP ⑦ 位置门同向放行 → 87 票净 -1.38
  // 占全窗口亏损 72%；「上一轮冲高形状出窗+新窗无证据」双盲区宁拦不冒充）
  const sts6c = []; const metas6c = [];
  const eng6c = makeEngine({
    _cheatCheckService: cheatSvc(async () => ({ status: 'reset_insufficient_ticks', anchorTickCount: 3, marketReset: { minVsLaunchPct: 5, fullAnchorTickCount: 30 } })),
    _updateSignalStatus: (id, st, m) => { sts6c.push({ id, st, reason: m.reason }); },
    _updateSignalMetadata: (id, d) => { metas6c.push({ id, d }); },
  });
  const r6c = await eng6c._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-6c', SG());
  ok(r6c.pass === false && /盘面重置后 tick 不足/.test(r6c.reason || ''),
    `reset_insufficient → 拒（CD384 fail-closed；实际 ${JSON.stringify(r6c.pass)}/${r6c.reason}）`);
  ok(sts6c.length === 1 && sts6c[0].st === 'failed' && sts6c[0].reason === 'cheat_gate_reset_insufficient',
    `signal failed reason=cheat_gate_reset_insufficient（实际 ${JSON.stringify(sts6c)}）`);
  ok(metas6c.length === 1 && metas6c[0].d.cheatCheck.status === 'reset_insufficient_ticks'
    && metas6c[0].d.cheatCheck.anchorTickCount === 3 && metas6c[0].d.cheatCheck.marketReset.fullAnchorTickCount === 30,
    `cheatCheck metadata 留痕（status/anchorTickCount/marketReset；实际 ${JSON.stringify(metas6c[0] && metas6c[0].d.cheatCheck)}）`);
  ok(eng6c._cheatBlockedTokens.size === 0, 'reset_insufficient 拒不拉黑（非 cheat 判定——下个买信号可重析）');

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

  // A9 CD381 recheckCondition 表达式评估 → forceRecheck 透传（真=重检绕拉黑/粘滞；
  // 假=零 forceRecheck 键走原路径；异常=按假保守不重检 warn 留痕）
  const RC = "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1";
  const opts9 = [];
  const mkEng9 = () => makeEngine({
    _cheatCheckService: cheatSvc(async (a, m, c, opts) => { opts9.push(opts); return { status: 'analyzed', grade: 'healthy', reasons: [] }; }),
  });
  await mkEng9()._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9', SG({ recheckCondition: RC }),
    { factorResults: { preCheatResult: 'unhealthy', priceBackToAlmostLaunch: 0 } });
  await mkEng9()._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9b', SG({ recheckCondition: RC }),
    { factorResults: { preCheatResult: 'cheat', priceBackToAlmostLaunch: 1 } });
  await mkEng9()._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9c', SG({ recheckCondition: RC }),
    { factorResults: { preCheatResult: 'healthy', priceBackToAlmostLaunch: 0 } });
  await mkEng9()._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9d', SG({ recheckCondition: RC }),
    { factorResults: { preCheatResult: null, priceBackToAlmostLaunch: null } });
  check('recheckCondition 表达式评估 → forceRecheck 两态（unhealthy 命中/backToAlmost 命中/全不命中/缺证不命中）',
    opts9.map((o) => o.forceRecheck === true),
    [true, true, false, false]);
  // 无 recheckCondition / 无 factorResults → 零 forceRecheck（回落现状）
  const opts9b = [];
  const mkEng9b = () => makeEngine({
    _cheatCheckService: cheatSvc(async (a, m, c, opts) => { opts9b.push(opts); return { status: 'analyzed', grade: 'healthy', reasons: [] }; }),
  });
  await mkEng9b()._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9e', SG(), { factorResults: { preCheatResult: 'unhealthy' } });
  await mkEng9b()._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9f', SG({ recheckCondition: RC }), {});
  check('无 recheckCondition / 无 factorResults → 零 forceRecheck 键', opts9b.map((o) => o.forceRecheck), [undefined, undefined]);
  // 表达式语法错 → 按假保守不重检（运行期兜底；键集错 loadStrategies 三防线已拦）
  const opts9c = [];
  const eng9c = makeEngine({
    _cheatCheckService: cheatSvc(async (a, m, c, opts) => { opts9c.push(opts); return { status: 'analyzed', grade: 'healthy', reasons: [] }; }),
  });
  await eng9c._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-9g', SG({ recheckCondition: '&&& 语法错' }),
    { factorResults: { preCheatResult: 'unhealthy' } });
  check('表达式异常 → 按假不重检（fail-safe）', opts9c[0].forceRecheck, undefined);

  // A10 CD381 timeout late 路径：迟到 grade 重锚 + unblocked 解除引擎拉黑
  const eng10 = Object.assign(makeEngine({
    _cheatCheckService: cheatSvc(async () => ({
      status: 'timeout_fail_open',
      late: Promise.resolve({ status: 'analyzed', grade: 'unhealthy', unblocked: true, reasons: [] }),
    })),
  }), { _projectCheatFactors: () => {}, _cheatExitPosition: async () => {} });
  eng10._cheatBlockedTokens.add('0xtok');
  FA.clearCheatGatePriceAnchor('0xtok');
  const r10 = await eng10._cheatGateEvaluateBinary('0xtok', TOKEN, null, 'sig-10', SG(),
    { factorResults: { currentVsLaunchPct: 12.5 } });
  ok('timeout → 放行 fail-open', r10.pass === true);
  await flush();
  ok('迟到 unblocked → 引擎侧拉黑解除', !eng10._cheatBlockedTokens.has('0xtok'));
  check('迟到 grade → 重锚（fire vsLaunch 透传）', FA.getCheatGatePriceAnchor('0xtok'), { minVsLaunch: 12.5 });
  FA.clearCheatGatePriceAnchor('0xtok');
}

console.log('B. _bpGateEvaluate（BP 门 fail-closed——BP 是点位判定唯一来源无据不买；insufficient_ticks 同拒=BP10 翻案）');
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

  // B5 insufficient_ticks → 拒（BP10 翻案 2026-11-07 用户裁定「数据不够就
  // 挡住而不是放行」——推翻 BP9 放行；例票 0x18cf6407 anchorTickCount=3
  // 放行买入 15s 后止损。fail-closed：打 failed reason=bp_gate_insufficient_ticks、
  // metadata passed=false+anchorTickCount 留痕）
  const sts5 = [], metas5 = [];
  const eng5 = makeEngine({
    _buyPointCheckService: bpSvc(async () => ({ status: 'insufficient_ticks', anchorTickCount: 5 })),
    _updateSignalStatus: async (id, status, meta) => { sts5.push({ id, status, meta }); },
    _updateSignalMetadata: async (id, data) => { metas5.push({ id, data }); },
  });
  const r5 = await eng5._bpGateEvaluate('0xtok', TOKEN, null, 'sig-5', SG(), {});
  ok('insufficient_ticks → 拒（BP10 翻案）', r5.pass === false && r5.reason.includes('insufficient_ticks'), r5);
  check('insufficient_ticks → signal failed reason=bp_gate_insufficient_ticks',
    sts5.map((s) => [s.status, s.meta.reason]), [['failed', 'bp_gate_insufficient_ticks']]);
  ok('insufficient_ticks → buyPoint metadata 形状（passed=false+anchorTickCount 留痕）',
    metas5.length === 1 && metas5[0].data.buyPoint.status === 'insufficient_ticks'
    && metas5[0].data.buyPoint.passed === false
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

  // D1 缺省默认值（maxTriggers=1 / cheatRecheck=false / recheckCondition=null / bpPassLevels=good+neutral）
  const se1 = load([leg({ signalGate: {} })]);
  check('signalGate={} → 归一化默认值', se1.getAllStrategies()[0].signalGate,
    { maxTriggers: 1, cheatRecheck: false, recheckCondition: null, bpPassLevels: ['good', 'neutral'] });
  const se1b = load([leg({ signalGate: { maxTriggers: 3, cheatRecheck: true, recheckCondition: 'tradeCount >= 5', bpPassLevels: ['good'] } })]);
  check('显式值原样归一化', se1b.getAllStrategies()[0].signalGate,
    { maxTriggers: 3, cheatRecheck: true, recheckCondition: 'tradeCount >= 5', bpPassLevels: ['good'] });
  ok('无 signalGate 腿 → null（零变化）', load([leg({ id: 'plain' })]).getAllStrategies()[0].signalGate === null);

  // D2 非法形状 fail-fast throw
  await throwsWith('signalGate=字符串 → throw', () => load([leg({ signalGate: 'x' })]).getAllStrategies(), 'signalGate');
  await throwsWith('signalGate 未知键 → throw', () => load([leg({ signalGate: { foo: 1 } })]), '未知键');
  await throwsWith('maxTriggers=0 → throw', () => load([leg({ signalGate: { maxTriggers: 0 } })]), 'maxTriggers');
  await throwsWith('maxTriggers=1.5 → throw', () => load([leg({ signalGate: { maxTriggers: 1.5 } })]), 'maxTriggers');
  await throwsWith('cheatRecheck=字符串 → throw', () => load([leg({ signalGate: { cheatRecheck: 'yes' } })]), 'cheatRecheck');
  await throwsWith('bpPassLevels=[] → throw', () => load([leg({ signalGate: { bpPassLevels: [] } })]), 'bpPassLevels');
  await throwsWith('bpPassLevels 非法桶 → throw', () => load([leg({ signalGate: { bpPassLevels: ['excellent'] } })]), 'bpPassLevels');
  // D2b CD381 recheckCondition 非法形状（非字符串/空串/超长）fail-fast
  await throwsWith('recheckCondition=数字 → throw', () => load([leg({ signalGate: { recheckCondition: 5 } })]), 'recheckCondition');
  await throwsWith('recheckCondition=空串 → throw', () => load([leg({ signalGate: { recheckCondition: '  ' } })]), 'recheckCondition');
  await throwsWith('recheckCondition=超长 → throw', () => load([leg({ signalGate: { recheckCondition: 'x'.repeat(501) } })]), '超长');
  // D2c recheckCondition 未知因子 → loadStrategies 键域 throw（键名写错=重判条件
  // 静默恒假永不重检，拒启；availableFactorIds 传入才校验）
  const loadIds = (legs, ids) => { const se = new StrategyEngine({}); se.loadStrategies(legs, ids); return se; };
  const IDS = new Set(['tradeCount', 'preCheatResult', 'priceBackToAlmostLaunch']);
  await throwsWith('recheckCondition 未知因子 → throw（FA 键域）',
    () => loadIds([leg({ signalGate: { recheckCondition: 'preCheatReslt == 1' } })], IDS), 'recheckCondition');
  ok('recheckCondition 合法键 → 加载通过',
    loadIds([leg({ signalGate: { recheckCondition: "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1" } })], IDS)
      .getAllStrategies()[0].signalGate.recheckCondition === "preCheatResult == 'unhealthy' OR priceBackToAlmostLaunch == 1");

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
  const ABS = fs.readFileSync(path.join(__dirname, '../src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
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

  // E7 计数无回滚：_sgRecordTrigger 定义在基类（2026-11-07 门链上移）、调用在
  // FourMeme 门链块恰 1 处——多一处=有旁路记账点；无「门拒回退」代码（触发即
  // 消耗用户裁定）；BacktestEngine signalGateReal 挂点为第二调用域（接线时此处
  // 同步放宽）
  check('_sgRecordTrigger 定义在基类恰 1 处', ABS.split('_sgRecordTrigger').length - 1, 1);
  check('_sgRecordTrigger FourMeme 调用恰 1 处（门链块）', ENG.split('_sgRecordTrigger').length - 1, 1);
  ok('无计数回滚形状（源码不含减法回退）',
    !/_sgRecordTrigger[\s\S]{0,40}-\s*1/.test(ENG) && !/_sgRecordTrigger[\s\S]{0,40}-\s*1/.test(ABS));

  // E8 StrategyEngine 互斥七字段清单在场（防字段漏配回退成静默并存）
  ok('互斥七字段数组', SE.includes("'narrativeTriggerCondition', 'narrativeCallCondition'") && SE.includes("'cheatCheckCondition'"));

  // E9 signalGateReal 条件化（2026-11-07 受控解禁「回测恒拒」2026-11-05 裁定）：
  // 缺省 false=排除集全量组装现状零影响；=true 真调门链——排除集按触发计数、
  // 挂点先记账后两门（anchorMs=nowTs 虚拟时刻透传防 DB 全史前视）、服务构造
  // persist:false 隔离注入（禁写 cheat_detection/buy_point_analyses 全局表）
  ok('signalGateReal 开关缺省 false（其它回测实验恒拒现状零影响）',
    BT.includes('this._signalGateReal = backtestConfig.signalGateReal === true;'));
  ok('signalGateReal 排除集短路（真调链路不组装全量排除集）',
    BT.includes('const _sgIds = this._signalGateReal ? [] :'));
  ok('signalGateReal evaluate 走触发计数排除集（阶梯接棒与实时同语义）',
    BT.includes('this._signalGateReal\n        ? { excludeStrategyIds: this._signalGateExcludedIds(tokenAddress) }'));
  ok('signalGateReal 门链挂点（signal 落库后先记账→作弊门→BP 门）',
    BT.includes('strategy.signalGate && this._signalGateReal') &&
    BT.includes('this._sgRecordTrigger(tokenAddress, strategy.id);\n\n        const _meta'));
  ok('signalGateReal 两门 anchorMs=nowTs 虚拟时刻透传（service lte 截窗防前视）',
    BT.includes('strategy.signalGate,\n          { anchorMs: nowTs, factorResults })') &&
    BT.includes('anchorMs: nowTs,'));
  ok('signalGateReal 服务构造 persist:false 隔离注入',
    BT.includes('persist: false, settleDelayMs: 0'));
  ok('signal 落库 metadata signalGate 段（triggerNo 预读 +1 留痕）',
    BT.includes('triggerNo: this._sgTriggerCount(tokenAddress, strategy.id) + 1'));
}

console.log(`\n${'='.repeat(60)}`);
console.log(`信号源门链引擎单测：${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('单测运行异常:', e); process.exit(1); });
