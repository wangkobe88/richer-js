#!/usr/bin/env node
/**
 * preBuyCheckCondition 诊断路径括号段评估修复——本地零 DB 单测
 *
 * Bug（c5945f36 实跑 2026-09-27 发现）：_diagnoseCondition 用 _parseCondition
 * 产出的原子段回传 ConditionEvaluator 评估，而 _parseCondition 已把 AND/OR
 * 转成 &&/||——ConditionEvaluator 只认字面量 AND/OR，括号段 `(A || B)` 必然
 * 「括号不匹配」→ _safeEvaluate catch 打 ERROR + return false（诊断恒示
 * ✗ 不满足）。主评估（line 839 原始条件）不受影响，仅显示层失真 + 日志噪声。
 *
 * 修复：诊断路径评估括号段前把 &&/|| 还原成 AND/OR。
 *
 * 覆盖：
 *   A. 修复主断言：带括号段条件诊断全程 logger.error 零调用（修复前每段 1 条）
 *   B. 复杂段 satisfied 真实值（rating 3→true / 1→false；簇段两方向）
 *   C. 裸原子段诊断不受影响（actualValue/satisfied 正常）
 *   D. 主评估与诊断段语义一致性（canBuy 两方向）
 *   E. 整体外括号形状（((A || B) AND C)——深度 0 分割出一整段）
 *
 * 用法：node scripts/_test_precheck_diagnose_condition.cjs
 */
'use strict';

const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

// error 计数型 stubLogger（修复前每次诊断 +2）
let errorCalls = [];
const stubLogger = {
  info: () => {}, warn: () => {}, debug: () => {},
  error: (...args) => errorCalls.push(args),
};

const svc = new PreBuyCheckService({}, stubLogger, {});

// c5945f36 实跑条件原样（两处括号段）
const COND = '(narrativeRating == 2 OR narrativeRating == 3) AND strictSameNameMaxFDV < 500000 '
  + 'AND earlyTradesNetBuyRatio >= 40 AND (earlyTradesUniformBuyWallets < 10 OR earlyTradesUniformBuyClusterRatio < 50)';

const ctxAllPass = {
  narrativeRating: 3, strictSameNameMaxFDV: 0, earlyTradesNetBuyRatio: 86,
  earlyTradesUniformBuyWallets: 5, earlyTradesUniformBuyClusterRatio: 20.6,
};
const ctxRatingFail = { ...ctxAllPass, narrativeRating: 1 };
const ctxClusterFail = { ...ctxAllPass, earlyTradesUniformBuyWallets: 12, earlyTradesUniformBuyClusterRatio: 83.3 };

// ═══ A. ERROR 零调用（修复主断言）═══
console.log('A. 诊断全程无 ERROR（修复前带括号段每诊断 2 条「括号不匹配」）');
errorCalls = [];
svc._diagnoseCondition(COND, ctxAllPass);
check('全过 context 诊断 0 条 ERROR', errorCalls.length, 0);
errorCalls = [];
svc._diagnoseCondition(COND, ctxRatingFail);
check('rating 不满足 context 诊断 0 条 ERROR', errorCalls.length, 0);
errorCalls = [];
svc._diagnoseCondition(COND, ctxClusterFail);
check('簇段不满足 context 诊断 0 条 ERROR', errorCalls.length, 0);

// ═══ B. 复杂段 satisfied 真实值 ═══
console.log('B. 复杂段 satisfied 真实评估（修复前恒 false）');
function complexEntries(cond, ctx) {
  return svc._diagnoseCondition(cond, ctx).conditionList.filter(c => c.isComplex);
}
let segs = complexEntries(COND, ctxAllPass);
check('全过 context 两复杂段均 true', segs.map(s => s.satisfied), [true, true]);
segs = complexEntries(COND, ctxRatingFail);
check('rating=1 → 第一段 false / 簇段仍 true', segs.map(s => s.satisfied), [false, true]);
segs = complexEntries(COND, ctxClusterFail);
check('wallets=12 ratio=83.3 → 簇段 false / rating 段仍 true', segs.map(s => s.satisfied), [true, false]);

// ═══ C. 裸原子段诊断不受影响 ═══
console.log('C. 裸原子段（无括号）诊断正常');
const bareEntries = svc._diagnoseCondition(COND, ctxAllPass).conditionList
  .filter(c => !c.isComplex && !c.isSubFactor);
check('三个裸段（FDV/净流入 + rating 段内），satisfied/actual 正常',
  bareEntries.map(c => [c.satisfied, c.actualValue]),
  [[true, 0], [true, 86]]); // rating/簇段无裸条目（全在括号内），FDV 与净流入两个裸段

// ═══ D. 主评估与诊断语义一致性 ═══
console.log('D. 主评估（原始条件）与诊断段聚合一致');
check('全过 → canBuy true', svc._safeEvaluate(COND, ctxAllPass), true);
check('rating=1 → canBuy false', svc._safeEvaluate(COND, ctxRatingFail), false);
check('簇段 fail → canBuy false', svc._safeEvaluate(COND, ctxClusterFail), false);

// ═══ E. 整体外括号形状 ═══
console.log('E. 整体外括号（深度 0 分割出一整段，走复杂段分支）');
const OUTER = '((narrativeRating == 2 OR narrativeRating == 3) AND earlyTradesNetBuyRatio >= 40)';
errorCalls = [];
segs = complexEntries(OUTER, ctxAllPass);
check('外括号整段诊断 0 ERROR', errorCalls.length, 0);
check('外括号整段 true（rating=3）', segs.length === 1 && segs[0].satisfied, true);
segs = complexEntries(OUTER, ctxRatingFail);
check('外括号整段 false（rating=1）', segs.length === 1 && segs[0].satisfied, false);

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exitCode = fail === 0 ? 0 : 1;
