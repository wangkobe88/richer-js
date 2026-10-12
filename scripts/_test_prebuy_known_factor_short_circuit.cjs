/**
 * P4a 已知因子合取项短路单测（2026-10-12 回测性能第三层画像，零 DB 零网络）
 *
 * 被测机制：条件顶层 AND 链中存在「全部因子检查前已知（引擎 options 透传）且
 * 当次评估 false」的合取项 → 整条条件恒 false → canBuy 必然 false → 跳过全部
 * 子检查（perf3 实测 44.5% 检查 rating=1 恒拦仍走全链 83ms/次 = 墙钟 23% 纯浪费）。
 *
 * 六节：
 *  1 判定语义：触发/不触发/混合项防御/常数项/顶层 OR/null 语义
 *  2 performAllChecks 集成：短路零子调用 + 开关关零变化（live 防线）+ 翻正恢复
 *  3 等价性对拍（核心）：短路触发 ⇒ 完整 context（未知因子极端值采样）评估恒 false
 *  4 防漂移：knownCtx 键集/取值与生产 context（空壳捕获）逐键对拍
 *  5 事故反证：perf3 宣告竞态形状（rating=1 重复 fire 重复短路，rating 翻正恢复全链）
 */
'use strict';

const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');

const stubLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let pass = 0, fail = 0;
function ok(cond, label, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}${detail !== undefined ? ` | ${detail}` : ''}`); }
}

const ev = new ConditionEvaluator();

// perf3 实跑策略的代表性条件形状（评级门 AND 晚票门 AND 早期交易门——第三项
// 是检查产物=未知因子）
const COND_REAL = '(narrativeRating == 2 OR narrativeRating == 3) AND (narrativeCorpusLagSec < 300 OR earlyReturn >= 100) AND earlyTradesCountPerMin >= 5';

function mkSvc(extraConfig) {
  return new PreBuyCheckService({}, stubLogger, { knownFactorShortCircuit: true, ...extraConfig });
}

// ═══ 1. 判定语义 ═══
console.log('1. _evaluateKnownFalseTerm 判定语义');
{
  const svc = mkSvc();
  // 1a/1b: rating=1 / rating=9（未评级）→ 首项 (2 OR 3) 恒 false → 短路
  for (const r of [1, 9]) {
    const t = svc._evaluateKnownFalseTerm(COND_REAL, { narrativeRating: r });
    ok(t !== null && t.includes('narrativeRating == 2') && t.includes('OR'),
      `1. rating=${r} → 短路命中评级项（返回项文本）`, `term=${t}`);
  }
  // 1c: rating=2 + lag=100 → 前两项真，第三项含未知因子 → 不短路
  ok(svc._evaluateKnownFalseTerm(COND_REAL, { narrativeRating: 2, narrativeCorpusLagSec: 100 }) === null,
    '1c. rating=2 前两项真 + 未知项 → 不短路');
  // 1d: rating=2 + lag=null + earlyReturn=null → 晚票项 null 比较恒 false（fail-closed
  // 已知语义）→ 短路（与正常路径 null 语义一致，等价）
  ok(svc._evaluateKnownFalseTerm(COND_REAL, { narrativeRating: 2, narrativeCorpusLagSec: null, earlyReturn: null }) !== null,
    '1d. rating=2 + lag=null（晚票 fail-closed）→ 晚票项短路');
  // 1e: 放行形状反证——rating=1 是条件合法值的门不误拦
  const COND_PASS = 'narrativeRating == 1 OR narrativeRating == 2 OR narrativeRating == 3';
  ok(svc._evaluateKnownFalseTerm(COND_PASS, { narrativeRating: 1 }) === null,
    '1e. 顶层 OR 全 known 且当次真（rating=1 放行形状）→ 不短路');
  // 1f: 顶层 OR 全 known 且 false → 短路（整条件=该项，恒 false 数学等价）
  ok(svc._evaluateKnownFalseTerm(COND_PASS, { narrativeRating: 9 }) !== null,
    '1f. 顶层 OR 全 known 恒假（rating=9 不在枚举）→ 短路');
  // 1g: 常数项不评估（保守），known 项照常短路
  ok(svc._evaluateKnownFalseTerm('1 == 1 AND (narrativeRating == 2 OR narrativeRating == 3)', { narrativeRating: 1 }) !== null,
    '1g. 常数真项 + rating 恒假项 → 仍短路（常数项跳过不评）');
  ok(svc._evaluateKnownFalseTerm('1 == 1', {}) === null, '1h. 纯常数条件 → 不短路（无因子不评）');
  // 1i: 安全边界核心——未知因子独占项绝不评估（防 undefined→false 误拦）
  ok(svc._evaluateKnownFalseTerm('earlyTradesTop1BuySharePct < 60', { narrativeRating: 1 }) === null,
    '1i. 未知因子独占条件 → 不短路（防误拦边界）');
  ok(svc._evaluateKnownFalseTerm('earlyTradesTop1BuySharePct >= 60 AND narrativeRating == 2', { narrativeRating: 1 }) !== null,
    '1j. 混合条件含恒假 known 项 → 短路（unknown 项不参与判定）');
  // 1k: platform 字符串比较（rightString 路径）
  const COND_PF = "platform != 'flap' AND (narrativeRating == 2 OR narrativeRating == 3)";
  ok(svc._evaluateKnownFalseTerm(COND_PF, { platform: 'flap' }) !== null,
    '1k. platform=flap → 平台分门项 false → 短路');
  const tNull = svc._evaluateKnownFalseTerm(COND_PF, { platform: null });
  const nullEvalsFalse = ev.evaluate("platform != 'flap'", { platform: null }) === false;
  ok(tNull !== null && nullEvalsFalse,
    '1l. platform=null → null 比较恒 false 同正常路径 → 短路（语义一致前提自证）',
    `t=${tNull} nullCmpFalse=${nullEvalsFalse}`);
  // 1m: IS NULL 形状因子收集
  ok(svc._evaluateKnownFalseTerm('earlyTradesRouterLowSideSeen IS NULL AND gmgnRiskCovered == 0', { earlyTradesRouterLowSideSeen: 5, gmgnRiskCovered: 1 }) !== null,
    '1m. IS NULL 项（seen=5 非 NULL → false）+ covered=1 → 双恒假 → 短路');
  // 1n: 解析失败 fail-open
  ok(svc._evaluateKnownFalseTerm('((narrativeRating == 2', { narrativeRating: 1 }) === null,
    '1n. 语法坏条件 → fail-open 不短路');
  // 1o: 开关关 → 恒 null（live 默认零变化）
  ok(mkSvc({ knownFactorShortCircuit: false })._evaluateKnownFalseTerm(COND_REAL, { narrativeRating: 1 }) === null,
    '1o. knownFactorShortCircuit=false → 恒不短路');
  // 1p: 空条件
  ok(svc._evaluateKnownFalseTerm('', {}) === null && svc._evaluateKnownFalseTerm('   ', {}) === null,
    '1p. 空/空白条件 → 不短路');
}

// ═══ 2. performAllChecks 集成 ═══
async function main() {
console.log('2. performAllChecks 集成（子调用计数）');
{
  // 子检查全打桩计数：短路时必须零调用
  function stubSubChecks(svc) {
    let calls = 0;
    const bump = () => { calls++; return {}; };
    svc._performEarlyParticipantCheck = bump;
    svc._performHolderCheck = bump;
    svc._performWalletClusterCheck = bump;
    svc._checkCreatorIsNotBadDevWallet = bump;
    svc._performStrongTraderPositionCheck = bump;
    svc._performSameNameCheck = bump;
    svc.walletLabelService.calculateLabelFactors = bump;
    svc.holderService.checkEarlyTradersRisk = bump;
    return () => calls;
  }
  const ARGS = ['0xtoken', null, 'exp1', 'sig1', 'bsc', { innerPair: '0xpair' }, COND_REAL];

  // 2a: rating=1 短路 → 零子调用 + 返回形状
  {
    const svc = mkSvc();
    const getCalls = stubSubChecks(svc);
    const r = await svc.performAllChecks(...ARGS, { narrativeRating: 1, checkTime: 1000 });
    ok(r.canBuy === false && r.shortCircuited === true,
      '2a1. rating=1 → canBuy=false + shortCircuited=true');
    ok(getCalls() === 0, '2a2. 全部子检查零调用（短路跳过全链）', `calls=${getCalls()}`);
    ok(typeof r.checkReason === 'string' && r.checkReason.includes('已知因子恒假短路'),
      '2a3. checkReason 含短路标记', r.checkReason);
    ok(r.preBuyCheck === 1 && r.narrativeRating === 1 && r.earlyTraderBlacklistCount === 0,
      '2a4. 失败形状字段齐（preBuyCheck=1 / rating 透传 / 黑名单 0）');
    ok(!('earlyTradesRouterPct' in r) || r.earlyTradesRouterPct === 0,
      '2a5. router 门回填不受影响（短路无该产物字段→引擎侧 != null 不回填）');
  }
  // 2b: rating=2 混合项 → 走全链（sentinel 验证）
  {
    const svc = mkSvc();
    stubSubChecks(svc);
    const sentinel = { canBuy: 'FULLCHAIN', preTraderCanBuy: 'FULLCHAIN' };
    svc._evaluateWithCondition = (...a) => sentinel;
    const r = await svc.performAllChecks(...ARGS, { narrativeRating: 2, narrativeCorpusLagSec: 100 });
    ok(r === sentinel, '2b. rating=2（不短路）→ 正常走全链评估');
  }
  // 2c: 开关关（默认构造）+ rating=1 → 照常全链（live 零变化防线）
  {
    const svc = new PreBuyCheckService({}, stubLogger, {});
    stubSubChecks(svc);
    const sentinel = { canBuy: 'OFF' };
    svc._evaluateWithCondition = () => sentinel;
    const r = await svc.performAllChecks(...ARGS, { narrativeRating: 1 });
    ok(r === sentinel, '2c. 默认 config（开关 false）rating=1 → 不短路照常全链');
  }
  // 2d: 空条件 → 默认通过路径不短路
  {
    const svc = mkSvc();
    stubSubChecks(svc);
    const sentinel = { canBuy: 'EMPTY' };
    svc._evaluateWithCondition = () => sentinel;
    const r = await svc.performAllChecks('0xtoken', null, 'exp1', 'sig1', 'bsc', { innerPair: '0xpair' }, '', {});
    ok(r === sentinel, '2d. 空条件 → 不短路（默认通过路径）');
  }
}

// ═══ 3. 等价性对拍（核心）：短路触发 ⇒ 完整评估必 false ═══
console.log('3. 等价性对拍（未知因子极端值采样）');
{
  const svc = mkSvc();
  // 未知因子采样值：短路声称「未知因子取任何值结果都 false」——采样验证
  const SAMPLES = [-1e9, -1, 0, 1, 1e9, null];
  const unknownFactor = 'earlyTradesCountPerMin';
  const cases = [
    ['rating=1 恒拦主形状', COND_REAL, { narrativeRating: 1 }],
    ['rating=9 未评级', COND_REAL, { narrativeRating: 9 }],
    ['晚票 null fail-closed', COND_REAL, { narrativeRating: 2, narrativeCorpusLagSec: null, earlyReturn: null }],
    ['rating=2 + lag=400 + earlyReturn=50（晚票项 false）', COND_REAL, { narrativeRating: 2, narrativeCorpusLagSec: 400, earlyReturn: 50 }],
    ['平台分门 flap', COND_PF_OR_RATING(), { platform: 'flap' }],
  ];
  function COND_PF_OR_RATING() { return "platform != 'flap' AND (narrativeRating == 2 OR narrativeRating == 3)"; }
  for (const [label, cond, opts] of cases) {
    const term = svc._evaluateKnownFalseTerm(cond, opts);
    ok(term !== null, `3x. [${label}] 先决：短路触发`);
    if (term === null) continue;
    let allFalse = true, badVal = null;
    for (const s of SAMPLES) {
      // 完整 context = known 因子（同语义注入）+ 未知因子采样值
      const ctx = { ...svc._buildKnownFactorContext(opts), [unknownFactor]: s };
      if (ev.evaluate(cond, ctx) !== false) { allFalse = false; badVal = s; break; }
    }
    ok(allFalse, `3x. [${label}] 完整评估恒 false（含未知因子采样全过）`, `bad sample=${badVal}`);
  }
}

// ═══ 4. 防漂移对拍：knownCtx vs 生产 context（空壳捕获）═══
console.log('4. knownCtx 与生产 context 逐键对拍');
{
  // 特征 options：0/null/undefined/'' 能区分 || 与 ?? 的取值语义
  const featOpts = {
    buyRound: 0, lastPairReturnRate: null, platform: undefined, narrativeRating: null,
    narrativeCorpusLagSec: undefined, earlyReturn: 0, narrativeLeaderHot: undefined,
    narrativeLeaderCount: null, narrativeLeaderMaxMultiple: 0,
    gmgnIssuerTokenCount: null, gmgnBundlerWalletRatio: undefined, gmgnRiskCovered: 0,
    tweetAuthorType: null, dataCollectionRound: undefined, drawdownFromHighest: 0,
    earlyTradesRouterLowSideSeen: null, earlyTradesRouterRejectCount: undefined,
  };
  const svc = mkSvc();
  // 走真实 performAllChecks → _evaluateWithCondition → _safeEvaluate 捕获生产
  // context（条件 '1 == 1' 无因子必不短路；子检查打桩零 IO）
  svc._performEarlyParticipantCheck = async () => ({});
  svc._performHolderCheck = async () => ({ reason: 'stub', devReason: 'stub' });
  svc._performSameNameCheck = async () => ({ success: false, factors: svc.sameNameTokenService.getEmptyFactors('stub') });
  svc._checkCreatorIsNotBadDevWallet = async () => ({ creatorIsNotBadDevWallet: 1 });
  svc.walletLabelService.calculateLabelFactors = () => ({});
  svc.holderService.checkEarlyTradersRisk = async () => ({
    earlyTraderBlacklistCount: 0, earlyTraderWhitelistCount: 0,
    earlyTraderUniqueParticipants: 0, earlyTraderBlacklistRatio: 0, earlyTraderCanBuy: true,
  });
  let captured = null;
  svc._safeEvaluate = (_c, ctx) => { captured = ctx; return true; };
  svc._diagnoseCondition = () => ({ conditionList: [], summaryReason: '' });
  await svc.performAllChecks('0xtoken', null, 'exp1', 'sig1', 'bsc', { innerPair: '0xpair' }, '1 == 1', featOpts);
  ok(captured !== null, '4a. 生产 context 捕获成功（performAllChecks 真实链）');
  if (captured) {
    const known = svc._buildKnownFactorContext(featOpts);
    const keys = Object.keys(known);
    ok(keys.length >= 17, `4b. knownCtx 键数 ${keys.length}（≥17 引擎透传键）`);
    const missing = keys.filter(k => !(k in captured));
    ok(missing.length === 0, '4c. knownCtx 每键 ∈ 生产 context 键集（防漂移）', `missing=${missing}`);
    const diffs = keys.filter(k => JSON.stringify(known[k]) !== JSON.stringify(captured[k]));
    ok(diffs.length === 0, '4d. 同名键取值逐字相等（|| / ?? 语义对齐）',
      diffs.map(k => `${k}: known=${JSON.stringify(known[k])} ctx=${JSON.stringify(captured[k])}`).join('; '));
    // 键集真源对拍：knownCtx 键也应全部在 getConditionFactorKeys 内（另一防线）
    const legal = PreBuyCheckService.getConditionFactorKeys();
    const illegal = keys.filter(k => !legal.includes(k));
    ok(illegal.length === 0, '4e. knownCtx 键全部是合法条件因子（getConditionFactorKeys 真源）', `illegal=${illegal}`);
  }
}

// ═══ 5. 事故反证：perf3 宣告竞态形状 ═══
console.log('5. perf3 事故形状（rating=1 重复 fire + 翻正恢复）');
{
  const svc = mkSvc();
  let calls = 0;
  svc._performEarlyParticipantCheck = async () => { calls++; return {}; };
  svc._performHolderCheck = async () => ({ reason: 'stub', devReason: 'stub' });
  svc._performSameNameCheck = async () => ({ success: false, factors: svc.sameNameTokenService.getEmptyFactors('stub') });
  svc._checkCreatorIsNotBadDevWallet = async () => ({ creatorIsNotBadDevWallet: 1 });
  svc.walletLabelService.calculateLabelFactors = () => ({});
  svc.holderService.checkEarlyTradersRisk = async () => ({});
  const sentinel = { canBuy: 'FULL' };
  svc._evaluateWithCondition = () => sentinel;
  const ARGS = ['0xgang', null, 'exp1', null, 'bsc', { innerPair: '0xpair' }, COND_REAL];

  // 同 token 连续 5 次 fire rating=1（宣告竞态豁免窗内重复主体，perf3 top=86 次）
  let shortCircuited = 0;
  for (let i = 0; i < 5; i++) {
    const r = await svc.performAllChecks(...ARGS, { narrativeRating: 1, checkTime: 1000 + i });
    if (r.shortCircuited) shortCircuited++;
  }
  ok(shortCircuited === 5 && calls === 0,
    '5a. rating=1 连续 5 fire 全部短路、零子检查（重试窗保留：每 fire 仍评估当次值）',
    `sc=${shortCircuited} sub=${calls}`);
  // rating 翻正（宣告竞态重析 → 2）→ 短路自动解除恢复全链
  const r2 = await svc.performAllChecks(...ARGS, { narrativeRating: 2, narrativeCorpusLagSec: 100 });
  ok(r2 === sentinel && calls === 1,
    '5b. rating 翻正 → 短路解除走全链（豁免窗语义不变，透传值即门）', `calls=${calls}`);
  // 降回 1 再拦（时变值语义）
  const r3 = await svc.performAllChecks(...ARGS, { narrativeRating: 1 });
  ok(r3.shortCircuited === true, '5c. rating 回落 → 再拦（无粘滞状态）');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
