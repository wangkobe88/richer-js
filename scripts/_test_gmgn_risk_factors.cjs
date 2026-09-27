/**
 * GMGN 风险因子本地零 DB 单测（x-0 案，2026-09-27）
 *
 * 覆盖四层（C13 净流入/C16 簇因子同性质先例）：
 * 1. mapGmgnRiskFactors 映射语义（null 放行 / x-0 实测形状 / 分母 0 / 非数字）
 * 2. PreBuyCheckService.getEmptyFactorValues 三因子缺省 0（fail-open 放行值）
 * 3. ConditionEvaluator 条件表达式可用性（拦截门/放行门两个方向）
 * 4. FactorBuilder.buildPreBuyCheckFactorValues 透传（信号 metadata 落库路径）
 */
const { mapGmgnRiskFactors } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { buildPreBuyCheckFactorValues } = require('../src/trading-engine/core/FactorBuilder');

const stubLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

console.log('== 1. mapGmgnRiskFactors ==');
check('null（未触发/失败/未索引）→ 全 0 放行', mapGmgnRiskFactors(null), { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 0 });
check('空对象（真实链路不可达：extractGmgnRisk 要么 null 要么有字段）→ covered 1',
  mapGmgnRiskFactors({}), { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1 });
check('x-0 实测形状（16 币 / 35 bundler / 46 top）',
  mapGmgnRiskFactors({ issuerTokenCount: 16, bundlerWallets: 35, sniperWallets: 10, freshWallets: 43, topWallets: 46 }),
  { gmgnIssuerTokenCount: 16, gmgnBundlerWalletRatio: 76.1, gmgnRiskCovered: 1 });
check('topWallets=0（分母不可得）→ ratio 0 但 covered 1',
  mapGmgnRiskFactors({ issuerTokenCount: 3, bundlerWallets: 5, topWallets: 0 }),
  { gmgnIssuerTokenCount: 3, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1 });
check('issuerTokenCount 非数字 → 0 但 covered 1',
  mapGmgnRiskFactors({ issuerTokenCount: null, bundlerWallets: 2, topWallets: 10 }),
  { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 20, gmgnRiskCovered: 1 });
check('真项目（首币 / 无 bundler）',
  mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 0, sniperWallets: 1, freshWallets: 2, topWallets: 30 }),
  { gmgnIssuerTokenCount: 1, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1 });

console.log('== 2. PreBuyCheckService.getEmptyFactorValues ==');
const pbs = new PreBuyCheckService({}, stubLogger, {});
const empty = pbs.getEmptyFactorValues();
check('三因子缺省 0（covered=0 放行）',
  { i: empty.gmgnIssuerTokenCount, r: empty.gmgnBundlerWalletRatio, c: empty.gmgnRiskCovered },
  { i: 0, r: 0, c: 0 });

console.log('== 3. ConditionEvaluator 条件表达式 ==');
const ev = new ConditionEvaluator();
// 候选拦截门形状（阈值待 182 校准，此处只验证表达式可解析可求值）
const blockGate = '(gmgnIssuerTokenCount < 3 OR gmgnBundlerWalletRatio < 50) OR gmgnRiskCovered == 0';
check('x-0 形状 → 拦截门不满足（拦）',
  ev.evaluate(blockGate, { gmgnIssuerTokenCount: 16, gmgnBundlerWalletRatio: 76.1, gmgnRiskCovered: 1 }), false);
check('未查（covered=0）→ 放行', ev.evaluate(blockGate, mapGmgnRiskFactors(null)), true);
check('真项目（1 币 / 0%）→ 放行',
  ev.evaluate(blockGate, { gmgnIssuerTokenCount: 1, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1 }), true);

console.log('== 4. FactorBuilder.buildPreBuyCheckFactorValues 透传 ==');
const built = buildPreBuyCheckFactorValues({ gmgnIssuerTokenCount: 16, gmgnBundlerWalletRatio: 76.1, gmgnRiskCovered: 1 });
check('三因子透传', { i: built.gmgnIssuerTokenCount, r: built.gmgnBundlerWalletRatio, c: built.gmgnRiskCovered }, { i: 16, r: 76.1, c: 1 });
const builtEmpty = buildPreBuyCheckFactorValues({ gmgnIssuerTokenCount: null, gmgnBundlerWalletRatio: null, gmgnRiskCovered: null });
check('null 输入 → 缺省 0（?? 0 语义）',
  { i: builtEmpty.gmgnIssuerTokenCount, r: builtEmpty.gmgnBundlerWalletRatio, c: builtEmpty.gmgnRiskCovered }, { i: 0, r: 0, c: 0 });
const builtNothing = buildPreBuyCheckFactorValues({});
check('旧结果（无字段，存量回测路径）→ 缺省 0',
  { i: builtNothing.gmgnIssuerTokenCount, r: builtNothing.gmgnBundlerWalletRatio, c: builtNothing.gmgnRiskCovered }, { i: 0, r: 0, c: 0 });

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
