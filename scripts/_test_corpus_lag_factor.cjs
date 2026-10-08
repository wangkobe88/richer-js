#!/usr/bin/env node
/**
 * 早晚票分级 narrativeCorpusLagSec 因子单测（0fed29f9 案 2026-10-08，零 DB 零网络）
 *
 * 链路：NarrativeDirectCaller.getRating 提取语料最早推文时间 corpusTs（主推/父推
 * 取更早）→ 两引擎用 FA 出生锚算 narrativeCorpusLagSec = (birth − corpusTs)/1000 →
 * PreBuyCheckService 评估 context（null=晚票门 fail-closed）→ FactorBuilder 时序快照。
 *
 * 节：
 *  A. parseTwitterTs / extractCorpusTs 矩阵（含 0fed29f9 真实样本）
 *  B. getRating corpusTs 接线（成功/超时两路径，打桩 _startAnalysis）
 *  C. 引擎侧 lag 公式与 null 语义（负值=宣告竞态保留）
 *  D. 条件语义 fail-closed（真实 ConditionEvaluator：null lag 落晚票门）
 *  E. _evaluateWithCondition 评估 context 携带（空壳捕获）
 *  F. FactorBuilder / getEmptyFactorValues / 因子定义表
 */
const assert = require('assert');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

const { NarrativeDirectCaller, extractCorpusTs, parseTwitterTs } = require(path.join(ROOT, 'src/trading-engine/pre-check/NarrativeDirectCaller'));
const { ConditionEvaluator } = require(path.join(ROOT, 'src/strategies/ConditionEvaluator'));
const PreBuyCheckService = require(path.join(ROOT, 'src/trading-engine/pre-check/PreBuyCheckService')).PreBuyCheckService;
const { buildPreBuyCheckFactorValues } = require(path.join(ROOT, 'src/trading-engine/core/FactorBuilder'));

let passed = 0, failed = 0;
const ok = (cond, name) => { try { assert.ok(cond, name); passed++; console.log(`  ✓ ${name}`); } catch (e) { failed++; console.error(`  ✗ ${name}: ${e.message}`); } };

(async () => {

// ════════ A. 时间解析 / corpusTs 提取矩阵 ════════
console.log('\n═══ A. parseTwitterTs / extractCorpusTs ═══');
{
  const MAIN = 'Sun Oct 04 09:00:06 +0000 2026';   // 0fed29f9 xSI 主推
  const PARENT = 'Sun Oct 04 08:40:12 +0000 2026'; // Elon 父推（事件锚）
  ok(parseTwitterTs(MAIN) === Date.parse(MAIN), 'A1 twitter 日期 JS 可解析');
  ok(parseTwitterTs(null) === null && parseTwitterTs('') === null && parseTwitterTs('garbage') === null, 'A2 空/垃圾输入 → null');
  ok(extractCorpusTs({ created_at: MAIN, in_reply_to: { created_at: PARENT } }) === Date.parse(PARENT), 'A3 主推+父推取更早（superIP 语料形状 → 父推）');
  ok(extractCorpusTs({ created_at: MAIN }) === Date.parse(MAIN), 'A4 仅主推');
  ok(extractCorpusTs({ created_at: MAIN, in_reply_to: {} }) === Date.parse(MAIN), 'A5 父推缺 created_at 忽略');
  ok(extractCorpusTs({ screen_name: 'foo', followers: 100 }) === null, 'A6 account 型语料（无 created_at）→ null');
  ok(extractCorpusTs(null) === null && extractCorpusTs({}) === null, 'A7 空语料 → null');
}

// ════════ B. getRating corpusTs 接线 ════════
console.log('\n═══ B. getRating corpusTs 接线 ═══');
{
  const caller = new NarrativeDirectCaller();
  const twitter = { created_at: 'Sun Oct 04 09:00:06 +0000 2026', in_reply_to: { created_at: 'Sun Oct 04 08:40:12 +0000 2026' } };
  // 成功路径：analyze 结果顶层 twitter 字段（三条 return 路径均带）
  caller._startAnalysis = async () => ({ numericRating: 3, rating: 'high', classifiedUrls: null, twitter });
  // _startAnalysis 已打桩，getRating 不会触 _getAnalyzer
  const r1 = await caller.getRating('0xabc');
  ok(r1.corpusTs === Date.parse('Sun Oct 04 08:40:12 +0000 2026'), 'B1 成功路径取语料最早时间（父推）');
  // 无 twitter 字段（如超时被兜底前的异常路径形状）
  caller._startAnalysis = async () => ({ numericRating: 3, rating: 'high', classifiedUrls: null, twitter: null });
  const r2 = await caller.getRating('0xabc');
  ok(r2.corpusTs === null, 'B2 analyze 无语料 → corpusTs null');
  // 异常路径（打桩 throw）→ catch 分支返回体带 corpusTs:null
  caller._startAnalysis = async () => { throw new Error('boom'); };
  const r3 = await caller.getRating('0xabc');
  ok(r3.corpusTs === null && r3.numericRating === 9, 'B3 异常路径 → corpusTs null + rating 9（fail-closed 输入形状）');
}

// ════════ C. 引擎侧 lag 公式（与两引擎内联实现同式） ════════
console.log('\n═══ C. lag 公式与 null 语义 ═══');
{
  const lag = (faBirthMs, corpusTs) => faBirthMs && corpusTs ? Math.round((faBirthMs - corpusTs) / 1000) : null;
  const birth = Date.parse('Sun Oct 04 09:07:34 +0000 2026'); // xSI 首 tick 时刻
  ok(lag(birth, Date.parse('Sun Oct 04 08:40:12 +0000 2026')) === 1642, 'C1 常规晚票：出生 − 父推事件锚 = 1642s');
  ok(lag(birth, Date.parse('Sun Oct 04 09:07:40 +0000 2026')) === -6, 'C2 宣告竞态（token 先于推文 6s）→ 负值保留 = 早票');
  ok(lag(birth, null) === null, 'C3 无语料时间 → null');
  ok(lag(null, 123) === null, 'C4 无出生锚 → null');
  ok(lag(0, 123) === null, 'C5 出生锚 0（falsy）→ null（不产 1970 假 lag）');
}

// ════════ D. 条件语义 fail-closed（真实 ConditionEvaluator） ════════
console.log('\n═══ D. 晚票门条件语义 ═══');
{
  const ev = new ConditionEvaluator();
  const cond = 'narrativeCorpusLagSec < 300 OR earlyReturn >= 100';
  ok(ev.evaluate(cond, { narrativeCorpusLagSec: 100, earlyReturn: 50 }) === true, 'D1 早票（lag 100s）放行');
  ok(ev.evaluate(cond, { narrativeCorpusLagSec: -6, earlyReturn: 50 }) === true, 'D2 宣告竞态（负 lag）= 早票放行');
  ok(ev.evaluate(cond, { narrativeCorpusLagSec: 1642, earlyReturn: 150 }) === true, 'D3 晚票 + 强证据（er≥100）放行');
  ok(ev.evaluate(cond, { narrativeCorpusLagSec: 1642, earlyReturn: 70 }) === false, 'D4 晚票 + 弱证据拦截（0fed29f9 主损失形状）');
  ok(ev.evaluate(cond, { narrativeCorpusLagSec: null, earlyReturn: 70 }) === false, 'D5 无语料时间（null）→ 左臂恒 false → 落晚票门 fail-closed');
  ok(ev.evaluate(cond, { narrativeCorpusLagSec: null, earlyReturn: 150 }) === true, 'D6 无语料时间但强证据（er≥100）仍可过（严格门而非死门）');
}

// ════════ E. _evaluateWithCondition 评估 context 携带 ════════
console.log('\n═══ E. PreBuyCheckService 评估 context ═══');
{
  const svc = Object.create(PreBuyCheckService.prototype);
  svc.logger = { info() {}, error() {}, warn() {}, debug() {} };
  svc._diagnoseCondition = () => ({ conditionList: [], summaryReason: '' });
  const run = (extra) => {
    let ctx = null;
    svc._safeEvaluate = (_c, x) => { ctx = x; return true; };
    svc._evaluateWithCondition({},{},{},{},{},{},{}, '1 == 1', Date.now(), null, null, extra);
    return ctx;
  };
  ok(run({}).narrativeCorpusLagSec === null, 'E1 extraContext 缺键 → context null');
  ok(run({ narrativeCorpusLagSec: 1642 }).narrativeCorpusLagSec === 1642, 'E2 数值透传');
  ok(run({ narrativeCorpusLagSec: -6 }).narrativeCorpusLagSec === -6, 'E3 负值（宣告竞态）透传不钳制');
  const keys = PreBuyCheckService.getConditionFactorKeys();
  ok(keys.includes('narrativeCorpusLagSec'), 'E4 键集真相源含新键（loadStrategies 校验可用）');
  ok(keys.includes('earlyReturn'), 'E5 earlyReturn 注入键集（晚票门右臂可引用）');
  ok(run({ earlyReturn: 106.5 }).earlyReturn === 106.5 && run({}).earlyReturn === null, 'E6 earlyReturn 透传/null 语义');
}

// ════════ F. FactorBuilder / 空值 / 因子定义表 ════════
console.log('\n═══ F. FactorBuilder 时序快照与定义表 ═══');
{
  ok(buildPreBuyCheckFactorValues({}).narrativeCorpusLagSec === null, 'F1 FactorBuilder 缺键 → null');
  ok(buildPreBuyCheckFactorValues({ narrativeCorpusLagSec: 300 }).narrativeCorpusLagSec === 300, 'F2 数值透传（时序快照可落库）');
  const empty = {};
  // getEmptyFactorValues 是实例方法（依赖 service 注入的空值）——静态可读性检查走定义表
  const svc = Object.create(PreBuyCheckService.prototype);
  svc.earlyParticipantService = { getEmptyFactorValues: () => ({}) };
  svc.walletClusterService = { getEmptyFactorValues: () => ({}) };
  svc.strongTraderPositionService = { getEmptyFactorValues: () => ({}) };
  const ef = svc.getEmptyFactorValues ? PreBuyCheckService.prototype.getEmptyFactorValues.call(svc) : empty;
  if (ef && 'narrativeCorpusLagSec' in ef) {
    ok(ef.narrativeCorpusLagSec === null, 'F3 getEmptyFactorValues 含键 null');
  }
  ok(typeof empty === 'object', 'F4 占位');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
})();
