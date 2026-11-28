#!/usr/bin/env node
/**
 * 门链因子应答器单测（Jev 退役·因子代，2026-11-25 用户裁定）——零 DB 零网络
 *
 * 覆盖：
 *   A. 版本常量与来源标记（CF1 / AF2 / BPF3；model='factor@<版本>'）
 *   B. AF 因子判定（精简代）：不判档不拒，分流照走 cheat 门（mid_full），不落
 *      reject_* / fail_open
 *   C. cheat 因子判定（精简代）：恒 healthy、全键 null（未评估≠none 不冒充）；
 *      **事故现场反证**——下游规则域未失效（给档位即产 cheat / 给路由锚即产
 *      N 通道），精简代只是不喂
 *   D. BP 因子答案（精简代 BPF3）：维度全缺席、不答 entry_shape（crash 形态复核 T243 起
 *      迁因子门 FP48 臂 crash_form——真值表与接线见 _test_crash_form_gate.cjs），塞单门照拦
 *   E. module-registry：v2 键解析到因子版本、三模块恰两代、混代包合法
 *   F. service 因子模式（T241 Phase 4 清理后=独立入口，无 Jev 竞速/粘滞接线）：cheat 门
 *      零 Jev 零拉数、无进程态（拉黑/粘滞/bootstrap/inflight/豁免/翻案全不进——
 *      首版「三点同构」的事故现场反证）、判定异常 fail-open；AF 门零 I/O；BP 门
 *      不加载 LLM、塞单门与 minTicks 预门保留、落行版本域独立、无 join/竞速
 *      （慢链不被 awaitMs 截断；Jev 代竞速仍在的存量锁）
 *   G. 引擎挂点集成（AbstractTradingEngine 三挂点 × 真 service 因子模式）+ 因子
 *      作弊挂点 per-signal 语义（判定拒不落任何 Jev 状态）+ 接线源码锁（两引擎按包键
 *      注入 factorMode、三挂点因子分支位置、实时引擎拉黑短路不进因子路径）+ metadata 形状
 *   H. 零依赖锁（factor-responders 无 JevClient / 网络 / DB）
 *
 * 用法：node scripts/_test_factor_responders.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FR = require(path.join(ROOT, 'src/market-analysis/factor-responders'));
const { CheatCheckService, actFrontRoute } = require(path.join(ROOT, 'src/market-analysis/CheatCheckService'));
const { BuyPointCheckService } = require(path.join(ROOT, 'src/market-analysis/BuyPointCheckService'));
const registry = require(path.join(ROOT, 'src/market-analysis/module-registry'));
const mapper = require(path.join(ROOT, 'src/market-analysis/cheat-result-mapper'));
const { gradeObservation, levelsFromObservation } = require(path.join(ROOT, 'src/market-analysis/cheat-grade'));
const bpMapper = require(path.join(ROOT, 'src/market-analysis/buy-point-result-mapper'));
const { AbstractTradingEngine } = require(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine'));
const FA = require(path.join(ROOT, 'src/services/FourMemeFactorAggregator'));

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
/** 剥注释后的源码（源码口径锁防注释里的示例串误计） */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// ── supabase 风格链式桩（from().select().eq().lte().order().limit() → {data,error}）──
function mkDb({ ticksDesc = [], events = [], insertOk = true } = {}) {
  const st = { inserts: [], tickQueries: 0, otherTables: [] };
  const mkChain = (table, data) => {
    const ops = [];
    const p = {
      select: () => p, eq: () => p, gt: () => p,
      lte: (...a) => { ops.push(a); return p; },
      order: () => p,
      limit: () => {
        let out = data;
        for (const [c, v] of ops) {
          if (c === 'block_time') out = out.filter((r) => new Date(r.block_time).getTime() <= new Date(v).getTime());
        }
        if (table === 'wss_price_ticks') st.tickQueries++;
        return Promise.resolve({ data: out, error: null });
      },
      then: (res, rej) => Promise.resolve({ data, error: null }).then(res, rej),
    };
    return p;
  };
  return {
    st,
    client: {
      from(table) {
        if (table !== 'wss_price_ticks') st.otherTables.push(table);
        if (table === 'buy_point_analyses' || table === 'cheat_detection') {
          return { insert: (rows) => { if (!insertOk) return Promise.resolve({ error: { message: 'stub insert fail' } }); st.inserts.push(...rows); return Promise.resolve({ error: null }); } };
        }
        return mkChain(table, table === 'wss_events' ? events : table === 'wss_price_ticks' ? ticksDesc : []);
      },
    },
  };
}

// ── 行工厂（BP 快照口径：链上真序递增）──
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const at = (dt) => new Date(T0 + dt * 1000).toISOString();
const w = (n) => '0x' + String(n).padStart(4, '0') + 'aa'.repeat(18);
const row = (i, side, bnb, o = {}) => ({
  block_time: at(i), block_number: o.block ?? 1000 + Math.floor(i / 2), log_index: o.li ?? i % 2,
  trade_type: side, trader_address: w(o.wallet ?? (i % 10)), sender_address: w(o.wallet ?? (i % 10)),
  bnb_amount: bnb, token_amount: 1e6, price_bnb: (1 + i * 0.01) * 1e-9, price_outlier: false,
  tx_hash: '0xtx' + (o.tx ?? i), quote_token: null,
});
/** 塞单形状：同块 9 钱包各买 0.1000（精确等额同块，≥8=BP77 塞单门） */
const stuffingTicks = Array.from({ length: 9 }, (_, i) => row(10 + i, 'buy', 0.1, { block: 2000, li: i, wallet: 100 + i, tx: 500 + i }));
/** 正常形状：10 笔金额各异（无同块等额簇） */
const normalTicks = Array.from({ length: 10 }, (_, i) => row(10 + i, i % 3 === 2 ? 'sell' : 'buy', 0.03 + i * 0.037, { wallet: 200 + i }));
const thinTicks = normalTicks.slice(0, 3); // < minTicks 6
const prow = (i, side, bnb, price, o = {}) => ({ ...row(i, side, bnb, o), price_bnb: price });
/** BPF2 crash 形态复核命中形状：0~12s 买单拉到 1.40e-8 → 14s 起只有卖单、价格逐笔走低到
 *  1.00e-8（锚=末笔卖：较窗高 −28.6%=提示臂①、5s 动量 −11.9%=未反弹、尾 10s 买 0 卖 8 笔） */
const crashFormTicks = [
  ...[0, 2, 4, 6, 8, 10, 12].map((i, k) => prow(i, 'buy', 0.1, (1.0 + k * 0.0667) * 1e-8, { wallet: 300 + k })),
  ...[[14, 1.30], [16, 1.26], [18, 1.22], [20, 1.18], [21, 1.135], [22, 1.11], [23, 1.085], [24, 1.055], [25, 1.03], [26, 1.00]]
    .map(([i, p], k) => prow(i, 'sell', 0.08, p * 1e-8, { wallet: 400 + k })),
];
/** 同上但尾 10s 出现一笔买（t=25）= 有换手 → 放行 */
const crashFormTurnoverTicks = crashFormTicks.filter((t) => !String(t.block_time).endsWith('25.000Z'))
  .concat([prow(25, 'buy', 0.05, 1.03e-8, { wallet: 500 })]).sort((a, b) => new Date(a.block_time) - new Date(b.block_time));
/** 同上但末三笔回升（1.06 → 1.10 → 1.125）= 有回调 → 放行 */
const crashFormReboundTicks = crashFormTicks.map((t) => {
  const m = String(t.block_time).slice(17, 19);
  if (m === '24') return { ...t, price_bnb: 1.06e-8 };
  if (m === '25') return { ...t, price_bnb: 1.10e-8 };
  if (m === '26') return { ...t, price_bnb: 1.125e-8 };
  return t;
});
const memPull = (ticksAsc) => async () => ({ rows: ticksAsc, anchorTickCount: ticksAsc.length, capped: false });
const META = { symbol: 'TST', name: 'Test', platform: 'flap', createdAtMs: T0, totalSupply: 1e9, creatorAddress: w(9) };

const neverLlm = async () => { throw new Error('因子代不应加载 Jev / LLM 模块'); };
/** 静默 logger（服务日志走 logger member call，不落 console） */
const SILENT = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

(async () => {

console.log('A. 版本常量与来源标记');
check('A1 三版本常量', [FR.CHEAT_FACTOR_VERSION, FR.ACT_FRONT_FACTOR_VERSION, FR.BUY_POINT_FACTOR_VERSION], ['CF1', 'AF3', 'BPF3']);
check('A2 model 标记', [FR.factorModel('CF1'), FR.factorModel(FR.ACT_FRONT_FACTOR_VERSION)], ['factor@CF1', 'factor@AF3']);

console.log('\nB. AF 因子判定（AF3 判档因子版——判序细节见 _test_act_judge）');
const { judgeActLevel } = require('../src/market-analysis/act-judge');
// 快照缺席 → act null fail-open（上游放行，不冒充）
const af = FR.judgeActFrontFactor(null);
check('B1 快照缺席 act/sbw/wash 全 null（无证据不冒充）', af, { act: null, sbw: null, wash: null, model: 'factor@AF3' });
check('B2 分流照走 cheat 门（act 缺席 = mid_full）', actFrontRoute(af.act, af.sbw === 'burst', af.wash, false, false), 'mid_full');
check('B3 不落任何拒买 / 故障路径', ['reject_low', 'reject_ultra', 'reject_wash', 'fail_open'].includes(actFrontRoute(af.act, false, af.wash)), false);
// 真快照判档：全窗稀疏四腿联立 → low；sbw 缺席 → reject_low
const mkDerived = (o) => ({ spanSec: 120, tickCount: 20, ticksPerMin: 9, idlePct: 30, maxGapSec: 45,
  buyMedianBnb: 0.02, throughputBnbPerMin: 0.5, maxDrawdownPct: 3, buyN: 12, sellN: 8,
  totalBuyBnb: 0.5, totalSellBnb: 0.2, ...o });
const sparseAf = FR.judgeActFrontFactor({ derived: mkDerived({}) });
check('B4 真快照判 low（全窗四腿联立稀疏）', [sparseAf.act, sparseAf.sbw, actFrontRoute(sparseAf.act, false, sparseAf.wash)], ['low', 'none', 'reject_low']);
const sparseAf2 = judgeActLevel(mkDerived({}), {});
check('B5 judgeActLevel 直接判 low', [sparseAf2.act, sparseAf2.arm], ['low', 'sparse_four_legs']);

console.log('\nC. cheat 因子判定（精简代）');
const cf = FR.judgeCheatFactor(null);
check('C1 恒 healthy 无拒因', { status: cf.status, grade: cf.grade, reasons: cf.reasons, model: cf.model },
  { status: 'analyzed', grade: 'healthy', reasons: [], model: 'factor@CF1' });
const allNull = (o) => Object.values(o).every((v) => v === null);
ok('C2 levels / buckets / anchors 全 null（未评估 ≠ none / 0）',
  allNull(cf.levels) && allNull(cf.buckets) && allNull(cf.anchors)
  && Object.keys(cf.levels).length === 10 && Object.keys(cf.anchors).length > 0,
  { lv: cf.levels, bk: cf.buckets });
check('C3 规则集差集透传（非 g23 规则集重评 → rawGrade/ruleset 留痕，Jev 链同形状）',
  FR.judgeCheatFactor(null, { ruleset: 'g23NoE' }),
  { status: cf.status, grade: cf.grade, reasons: cf.reasons, rawGrade: 'healthy', ruleset: 'g23NoE', levels: cf.levels, buckets: cf.buckets, anchors: cf.anchors, model: cf.model });
check('C4 未知规则集按 g23（不 throw）', FR.judgeCheatFactor(null, { ruleset: 'bogus' }), cf);
check('C5 unhealthyGrades 由 service 补（应答器不产该键）', 'unhealthyGrades' in cf, false);
// 事故现场反证：下游规则域没有因绕开 buildObservation 而失效——精简代只是不喂档位 / 锚
check('C6 反证：给档位即产 cheat（A 主判仍活）',
  gradeObservation(FR.buildFactorObservation({ equal_amount_split: 'strong' }, null), {}).reasons.map((r) => r.code),
  ['A_strong:equal_amount_split']);
check('C7 反证：给路由锚即产 N 通道（精简代不喂锚 → 不触发）',
  gradeObservation(FR.buildFactorObservation({}, { routerEntryBuyPct: 0 }), {}).reasons.map((r) => r.code),
  ['N_no_retail_entry0.0']);
check('C8 反证：给 low 档即产 E 通道（精简代不判档 → 不触发）',
  gradeObservation(FR.buildFactorObservation({ activity_level: 'low' }, null), {}).reasons.map((r) => r.code),
  ['E_low_activity']);
const fo = FR.buildFactorObservation({ activity_level: 'high', wash_pair: 'weak', bogus_key: 'strong' }, { routerEntryBuyPct: 5, noBuySellPct: 30 });
check('C9 观测记录题 id 域 = mapper 单源', [Object.keys(fo.phenomena), Object.keys(fo.extLevels)],
  [mapper.PHENOMENON_IDS, mapper.EXT_PHENOMENON_IDS]);
check('C10 activity_level → activityLevel（prob=null 无档位概率）', fo.activityLevel, { bucket: 'high', prob: null });
check('C11 未知题 id 忽略', 'bogus_key' in { ...fo.phenomena, ...fo.extLevels }, false);
check('C12 锚原值透传（投影白名单键挑出；routerEntryBuyPct 只供 N 通道读、不进投影——Jev 链同）',
  [levelsFromObservation(fo).anchors.routerEntryBuyPct, levelsFromObservation(fo).anchors.noBuySellPct,
    levelsFromObservation(FR.buildFactorObservation({}, null)).anchors.noBuySellPct],
  [null, 30, null]);
check('C13 cheatFactorLevels 精简代恒空', FR.cheatFactorLevels({ derived: { routerEntryBuyPct: 0 } }), {});

console.log('\nD. BP 因子答案（BPF3：不答任何维度题——crash 形态复核 T243 迁因子门 FP48）');
const bp = FR.answerBuyPointQuestions();
check('D1 无快照：answers 空、无 factor 留痕键', [bp.answers, bp.model, bp.usage, 'factor' in bp], [{}, 'factor@BPF3', null, false]);
const REF_DIMS = bpMapper.buildBuyPointObservation({}, {}).dimensions; // Jev 代 mapper 对空答案的产物=维度键集参照
const dims = bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 3 }).dimensions;
check('D2 维度键集与 Jev 代 mapper 同构、值全 null', [Object.keys(dims), Object.values(dims).every((v) => v === null)],
  [Object.keys(REF_DIMS), true]);
check('D2b 维度题逐题容缺（维度键含已退役 price_trend / price_level——形状兼容键，Jev 代同）', Object.keys(dims).sort(),
  ['entry_shape', 'holder_concentration', 'market_pattern', 'price_level', 'price_trend']);
check('D3 塞单门照拦（恰 8 钱包）', bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 8 }).assessment,
  { bucket: 'poor', prob: null, rule: 'stuffing_gate' });
check('D4 塞单门线下放行（7 钱包）', bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 7 }).assessment,
  { bucket: 'neutral', prob: null, rule: 'gates_passed' });
check('D5 塞单锚缺席容缺放行', bpMapper.buildBuyPointObservation(bp.answers, {}).assessment.rule, 'gates_passed');
// 事故现场反证（BPF2 时代：形态命中 → answers.entry_shape=crash → mapper entry_gate 拒）
{
  const formBd = { chg5Pct: -4.6, chg10Pct: -4.6, chg30Pct: 9.7, currentVsAthPct: -24.4, nearMaxDn5Pct: -25.5, curVsMinGapPct: 10.9,
    recentDip5Pct: -10.6, activity: { nearTail10BuyN: 0, nearTail10SellBnb: 0.11 } };
  const a = FR.answerBuyPointQuestions({ buyDerived: formBd });
  check('D6 反证：crash 形态命中形状经 BP 应答器 → 仍不答 entry_shape、mapper 放行（复核已迁因子门）',
    [a.answers, bpMapper.buildBuyPointObservation(a.answers, { exactEqualBlockMaxWallets: 0 }).assessment, 'factor' in a],
    [{}, { bucket: 'neutral', prob: null, rule: 'gates_passed' }, false]);
  ok('D6b 判据函数已迁出（单一真相源=factor-pre-buy-check；真值表见 _test_crash_form_gate.cjs）', !('judgeCrashForm' in FR));
}


const resolved = await registry.resolveModules({ factorCheck: 'v1', cheatCheck: 'v2', actFrontGate: 'v2', buyPointCheck: 'v2', pointType: 'v1' });
check('E1 因子代键解析到因子版本', [resolved.cheatCheck, resolved.actFrontGate, resolved.buyPointCheck], ['CF1', 'AF3', 'BPF3']);
const listed = registry.listModuleVersions();
check('E2 三模块恰两代（v1 Jev / v2 因子）', [listed.cheatCheck, listed.actFrontGate, listed.buyPointCheck],
  [['v1', 'v2'], ['v1', 'v2'], ['v1', 'v2']]);
check('E3 factorCheck / pointType 无因子代键', [listed.factorCheck, listed.pointType], [['v1'], ['v1']]);
check('E4 全注册表每模块 ≤2 代（规约锁）', Object.values(listed).every((v) => v.length <= 2), true);
check('E5 FACTOR_GENERATION_KEY / isFactorGeneration', [registry.FACTOR_GENERATION_KEY, registry.isFactorGeneration('v2'), registry.isFactorGeneration('v1'), registry.isFactorGeneration(undefined)],
  ['v2', true, false, false]);
const mixed = await registry.resolveModules({ cheatCheck: 'v1', actFrontGate: 'v2' });
check('E6 混代包合法（逐门消融对拍）', mixed, { cheatCheck: (await import(path.join(ROOT, 'src/market-analysis/llm/cheat-questions.mjs'))).CHEAT_QUESTIONS_VERSION, actFrontGate: 'AF3' });
let threw = '';
try { registry.assertModuleKey('cheatCheck', 'v3'); } catch (e) { threw = e.message; }
ok('E7 未知版本键仍 fail-fast', threw.includes('未知版本键'), threw);

console.log('\nE2. 因子代对拍包派生（deploy-factor-generation-pack 纯函数）');
{
  const { deriveFactorPack } = require(path.join(ROOT, 'scripts/deploy-factor-generation-pack.cjs'));
  const MODS1 = { factorCheck: 'v1', cheatCheck: 'v1', actFrontGate: 'v1', buyPointCheck: 'v1', pointType: 'v1' };
  const src = { buyLegs: [{ priority: 1, cards: 4 }], sellLegs: [{ priority: 1, cards: 'all' }], burstCooldown: {}, modules: { ...MODS1 } };
  const full = deriveFactorPack(src);
  check('E2-1 三门全换 v2，factorCheck / pointType 不动', full.definition.modules,
    { factorCheck: 'v1', cheatCheck: 'v2', actFrontGate: 'v2', buyPointCheck: 'v2', pointType: 'v1' });
  check('E2-2 腿 / 机制段深拷贝原样（不与源包共享引用）',
    [JSON.stringify(full.definition.buyLegs), JSON.stringify(full.definition.sellLegs), full.definition.burstCooldown,
      full.definition.buyLegs === src.buyLegs, full.definition.modules === src.modules],
    [JSON.stringify(src.buyLegs), JSON.stringify(src.sellLegs), {}, false, false]);
  check('E2-3 swapped / kept 清单', [full.swapped, full.kept], [['cheatCheck', 'actFrontGate', 'buyPointCheck'], []]);
  const part = deriveFactorPack(src, ['buyPointCheck']);
  check('E2-4 --only 单门消融（其余保留 Jev 代）', [part.definition.modules, part.swapped, part.kept],
    [{ ...MODS1, buyPointCheck: 'v2' }, ['buyPointCheck'], ['cheatCheck', 'actFrontGate']]);
  const two = deriveFactorPack(src, ['cheatCheck', 'buyPointCheck']);
  check('E2-5 --only 双门（保留 AF1 活跃度门）', [two.definition.modules.actFrontGate, two.definition.modules.cheatCheck, two.kept], ['v1', 'v2', ['actFrontGate']]);
  const noMod = deriveFactorPack({ buyLegs: [], sellLegs: [] });
  check('E2-6 源包无 modules → 不凭空加门', [noMod.definition.modules, noMod.swapped], [undefined, []]);
  const partial = deriveFactorPack({ buyLegs: [], sellLegs: [], modules: { factorCheck: 'v1', buyPointCheck: 'v1' } });
  check('E2-7 源包只开 BP → 只换 BP', [partial.definition.modules, partial.swapped], [{ factorCheck: 'v1', buyPointCheck: 'v2' }, ['buyPointCheck']]);
  check('E2-8 源定义不被改写', [src.modules, src.modules.cheatCheck], [MODS1, 'v1']);
  const err = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };
  check('E2-9 非法输入 fail-fast', [
    err(() => deriveFactorPack(null)).includes('非对象'),
    err(() => deriveFactorPack(src, ['factorCheck'])).includes('无因子代'),
    err(() => deriveFactorPack({ buyLegs: [], sellLegs: [], modules: { cheatCheck: 'v9' } })).includes('未知版本键'),
    err(() => deriveFactorPack({ buyLegs: [], sellLegs: [], modules: [] })).includes('形状非法'),
  ], [true, true, true, true]);
  // T241 主包切因子代（2026-11-26 用户裁定）后角色对调：Jev 基线臂改由 --to v1 派生
  const { TARGET_DEFAULT_NAMES, DEFAULT_NAME_JEV } = require(path.join(ROOT, 'scripts/deploy-factor-generation-pack.cjs'));
  const MODS2 = { factorCheck: 'v1', cheatCheck: 'v2', actFrontGate: 'v2', buyPointCheck: 'v2', pointType: 'v1' };
  const main = {
    buyLegs: [{ priority: 16, cards: 4, pointType: 'famous_holder_cold_pit' }],
    sellLegs: [{ priority: 1, cards: 'all' }], modules: { ...MODS2 },
  };
  const jev = deriveFactorPack(main, null, 'v1');
  check('E2-10 --to v1：因子代主包 → Jev 基线包（三门回 v1，腿含 pointType 绑定逐字一致）',
    [jev.definition.modules, jev.swapped, jev.kept, jev.already, JSON.stringify(jev.definition.buyLegs) === JSON.stringify(main.buyLegs)],
    [{ ...MODS1 }, ['cheatCheck', 'actFrontGate', 'buyPointCheck'], [], [], true]);
  const same = deriveFactorPack(main);
  check('E2-11 缺省方向（--to v2）对已是因子代的源包：零 swapped（main 据此拒入库——对拍退化成 A=B）',
    [same.swapped, same.already, same.kept], [[], ['cheatCheck', 'actFrontGate', 'buyPointCheck'], []]);
  const mixed = deriveFactorPack(main, ['buyPointCheck'], 'v1');
  check('E2-12 --only × --to v1 混代（逐门消融）',
    [mixed.definition.modules.buyPointCheck, mixed.definition.modules.cheatCheck, mixed.swapped, mixed.kept],
    ['v1', 'v2', ['buyPointCheck'], ['cheatCheck', 'actFrontGate']]);
  check('E2-13 非法目标代次 fail-fast / 缺省产物名按代次',
    [err(() => deriveFactorPack(main, null, 'v3')).includes('仅支持 v1'), TARGET_DEFAULT_NAMES, DEFAULT_NAME_JEV],
    [true, { v1: 'trading-standard-jev', v2: 'trading-standard-factor' }, 'trading-standard-jev']);
  check('E2-14 主包锁：三门已切因子代 v2，Jev 基线可一步派生', (() => {
    const { PACK_DEFINITION } = require(path.join(ROOT, 'scripts/deploy-trading-strategy.cjs'));
    const j = deriveFactorPack(PACK_DEFINITION, null, 'v1');
    return [PACK_DEFINITION.modules.cheatCheck, j.definition.modules.cheatCheck, j.definition.modules.actFrontGate,
      j.definition.modules.buyPointCheck, j.swapped.length];
  })(), ['v2', 'v1', 'v1', 'v1', 3]);
}

console.log('\nF. service 因子模式（T241 Phase 4 清理后：独立入口，无 Jev 竞速/粘滞接线）');
{
  // F1 cheat 门：零 Jev、零拉数、零 bootstrap、零落表；返回一次性结论（无进程态计数键）
  const db = mkDb({ ticksDesc: normalTicks });
  const svc = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000 });
  ok('F1 factorMode getter', svc.factorMode === true && svc.enabled === true);
  check('F1 版本域独立（CF1，不与 Jev 代 D3.x 串粘滞 / bootstrap）', [svc._version, new CheatCheckService({ enabled: true }, null, {})._version], ['CF1', null]);
  const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F1 gateBuyPoint → analyzed healthy + model； unhealthyGrades / strongbackerLike（Jev 粘滞观测键）不随服务返回',
    { s: r1.status, g: r1.grade, r: r1.reasons, m: r1.model, ug: r1.unhealthyGrades, sb: r1.strongbackerLike, c: r1.cached },
    { s: 'analyzed', g: 'healthy', r: [], m: 'factor@CF1', ug: undefined, sb: undefined, c: undefined });
  check('F1 零拉数零 bootstrap 零落表', [db.st.tickQueries, db.st.otherTables.length, db.st.inserts.length], [0, 0, 0]);
  check('F1 gateGraded 计数', svc.stats.gateGraded, 1);
  const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F1 每信号现评（二次调用再判一次，无 cached）', [r2.cached, svc.stats.factorJudged, svc.stats.stickyReused], [undefined, 2, 0]);
  const r3 = await svc.gateBuyPoint('0xtok', META, {}, { ruleset: 'g23NoE', awaitMs: 1, forceRecheck: true, recheckUnhealthy: false, anchorMs: 1 });
  check('F1 Jev 链 opts（规则集 / awaitMs 竞速上限 / forceRecheck / recheckUnhealthy / anchorMs）一概不消费',
    [r3.status, r3.grade, r3.rawGrade, svc.stats.forceRechecks, svc.stats.gateTimeouts], ['analyzed', 'healthy', undefined, 0, 0]);
  check('F1 alwaysRecheck（Jev 粘滞绕过旋钮）在因子路径不计数',
    await (async () => { const s = new CheatCheckService({ enabled: true, gate: { alwaysRecheck: true } }, SILENT, { dbClient: db.client, factorMode: true }); await s.gateBuyPoint('0xtok', {}, {}); return s.stats.alwaysRechecks; })(), 0);

  // F2 事故现场反证（2026-11-25 首版曾让因子分支登记拉黑→短路秒回）：因子判 cheat =
  // 本信号的一次性结论——不登记拉黑，下一信号照常现评（引擎挂点 per-signal 拒）
  const cheatMid = () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:equal_amount_split' }],
    levels: { equalAmountSplit: 3 }, buckets: { activityLevel: 'mid' }, anchors: {} });
  const s2 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, factorJudge: cheatMid, now: () => 1700000000000 });
  const c1 = await s2.gateBuyPoint('0xc1', {}, {});
  check('F2 因子判 cheat → 原判返回（无 blocked 秒回形状）', [c1.grade, c1.blocked, c1.exempt], ['cheat', undefined, undefined]);
  check('F2 不登记拉黑（service 拉黑态零写入）', [s2.isGateBlocked('0xc1'), s2._gateBlocked.size], [false, 0]);
  const c2 = await s2.gateBuyPoint('0xc1', {}, {});
  check('F2 下一信号照常现评（非短路：再判一次、原判 reasons 而非 gate_blocked）',
    [c2.blocked, c2.grade, c2.reasons[0].code, s2.stats.factorJudged, s2.stats.gateBlockedHits], [undefined, 'cheat', 'A_strong:equal_amount_split', 2, 0]);
  // F3 反证（首版曾做 Jev 式活跃度豁免出口变换）：因子判 cheat ∧ high 桶 → 不豁免
  const cheatHigh = () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:equal_amount_split' }],
    levels: {}, buckets: { activityLevel: 'high' }, anchors: {} });
  const s3 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, factorJudge: cheatHigh, now: () => 1700000000000 });
  const h1 = await s3.gateBuyPoint('0xh1', {}, {});
  check('F3 因子判 cheat ∧ high 桶 → 不做豁免变换（原判 cheat、无 exempt 键）', [h1.grade, h1.exempt, s3.stats.activityExemptions, s3.isGateBlocked('0xh1')], ['cheat', undefined, 0, false]);
  // F4 反证（首版曾做翻案解除）：forceRecheck 不消费——判定翻转就是下一信号的新结论，无 unblocked
  let flip = 'cheat';
  const s4 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, now: () => 1700000000000,
    factorJudge: () => (flip === 'cheat' ? cheatMid() : { status: 'analyzed', grade: 'healthy', reasons: [], levels: {}, buckets: {}, anchors: {} }) });
  await s4.gateBuyPoint('0xf1', {}, {});
  flip = 'healthy';
  const f2 = await s4.gateBuyPoint('0xf1', {}, {}, { forceRecheck: true });
  check('F4 判定翻转 = 下一信号现评（无 unblocked 翻案键、无拉黑可解）', [f2.grade, f2.unblocked, s4.isGateBlocked('0xf1'), s4.stats.unblocked, s4.stats.forceRechecks], ['healthy', undefined, false, 0, 0]);
  // F5 判定异常 = 检测层故障 fail-open
  const s5 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, now: () => 1700000000000,
    factorJudge: () => { throw new Error('boom'); } });
  const e1 = await s5.gateBuyPoint('0xe1', {}, {});
  check('F5 判定异常 fail-open（fail/factor_error，不抛）', [e1.status, e1.reason, s5.stats.factorErrors, e1.grade], ['fail', 'factor_error', 1, undefined]);
  // F6 unhealthy：原判返回；不拉黑；Jev 的 unhealthy 判定次数观测计数不写
  const s6 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, now: () => 1700000000000,
    factorJudge: () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'E_low_activity' }], levels: {}, buckets: { activityLevel: 'low' }, anchors: {} }) });
  const u1 = await s6.gateBuyPoint('0xu1', {}, {}), u2 = await s6.gateBuyPoint('0xu1', {}, {});
  check('F6 unhealthy 原判返回 ×2（无 unhealthyGrades 计数键）+ 不拉黑', [u1.grade, u1.unhealthyGrades, u2.grade, u2.unhealthyGrades, s6.isGateBlocked('0xu1'), s6._gateUnhealthyGrades.size], ['unhealthy', undefined, 'unhealthy', undefined, false, 0]);
  // F7 Jev 代不注入 factorMode 时开关为关（存量接线零变化）
  check('F7 缺省 factorMode=false', new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client }).factorMode, false);
  // F7b 进程态零写入总锁：上面 cheat/unhealthy/翻转/异常全部打过之后，Jev 状态机的每一张表都还是空的
  const stateOf = (s) => [s._lastGrade.size, s._bootstrapped.size, s._inflight.size, s._actFrontInflight.size, s._failUntil.size, s._gateBlocked.size, s._gateUnhealthyGrades.size, s._strongbackerLike.size];
  check('F7b 因子路径零进程态（粘滞 / bootstrap / inflight / 冷却 / 拉黑 / 观测计数全空）——s2/s3/s4/s5/s6 逐个',
    [s2, s3, s4, s5, s6].map(stateOf), Array.from({ length: 5 }, () => [0, 0, 0, 0, 0, 0, 0, 0]));
  check('F7b 竞速与 join 观测计数恒 0（gateTimeouts / inflightJoined / stickyReused / stickyBootstrapped）',
    [s2, s3, s4, s5, s6].map((s) => [s.stats.gateTimeouts, s.stats.inflightJoined, s.stats.stickyReused, s.stats.stickyBootstrapped]),
    Array.from({ length: 5 }, () => [0, 0, 0, 0]));
  check('F7b 全程零拉数零落表', [db.st.tickQueries, db.st.inserts.length, db.st.otherTables.length], [0, 0, 0]);

  // F8 AF 门（AF3 判档因子版）：拉数+判档（与 Jev 链同款原料路径；判定零 Jev）；
  // normalTicks=10 行 9s 窗（spanSec≤30 近段锚全 null → 全窗综合：66.7 笔/分 <70 → mid）
  const db8 = mkDb({ ticksDesc: normalTicks });
  const svc8 = new CheatCheckService({ enabled: true, settleDelayMs: 0 }, SILENT, { dbClient: db8.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000 });
  const a1 = await svc8.evaluateActFront('0xtok', META, {}, {});
  // normalTicks=10 行全在 9s 窗内（短窗=尾窗：尾 10s 密集买+前 20s 无行未断崖）
  // → 密集臂（短窗代理）→ high → high_skip（跳过 cheat，Jev 同款路由）
  check('F8 evaluateActFront → 拉数判档 assessed/high/high_skip/AF3', a1,
    { status: 'assessed', act: 'high', sbw: 'none', wash: null, path: 'high_skip', version: 'AF3', model: 'factor@AF3' });
  check('F8 拉数恰一次（零 Jev 零 LLM）', [db8.st.tickQueries, db8.st.otherTables.length], [1, 1]);
  check('F8 路径计数走 high_skip（不计 fail_open）', [svc8.stats.actFrontRouted.high_skip, svc8.stats.actFrontRouted.fail_open, svc8.stats.actFrontFactorJudged], [1, 0, 1]);
  check('F8 disabled 语义不变', await new CheatCheckService({}, null, { factorMode: true }).evaluateActFront('0xtok', {}, {}), { status: 'disabled' });
  check('F8 无 inflight join / 无竞速（因子链独立入口）', [svc8._actFrontInflight.size, svc8.stats.actFrontJoined, svc8.stats.actFrontTimeouts], [0, 0, 0]);
  // F8b 稀疏形状 → 判 low → reject_low（AF3 拦截本体）
  const sparseTicks = Array.from({ length: 8 }, (_, i) => row(100 + i * 25, i % 2 ? 'sell' : 'buy', 0.01, { wallet: 500 + i }));
  const db8b = mkDb({ ticksDesc: sparseTicks });
  const svc8b = new CheatCheckService({ enabled: true, settleDelayMs: 0 }, SILENT, { dbClient: db8b.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000 });
  const a1b = await svc8b.evaluateActFront('0xtok', META, {}, {});
  check('F8b 稀疏死寂形状 → low → reject_low', [a1b.status, a1b.act, a1b.path], ['assessed', 'low', 'reject_low']);
  // F9 AF 门：注入判定返回 low → 分流函数照常产 reject_low
  const s9 = new CheatCheckService({ enabled: true, settleDelayMs: 0 }, SILENT, { dbClient: db.client, factorMode: true,
    actFrontFactorJudge: () => ({ act: 'low', sbw: 'none', wash: 'none', model: 'factor@AF3' }) });
  check('F9 反证：因子判 low → reject_low', (await s9.evaluateActFront('0xtok', {}, {})).path, 'reject_low');

  // F10 BP 门因子模式：不加载 LLM；塞单门 / minTicks 预门保留；落行版本域独立
  //（deps.arbBotWallets 直注=ctor 不预热查库，零 DB）
  const mkBp = (ticks, config = {}, extraDeps = {}) => {
    const d = mkDb({});
    const svcBp = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, ...config }, SILENT,
      { dbClient: d.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000, pullTicks: memPull(ticks), arbBotWallets: new Set(), ...extraDeps });
    return { d, svcBp };
  };
  const n = mkBp(normalTicks);
  const n1 = await n.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-1' }, { awaitMs: 3000 });
  check('F10 正常形状 → assessed neutral/gates_passed + model', { s: n1.status, a: n1.assessment, m: n1.model, u: n1.usage, ft: 'factorTrace' in n1 },
    { s: 'assessed', a: { bucket: 'neutral', prob: null, rule: 'gates_passed' }, m: 'factor@BPF3', u: null, ft: false });
  check('F10 dimensions 键集与 mapper 同构、值全 null', [Object.keys(n1.dimensions), Object.values(n1.dimensions).every((v) => v === null)],
    [Object.keys(REF_DIMS), true]);
  check('F10 anchors 照常产出（研究原料不丢；无同块等额簇=0 有证据零值）', [n1.anchors.exactEqualBlockMaxWallets, n1.anchors.tokenAgeSec], [0, 19]);
  ok('F10 factorAnswered 计数', n.svcBp.stats.factorAnswered === 1 && n.svcBp.stats.errors === 0, n.svcBp.stats);
  const s = mkBp(stuffingTicks);
  const s1 = await s.svcBp.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F10 塞单形状 → poor/stuffing_gate（纯代码门照拦）', s1.assessment, { bucket: 'poor', prob: null, rule: 'stuffing_gate' });
  check('F10 塞单锚在场', s1.anchors.exactEqualBlockMaxWallets, 9);
  const t = mkBp(thinTicks);
  check('F10 minTicks 预门保留（BP10 数据不够就挡住）', await t.svcBp.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 }),
    { status: 'insufficient_ticks', anchorTickCount: 3 });
  // 落行：persist=true 下写 buy_point_analyses，版本域 BPF3，jev_prompt=null，model 标因子
  const p = mkBp(normalTicks, { persist: true });
  await p.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-9', experimentId: 'exp-1' }, {});
  const rowP = p.d.st.inserts[0];
  check('F10 落行版本域 BPF3 + 答案来源标因子 + 无 jev_prompt', rowP && { qv: rowP.question_version, model: rowP.answers_raw && rowP.answers_raw.model, jp: rowP.jev_prompt, sid: rowP.signal_id },
    { qv: 'BPF3', model: 'factor@BPF3', jp: null, sid: 'sig-9' });
  check('F10 _version 因子代独立', [p.svcBp._version, new BuyPointCheckService({ enabled: true }, SILENT, { arbBotWallets: new Set() })._version], ['BPF3', null]);
  check('F10 缺省 factorMode=false', new BuyPointCheckService({ enabled: true }, SILENT, { dbClient: mkDb({}).client, arbBotWallets: new Set() }).factorMode, false);
  const st = mkBp(stuffingTicks, { persist: true });
  await st.svcBp.gateBuyPoint('0xtok', META, {}, {});
  await st.svcBp.gateBuyPoint('0xtok', META, {}, {});
  check('F10 无粘滞：同票二连各判一次各落一行（BP 本无终态，Jev 代同语义）', [st.svcBp.stats.factorAnswered, st.d.st.inserts.length], [2, 2]);
  // F10b T241 Phase 4：因子路径无竞速——inflight join / awaitMs 竞速 / 超时 late 包不进入。
  // 事故现场反证：慢拉数（40ms）不被 awaitMs=1 截断——链跑完出 assessed，不产 timeout/late
  const slow = mkBp(normalTicks, {}, { pullTicks: async () => { await new Promise((r) => setTimeout(r, 40)); return memPull(normalTicks)(); } });
  const t0 = Date.now();
  const slowRes = await slow.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-slow' }, { awaitMs: 1 });
  check('F10b 慢链照跑到底（awaitMs=1 不截断）', [slowRes.status, slowRes.late, Date.now() - t0 >= 35, slow.svcBp.stats.gateTimeouts], ['assessed', undefined, true, 0]);
  check('F10b 无 inflight join（_inflight 恒空、inflightJoined=0）', [slow.svcBp._inflight.size, slow.svcBp.stats.inflightJoined], [0, 0]);
  // F10c Jev 代入口不动：同一 service 不开 factorMode 时仍是 join + 竞速（存量锁，防清理误伤 Jev 路径）
  {
    const j = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, gate: { awaitMs: 5 } }, SILENT,
      { dbClient: mkDb({}).client, loadLlm: async () => ({ JevClient: { ask: () => new Promise(() => {}) }, buildBuyPointQuestions: () => [], BUY_POINT_QUESTIONS_VERSION: 'BP-test' }),
        now: () => 1700000000000, pullTicks: memPull(normalTicks), arbBotWallets: new Set() });
    const jr = await j.gateBuyPoint('0xtok', META, {}, {});
    check('F10c Jev 代竞速仍在（慢 Jev → timeout + late）', [jr.status, !!jr.late, j._inflight.size >= 1], ['timeout', true, true]);
  }

  // F11 事故现场反证（T243：BPF2 时代下列形状死于 BP 门 poor/entry_gate）：BPF3 下 BP 链对
  // 形态命中 / 有换手 / 回升三种形状一律 neutral 放行——形态拦截在①因子门（_test_crash_form_gate E 段）
  for (const [nm, ticks] of [['形态命中', crashFormTicks], ['有换手', crashFormTurnoverTicks], ['有回调', crashFormReboundTicks]]) {
    const x = mkBp(ticks);
    const r = await x.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-cf' }, {});
    check(`F11 ${nm}形状经 BP 门（BPF3）= neutral 放行、无 factorTrace`, [r.status, r.assessment, 'factorTrace' in r, r.dimensions.entry_shape, r.model],
      ['assessed', { bucket: 'neutral', prob: null, rule: 'gates_passed' }, false, null, 'factor@BPF3']);
  }
}
console.log('\nG. 引擎挂点集成 + 接线源码锁');
{
  const mkEng = (ticks, { cheatSvc, signalGate = { maxTriggers: 1 } } = {}) => {
    const d = mkDb({});
    const cheat = cheatSvc || new CheatCheckService({ enabled: true, settleDelayMs: 0 }, SILENT, { dbClient: d.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000, pullTicks: memPull(ticks) });
    const bp = new BuyPointCheckService({ enabled: true, settleDelayMs: 0 }, SILENT,
      { dbClient: d.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000, pullTicks: memPull(ticks), arbBotWallets: new Set() });
    const metas = [], statuses = [];
    const eng = Object.create(AbstractTradingEngine.prototype);
    Object.assign(eng, {
      _experimentId: 'test-exp',
      logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
      _cheatGateAwaitMs: 15000, _bpGateAwaitMs: 15000, _cheatBlockedTokens: new Set(), _cheatProjectedTokens: new Set(),
      _cheatCheckService: cheat, _buyPointCheckService: bp, _actFrontGateEnabled: true,
      _updateSignalMetadata: async (id, data) => { metas.push({ id, data }); },
      _updateSignalStatus: async (id, status, meta) => { statuses.push({ id, status, reason: meta.reason }); },
    });
    return { eng, metas, statuses };
  };
  const TOKEN = { token: '0xtok', symbol: 'TST', name: 'Test', platform: 'flap', createdAt: 1700000000, creatorAddress: null, totalSupply: 1e9 };
  // G1 全链直通：AF2 → CF1 → BPF3
  FA.clearCheatFactors('0xtok');
  FA.clearCheatGatePriceAnchor('0xtok');
  const g = mkEng(normalTicks);
  const a = await g.eng._actFrontGateEvaluate('0xtok', TOKEN, {}, 'sig-1', { factorResults: {} });
  check('G1 AF 门挂点：拉数判档 high → pass / high_skip 跳 cheat（Jev 同款路由）', a, { pass: true, skipCheat: true, info: { status: 'assessed', act: 'high', sbw: 'none', wash: null, path: 'high_skip', version: 'AF3', model: 'factor@AF3' } });
  const c = await g.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-1', { maxTriggers: 1 }, { factorResults: { currentVsLaunchPct: 12 } });
  const judgedRef = FR.judgeCheatFactor(null);
  check('G1 cheat 门挂点：pass + info 同构（档位/锚原样透传）+ model 来源', { p: c.pass, i: c.info },
    { p: true, i: { status: 'analyzed', grade: 'healthy', cached: false, reasons: [], unhealthyGrades: 0, levels: judgedRef.levels, buckets: judgedRef.buckets, anchors: judgedRef.anchors,
      strongbackerLike: 0, exempt: null, unblocked: false, model: 'factor@CF1' } });
  // T241 Phase 4 清理：因子路径不做 Jev 的 FA cheat 键投影 / CD381 almost_launch 重锚——
  // 2026-11-25 首版此处曾断言「投影照常（grade healthy）」，现反证为恒不投影
  check('G1 因子路径不投影 FA cheat 键（56 键恒 null）、不重锚 almost_launch',
    [FA.getCheatFactors('0xtok') ?? null, FA.getCheatGatePriceAnchor('0xtok') ?? null, g.eng._cheatProjectedTokens.size], [null, null, 0]);
  check('G1 引擎拉黑 Set 不写', g.eng._cheatBlockedTokens.size, 0);
  const b = await g.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-1', { maxTriggers: 1 }, {});
  check('G1 BP 门挂点：pass + model 来源', [b.pass, b.info.status, b.info.model, b.info.assessment, b.info.dimensions.market_pattern], [true, 'assessed', 'factor@BPF3', { bucket: 'neutral', prob: null, rule: 'gates_passed' }, null]);
  check('G1 BP info 无判据留痕键（T243：crash 形态判据在①因子门，BP info 不再带 factorTrace）', 'factorTrace' in b.info, false);
  // cheatCheck 段由引擎买路径在挂点之后写（_evaluateBuyPath：cheatGate.info → metadata）——
  // 挂点自身只返回 info；此处锁 info 形状与 Jev 代同构键集
  check('G1 挂点自带的两段 metadata（actFrontGate / buyPoint；cheatCheck 段归引擎买路径写）', g.metas.map((m) => Object.keys(m.data)[0]), ['actFrontGate', 'buyPoint']);
  check('G1 cheat 门 info 键集与 Jev 代同构（多 model 一键）', Object.keys(c.info).sort(),
    ['anchors', 'buckets', 'cached', 'exempt', 'grade', 'levels', 'model', 'reasons', 'status', 'strongbackerLike', 'unblocked', 'unhealthyGrades']);
  check('G1 无 failed 状态', g.statuses, []);
  // G2 塞单形状：BP 门拒 → signal failed bp_gate_assessment
  const g2 = mkEng(stuffingTicks);
  await g2.eng._actFrontGateEvaluate('0xtok', TOKEN, {}, 'sig-2', {});
  await g2.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-2', { maxTriggers: 1 }, {});
  const b2 = await g2.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-2', { maxTriggers: 1 }, {});
  check('G2 塞单 → BP 门 fail-closed 拒', [b2.pass, b2.reason, g2.statuses], [false, 'BP 门拒买（assessed: poor）', [{ id: 'sig-2', status: 'failed', reason: 'bp_gate_assessment' }]]);
  FA.clearCheatFactors('0xtok');
  // G3 类型 policy 直通语义不变：stuffingOnly 路径（全豁类型）同样只评塞单门
  const g3 = mkEng(normalTicks);
  const b3 = await g3.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-3', { maxTriggers: 1 }, { pointTypePolicy: { buyPoint: 'stuffingOnly' } });
  check('G3 stuffingOnly policy → neutral / policy_stuffing_only', [b3.pass, b3.info.assessment.rule], [true, 'policy_stuffing_only']);
  const g3b = mkEng(stuffingTicks);
  const b3b = await g3b.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-3', { maxTriggers: 1 }, { pointTypePolicy: { buyPoint: 'stuffingOnly' } });
  check('G3b stuffingOnly policy × 塞单形状 → 拒（fail 返回不带 info，与 Jev 代同）', [b3b.pass, b3b.reason, b3b.info], [false, 'BP 门拒买（assessed: poor）', undefined]);
  // G3c 事故现场反证（T243：BPF2 时代该形状经引擎 BP 挂点 fail-closed 拒 bp_gate_assessment）：
  // BPF3 下 BP 挂点放行——形态拦截在①因子门（_factorGateEvaluate → factor_gate_crash_form）
  const g3c = mkEng(crashFormTicks);
  const b3c = await g3c.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-3c', { maxTriggers: 1 }, {});
  check('G3c crash 形态命中形状经 BP 挂点（BPF3）= 放行、无 failed、info 无判据键', [b3c.pass, g3c.statuses, 'factorTrace' in b3c.info], [true, [], false]);
  // G3d 全豁类型（stuffingOnly）不吃形态臂——两代同：类型票 BP 只评塞单门
  const g3d = mkEng(crashFormTicks);
  const b3d = await g3d.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-3d', { maxTriggers: 1 }, { pointTypePolicy: { buyPoint: 'stuffingOnly' } });
  check('G3d stuffingOnly policy × crash 形态 → 直通（类型票 BP 只评塞单门）', [b3d.pass, b3d.info.assessment.rule], [true, 'policy_stuffing_only']);
  const plain = g.eng._cheatGateInfo({ status: 'analyzed', grade: 'healthy', reasons: [] });
  check('G4 _cheatGateInfo：无 model 不带键（Jev 代 metadata 形状不变）', 'model' in plain, false);
  // G5 引擎接线源码锁：两引擎按包版本键注入 factorMode
  const live = read('src/trading-engine/implementations/FourMemeWssTradingEngine.js');
  const bt = read('src/trading-engine/implementations/BacktestEngine.js');
  const cnt = (src, re) => (stripComments(src).match(re) || []).length;
  check('G5 实时引擎：cheat / BP 两 service 各注入 factorMode（按包键）',
    [cnt(live, /factorMode:\s*_packFactor\('cheatCheck'\)/g), cnt(live, /factorMode:\s*_packFactor\('buyPointCheck'\)/g), /===\s*FACTOR_GENERATION_KEY/.test(stripComments(live))],
    [1, 1, true]);
  check('G5 回测引擎：同款注入',
    [cnt(bt, /factorMode:\s*_packFactor\('cheatCheck'\)/g), cnt(bt, /factorMode:\s*_packFactor\('buyPointCheck'\)/g), /===\s*FACTOR_GENERATION_KEY/.test(stripComments(bt))],
    [1, 1, true]);
  const abs = read('src/trading-engine/core/AbstractTradingEngine.js');
  // T253 起形状单一出口在 core/gate-layer.js cheatGateInfo（统一门层决策核同款）；引擎方法薄委托
  const glSrc = read('src/trading-engine/core/gate-layer.js');
  ok('G5 _cheatGateInfo model 键条件携带（单一出口=gate-layer.js cheatGateInfo；引擎 _cheatGateInfo 薄委托）',
    stripComments(glSrc).includes('...(res.model ? { model: res.model } : {})')
    && /_cheatGateInfo\(res\) \{\s*return GL\.cheatGateInfo\(res\);\s*\}/.test(stripComments(abs)));
  // G6 service 源码锁：因子入口先于 Jev 状态机、方法体零 Jev 件
  const svcSrc = stripComments(read('src/market-analysis/CheatCheckService.js'));
  const fcStart = svcSrc.indexOf('async _factorGate(');
  const factorGate = svcSrc.slice(fcStart, svcSrc.indexOf('async _ensureLlm() {', fcStart));
  ok('G6 _factorGate 方法体定位非空', factorGate.length > 200 && factorGate.length < 2500, factorGate.length);
  ok('G6 _factorGate 零 Jev 件（LLM / state / Jev / 拉数 / bootstrap / 落表 / 粘滞 / 拉黑 / 豁免 / 翻案 / 竞速）',
    !/_ensureLlm|buildCheatState|_runJev|_pullTicks|_bootstrapHistory|_writeRow|_gateBlocked|_lastGrade|_inflight|_applyActivityExempt|_maybeUnblock|Promise\.race|awaitMs|forceRecheck|ruleset/.test(factorGate),
    factorGate.slice(0, 200));
  const gateBody = svcSrc.slice(svcSrc.indexOf('async gateBuyPoint('), svcSrc.indexOf('async evaluateActFront('));
  ok('G6 gateBuyPoint 因子入口先于整段 Jev 状态机（规则集键 / 拉黑秒回 / forceRecheck / 粘滞 / inflight / 竞速）',
    gateBody.includes('if (this._factorMode) return this._factorGate();')
    && gateBody.indexOf('if (this._factorMode) return this._factorGate();') < gateBody.indexOf('const ruleset = CHEAT_RULESET_IDS.includes(opts.ruleset)')
    && gateBody.indexOf('if (this._factorMode) return this._factorGate();') < gateBody.indexOf('const lg = this._lastGrade.get(skey);')
    && gateBody.indexOf('if (this._factorMode) return this._factorGate();') < gateBody.indexOf('Promise.race(['),
    '');
  ok('G6 gateBuyPoint 体内 _factorMode 判定恰一处（无散落的因子分支残留）', (gateBody.match(/this\._factorMode/g) || []).length, 1);
  const bpSrc = stripComments(read('src/market-analysis/BuyPointCheckService.js'));
  const bpGate = bpSrc.slice(bpSrc.indexOf('async gateBuyPoint('), bpSrc.indexOf('async _chain('));
  ok('G6 BP gateBuyPoint 因子入口先于 inflight join / awaitMs 竞速 / 超时 late 包',
    bpGate.includes('if (this._factorMode) {')
    && bpGate.indexOf('if (this._factorMode) {') < bpGate.indexOf('this._inflight.get(token)')
    && bpGate.indexOf('if (this._factorMode) {') < bpGate.indexOf('Promise.race([')
    && bpGate.includes('return result;'), '');
  ok('G6 BP 链内因子分支：LLM 加载与 state 构建均受 factorMode 守卫',
    bpSrc.includes('if (!this._factorMode) {') && bpSrc.includes('this._factorMode ? null : buildBuyPointState(snapshot).state')
    && bpSrc.includes('? { ok: true, result: answerBuyPointQuestions(snapshot) }'), '');

  // G7 引擎因子作弊挂点：per-signal 语义——判定拒 = 本信号拒；Jev 状态机（拉黑 / 清仓 /
  // 重锚 / 投影 / 重检条件求值）一件不做（T241 Phase 4 清理的行为锁）
  const mkEngCheat = (judge) => {
    const d = mkDb({});
    const cheat = new CheatCheckService({ enabled: true }, SILENT, { dbClient: d.client, factorMode: true, factorJudge: judge });
    return mkEng(normalTicks, { cheatSvc: cheat });
  };
  {
    const g7 = mkEngCheat(() => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:equal_amount_split' }], levels: {}, buckets: {}, anchors: {}, model: 'factor@CF1' }));
    const exits = [];
    g7.eng._cheatExitPosition = async (...a) => { exits.push(a); };
    // 腿带 Jev 翻案条件且 fire 因子表为真——因子路径不求值、不重锚、不拉黑、不清仓
    const r7 = await g7.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-7', { maxTriggers: 1, recheckCondition: "preCheatResult == 'unhealthy'" },
      { factorResults: { currentVsLaunchPct: 8, preCheatResult: 'unhealthy' } });
    check('G7 因子判 cheat → 本信号拒（cheat_gate_cheat）+ metadata cheatCheck 段',
      [r7.pass, r7.reason, g7.statuses, Object.keys(g7.metas[0].data)[0], g7.metas[0].data.cheatCheck.grade, g7.metas[0].data.cheatCheck.model],
      [false, '作弊门拒买（cheat [A_strong:equal_amount_split]）', [{ id: 'sig-7', status: 'failed', reason: 'cheat_gate_cheat' }], 'cheatCheck', 'cheat', 'factor@CF1']);
    check('G7 Jev 状态机零触碰：不拉黑（引擎 Set / service）/ 不清仓 / 不投影 FA cheat 键 / 不重锚 almost_launch',
      [g7.eng._cheatBlockedTokens.size, g7.eng._cheatCheckService.isGateBlocked('0xtok'), exits.length,
        FA.getCheatFactors('0xtok'), FA.getCheatGatePriceAnchor('0xtok'), g7.eng._cheatProjectedTokens.size], [0, false, 0, null, null, 0]);
    // 下一信号：判定翻转（注入桩改判 healthy）→ 照常放行（无拉黑可短路、无 unblocked 翻案键）
    const g7b = mkEngCheat(() => ({ status: 'analyzed', grade: 'healthy', reasons: [], levels: {}, buckets: {}, anchors: {}, model: 'factor@CF1' }));
    const r7b = await g7b.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-7b', { maxTriggers: 1 }, { factorResults: {} });
    check('G7b healthy → 放行（无翻案键；上一张的拒不延续）', [r7b.pass, r7b.info.unblocked, r7b.info.grade], [true, false, 'healthy']);
    const g7c = mkEngCheat(() => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'E_low_activity' }], levels: {}, buckets: {}, anchors: {}, model: 'factor@CF1' }));
    const r7c = await g7c.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-7c', { maxTriggers: 1 }, { factorResults: {} });
    check('G7c 因子判 unhealthy → 本信号拒（cheat_gate_unhealthy），同样不拉黑', [r7c.pass, g7c.statuses[0].reason, g7c.eng._cheatBlockedTokens.size], [false, 'cheat_gate_unhealthy', 0]);
    const g7d = mkEngCheat(() => { throw new Error('boom'); });
    const r7d = await g7d.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-7d', { maxTriggers: 1 }, { factorResults: {} });
    check('G7d 判定异常（无 grade）→ fail-open 放行进 BP（info=fail/factor_error，不标 failed）', [r7d.pass, r7d.info, g7d.statuses], [true, { status: 'fail', reason: 'factor_error' }, []]);
    const g7e = mkEng(normalTicks);
    g7e.eng._cheatCheckService.gateBuyPoint = async () => { throw new Error('wired'); };
    const r7e = await g7e.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-7e', { maxTriggers: 1 }, { factorResults: {} });
    check('G7e 接线级异常 → fail-open 放行（info=error）', [r7e.pass, r7e.info.status, r7e.info.reason], [true, 'error', 'wired']);
    const g7f = mkEng(normalTicks);
    const r7f = await g7f.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-7f', { maxTriggers: 1 }, { pointTypePolicy: { cheatCheck: 'skip' }, factorResults: {} });
    check('G7f 类型 policy 直通（cheatCheck:skip）仍在因子挂点之前生效', [r7f.pass, r7f.info], [true, { status: 'policy_pass', policy: 'cheatCheck:skip', levels: { stallBurstWave: null } }]);
    // BP / AF 因子路径不传 awaitMs（引擎挂点调用参数锁：以桩捕获 opts）；
    // AF3 判档因子版拉数需要 token meta 与 anchorMs——只不传 Jev 竞速上限 awaitMs
    const g7g = mkEng(normalTicks);
    const bpOpts = []; g7g.eng._buyPointCheckService.gateBuyPoint = async (t, m, c, o) => { bpOpts.push(o); return { status: 'insufficient_ticks', anchorTickCount: 0 }; };
    const afOpts = []; g7g.eng._cheatCheckService.evaluateActFront = async (t, m, c, o) => { afOpts.push([m, o]); return { status: 'assessed', act: 'mid', sbw: 'none', wash: null, path: 'mid_full', version: 'AF3', model: 'factor@AF3' }; };
    await g7g.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-7g', { maxTriggers: 1 }, { anchorMs: 1700000010000 });
    await g7g.eng._actFrontGateEvaluate('0xtok', TOKEN, {}, 'sig-7g', { anchorMs: 1700000010000 });
    check('G7g BP 因子路径：只传锚（anchorMs），不传 Jev 竞速上限 awaitMs', [bpOpts, Object.keys(bpOpts[0] || {})], [[{ anchorMs: 1700000010000 }], ['anchorMs']]);
    check('G7g AF 因子路径：token meta 与 anchorMs 照传（拉数判档原料），awaitMs 不传', [Object.keys(afOpts[0][1]), afOpts[0][1], 'awaitMs' in afOpts[0][1]],
      [['anchorMs'], { anchorMs: 1700000010000 }, false]);
  }
  // G8 引擎源码锁：三挂点的因子分支位置与独立挂点零 Jev 状态机
  {
    const code = stripComments(abs);
    const bin = code.slice(code.indexOf('async _cheatGateEvaluateBinary('), code.indexOf('async _bpGateEvaluate('));
    const dispatch = "if (this._cheatCheckService.factorMode === true) {";
    ok('G8 _cheatGateEvaluateBinary：因子分派先于 CD381 重判条件求值 / Jev meta / gateBuyPoint 调用',
      bin.includes(dispatch) && bin.includes('return this._cheatGateFactorEvaluate(tokenAddress, token, signalId);')
      && bin.indexOf(dispatch) < bin.indexOf('signalGate.recheckCondition')
      && bin.indexOf(dispatch) < bin.indexOf('this._cheatCheckService.gateBuyPoint('), '');
    ok('G8 分派先于两道前置检查之后（类型 policy 直通 / service 缺席 warn 仍共用）',
      bin.indexOf("ctx.pointTypePolicy.cheatCheck === 'skip'") < bin.indexOf(dispatch)
      && bin.indexOf("reason: 'service_disabled'") < bin.indexOf(dispatch), '');
    const hook = code.slice(code.indexOf('async _cheatGateFactorEvaluate('), code.indexOf('async _cheatGateEvaluateBinary('));
    ok('G8 _cheatGateFactorEvaluate 零 Jev 状态机（无重锚 / 投影 / 拉黑 / 清仓 / 迟到消费 / awaitMs / forceRecheck / recheckCondition / anchorMs / ruleset）',
      hook.length > 300 && hook.length < 4000
      && !/markCheatGateEvaluated|_projectCheatFactors|_cheatBlockedTokens|_cheatGateHardReject|_cheatGateLateConsume|_cheatExitPosition|awaitMs|forceRecheck|recheckCondition|recheckUnhealthy|anchorMs|ruleset|\.late\b/.test(hook),
      hook.slice(0, 200));
    ok('G8 _cheatGateEvaluateBinary 后半段 Jev 状态机原样保留（回滚 / 对拍基线）',
      /markCheatGateEvaluated\(tokenAddress, _vsLaunchAtFire\)/.test(bin) && /_cheatGateHardReject\(tokenAddress, token, signalId, reasonCodes/.test(bin)
      && /_cheatGateLateConsume\(tokenAddress, late, _vsLaunchAtFire\)/.test(bin) && /res\.unblocked === true/.test(bin)
      && /forceRecheck: true/.test(bin), '');
    ok('G8 _bpGateEvaluate：awaitMs 只在非因子路径传',
      code.includes("...(this._buyPointCheckService.factorMode === true ? {} : { awaitMs: this._bpGateAwaitMs })"), '');
    ok('G8 _actFrontGateEvaluate：AF3 因子路径照传 token meta 与 anchorMs、awaitMs 仅 Jev 代传',
      code.includes("...(!_factorAf ? { awaitMs: this._cheatGateAwaitMs } : {})"), '');
    const liveCode = stripComments(live);
    ok('G8 实时引擎信号链入口：拉黑双源短路整段不进因子路径',
      /this\._cheatCheckService\.factorMode !== true\s*&&\s*\(this\._cheatBlockedTokens\.has\(tokenAddress\) \|\| this\._cheatCheckService\.isGateBlocked\(tokenAddress\)\)/.test(liveCode), '');
    ok('G8 实时引擎门链汇总行：因子代不按 Jev 口径打 awaitMs / recheck',
      /_cheatFactor \? '因子代·无竞速\/粘滞'/.test(liveCode) && /_bpFactor \? '因子代·无竞速'/.test(liveCode), '');
  }
}

console.log('\nH. 零依赖锁');
{
  const src = read('src/market-analysis/factor-responders.js');
  const code = stripComments(src);
  ok('H1 无 JevClient / 网络调用', !/JevClient|fetch\(|https?:|import\(/.test(code), '');
  ok('H2 无 DB / 服务层依赖', !/dbManager|supabase|\.\.\/services|from\('/.test(code), '');
  ok('H3 仅依赖 mapper / grade 两个纯函数模块', (code.match(/require\('\.\/[^']+'\)/g) || []).sort(),
    JSON.stringify(["require('./cheat-grade')", "require('./cheat-result-mapper')"]) && true);
}

console.log(`\n因子应答器单测：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 异常: ${e?.stack || e}`); process.exit(1); });
