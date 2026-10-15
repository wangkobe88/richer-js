/**
 * GMGN 风险因子本地零 DB 单测（x-0 案，2026-09-27）
 *
 * 覆盖四层（C13 净流入/C16 簇因子同性质先例）：
 * 1. mapGmgnRiskFactors 映射语义（null 放行 / x-0 实测形状 / 分母 0 / 非数字）
 * 1b. extractGmgnRisk visiting_count 提取 + covered 语义防漂移（2026-10-15 加键）
 * 2. PreBuyCheckService.getEmptyFactorValues 四因子缺省 0（fail-open 放行值）
 * 3. ConditionEvaluator 条件表达式可用性（拦截门/放行门两个方向）
 * 4. FactorBuilder.buildPreBuyCheckFactorValues 透传（信号 metadata 落库路径）
 */
const { mapGmgnRiskFactors } = require('../src/trading-engine/pre-check/NarrativeDirectCaller');
const { PreBuyCheckService } = require('../src/trading-engine/pre-check/PreBuyCheckService');
const { ConditionEvaluator } = require('../src/strategies/ConditionEvaluator');
const { buildPreBuyCheckFactorValues } = require('../src/trading-engine/core/FactorBuilder');
const { extractGmgnRisk } = require('../src/core/gmgn-api/risk-fields');

const stubLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

console.log('== 1. mapGmgnRiskFactors ==');
// 猪五花案四观测键（2026-10-15 加键）缺省 0 形状
const OBS0 = { gmgnRenownedWallets: 0, gmgnSmartWallets: 0, gmgnWhaleWallets: 0, gmgnCreatorCreatedCount: 0 };
check('null（未触发/失败/未索引）→ 全 0 放行', mapGmgnRiskFactors(null), { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 0, gmgnVisitingCount: 0, ...OBS0 });
check('空对象（真实链路不可达：extractGmgnRisk 要么 null 要么有字段）→ covered 1',
  mapGmgnRiskFactors({}), { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1, gmgnVisitingCount: 0, ...OBS0 });
check('x-0 实测形状（16 币 / 35 bundler / 46 top / 2 人在线看）',
  mapGmgnRiskFactors({ issuerTokenCount: 16, bundlerWallets: 35, sniperWallets: 10, freshWallets: 43, topWallets: 46, visitingCount: 2 }),
  { gmgnIssuerTokenCount: 16, gmgnBundlerWalletRatio: 76.1, gmgnRiskCovered: 1, gmgnVisitingCount: 2, ...OBS0 });
check('topWallets=0（分母不可得）→ ratio 0 但 covered 1',
  mapGmgnRiskFactors({ issuerTokenCount: 3, bundlerWallets: 5, topWallets: 0 }),
  { gmgnIssuerTokenCount: 3, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1, gmgnVisitingCount: 0, ...OBS0 });
check('issuerTokenCount 非数字 → 0 但 covered 1',
  mapGmgnRiskFactors({ issuerTokenCount: null, bundlerWallets: 2, topWallets: 10 }),
  { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 20, gmgnRiskCovered: 1, gmgnVisitingCount: 0, ...OBS0 });
check('真项目（首币 / 无 bundler）',
  mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 0, sniperWallets: 1, freshWallets: 2, topWallets: 30 }),
  { gmgnIssuerTokenCount: 1, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1, gmgnVisitingCount: 0, ...OBS0 });
check('猪五花观测键透传（真人标签全零=机器盘指纹 / creator 11 币 serial issuer）',
  mapGmgnRiskFactors({ issuerTokenCount: 0, bundlerWallets: 3, topWallets: 20, renownedWallets: 0, smartWallets: 0, whaleWallets: 0, creatorCreatedCount: 11 }),
  { gmgnIssuerTokenCount: 0, gmgnBundlerWalletRatio: 15, gmgnRiskCovered: 1, gmgnVisitingCount: 0, gmgnRenownedWallets: 0, gmgnSmartWallets: 0, gmgnWhaleWallets: 0, gmgnCreatorCreatedCount: 11 });
check('KOL 豁免通道形状（renowned>=1 正信号）',
  mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 2, topWallets: 40, renownedWallets: 3, smartWallets: 5, whaleWallets: 1 }).gmgnRenownedWallets, 3);
check('历史快照行（无 visitingCount 字段，2026-10-15 前存量 gmgn_info）→ visiting 0=无观测',
  mapGmgnRiskFactors({ issuerTokenCount: 1, bundlerWallets: 2, topWallets: 10 }).gmgnVisitingCount, 0);

console.log('== 1b. extractGmgnRisk visiting_count 提取（2026-10-15 加键） ==');
const info = {
  dev: { twitter_create_token_count: 16, creator_address: '0xEOA', creator_token_status: 'creator_hold', fund_from: 'binance_hot' },
  wallet_tags_stat: { bundler_wallets: 35, sniper_wallets: 10, fresh_wallets: 43, top_wallets: 46 },
  image_dup_count: 3, visiting_count: 4,
};
const extracted = extractGmgnRisk(info);
check('visiting_count 4 → visitingCount: 4', extracted.visitingCount, 4);
check('死盘/秒新盘 visiting_count=0 → 0（有效观测非 null）', extractGmgnRisk({ ...info, visiting_count: 0 }).visitingCount, 0);
check('仅 visiting_count 有值（dev/tags 全缺）→ 仍 null（covered 语义防漂移：注意力不参与 hasAny）',
  extractGmgnRisk({ visiting_count: 5 }), null);

console.log('== 2. PreBuyCheckService.getEmptyFactorValues ==');
const pbs = new PreBuyCheckService({}, stubLogger, {});
const empty = pbs.getEmptyFactorValues();
check('四因子缺省 0（covered=0 放行）',
  { i: empty.gmgnIssuerTokenCount, r: empty.gmgnBundlerWalletRatio, c: empty.gmgnRiskCovered, v: empty.gmgnVisitingCount },
  { i: 0, r: 0, c: 0, v: 0 });

console.log('== 3. ConditionEvaluator 条件表达式 ==');
const ev = new ConditionEvaluator();
// 候选拦截门形状（阈值待 182 校准，此处只验证表达式可解析可求值）
const blockGate = '(gmgnIssuerTokenCount < 3 OR gmgnBundlerWalletRatio < 50) OR gmgnRiskCovered == 0';
check('x-0 形状 → 拦截门不满足（拦）',
  ev.evaluate(blockGate, { gmgnIssuerTokenCount: 16, gmgnBundlerWalletRatio: 76.1, gmgnRiskCovered: 1 }), false);
check('未查（covered=0）→ 放行', ev.evaluate(blockGate, mapGmgnRiskFactors(null)), true);
check('真项目（1 币 / 0%）→ 放行',
  ev.evaluate(blockGate, { gmgnIssuerTokenCount: 1, gmgnBundlerWalletRatio: 0, gmgnRiskCovered: 1 }), true);
check('注意力门（无人看 → 拦；有人看 → 放）',
  { zero: ev.evaluate('gmgnVisitingCount >= 1', { gmgnVisitingCount: 0 }), four: ev.evaluate('gmgnVisitingCount >= 1', { gmgnVisitingCount: 4 }) },
  { zero: false, four: true });

console.log('== 4. FactorBuilder.buildPreBuyCheckFactorValues 透传 ==');
const built = buildPreBuyCheckFactorValues({ gmgnIssuerTokenCount: 16, gmgnBundlerWalletRatio: 76.1, gmgnRiskCovered: 1, gmgnVisitingCount: 4 });
check('四因子透传', { i: built.gmgnIssuerTokenCount, r: built.gmgnBundlerWalletRatio, c: built.gmgnRiskCovered, v: built.gmgnVisitingCount }, { i: 16, r: 76.1, c: 1, v: 4 });
const builtEmpty = buildPreBuyCheckFactorValues({ gmgnIssuerTokenCount: null, gmgnBundlerWalletRatio: null, gmgnRiskCovered: null, gmgnVisitingCount: null });
check('null 输入 → 缺省 0（?? 0 语义）',
  { i: builtEmpty.gmgnIssuerTokenCount, r: builtEmpty.gmgnBundlerWalletRatio, c: builtEmpty.gmgnRiskCovered, v: builtEmpty.gmgnVisitingCount }, { i: 0, r: 0, c: 0, v: 0 });
const builtNothing = buildPreBuyCheckFactorValues({});
check('旧结果（无字段，存量回测路径）→ 缺省 0',
  { i: builtNothing.gmgnIssuerTokenCount, r: builtNothing.gmgnBundlerWalletRatio, c: builtNothing.gmgnRiskCovered, v: builtNothing.gmgnVisitingCount }, { i: 0, r: 0, c: 0, v: 0 });

console.log(`\n${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
