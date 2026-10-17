#!/usr/bin/env node
/** project 5.5K 地板卖腿——条件串本地校验（零 DB 零网络：FA 探针 + ConditionEvaluator） */
const path = require('path');
const FA = require(path.join(__dirname, '../src/services/FourMemeFactorAggregator'));
const { ConditionEvaluator } = require(path.join(__dirname, '../src/strategies/ConditionEvaluator'));

const NEW_LEG = "narrativeCategory == 'project' AND marketCap > 0 AND marketCap < 5500 AND realHoldDuration > 10";

const fa = new FA();
const keys = fa.getFactorKeys();
console.log('FA 键数:', keys.size);
for (const k of ['narrativeCategory', 'marketCap', 'realHoldDuration']) {
  console.log(`  ${k}: ${keys.has(k) ? 'OK' : 'MISSING!'}`);
}
const ev = new ConditionEvaluator();
const ast = ev.parseCondition(NEW_LEG);
console.log('parseCondition: OK (ast type=' + ast?.type + ')');
const verr = ev.validateCondition(ast, keys);
console.log('validateCondition:', verr === null || (verr.valid !== false && !verr.errors?.length) ? 'PASS' : `FAIL: ${JSON.stringify(verr)}`);
if (verr && verr.valid === false) process.exit(1);
// 真值表 spot check（evaluate 接 ast 还是串以类为准——试 evaluate(ast, factors)）
const evalWith = f => {
  try { return ev.evaluate(ast, f); } catch (e) {
    try { return ev.evaluate(NEW_LEG, f); } catch (e2) { return `eval-fn-shape: ${e.message} / ${e2.message}`; }
  }
};
const mk = (cat, mc) => ({ narrativeCategory: cat, marketCap: mc, realHoldDuration: 30 });
console.log('truth: project+5400 =', evalWith(mk('project', 5400)), '(want true)');
console.log('truth: project+5600 =', evalWith(mk('project', 5600)), '(want false)');
console.log('truth: null+5400    =', evalWith(mk(null, 5400)), '(want false)');
console.log('truth: event+5400   =', evalWith(mk('event:W', 5400)), '(want false)');
console.log('truth: project+0    =', evalWith(mk('project', 0)), '(want false 无价防线)');
console.log('truth: project+5400+rd=5 =', evalWith({ narrativeCategory: 'project', marketCap: 5400, realHoldDuration: 5 }), '(want false 缓冲门)');
