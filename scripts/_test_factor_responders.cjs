#!/usr/bin/env node
/**
 * 门链因子应答器单测（Jev 退役·因子代，2026-11-25 用户裁定）——零 DB 零网络
 *
 * 覆盖：
 *   A. 版本常量与来源标记（CF1 / AF2 / BPF2；model='factor@<版本>'）
 *   B. AF 因子判定（精简代）：不判档不拒，分流照走 cheat 门（mid_full），不落
 *      reject_* / fail_open
 *   C. cheat 因子判定（精简代）：恒 healthy、全键 null（未评估≠none 不冒充）；
 *      **事故现场反证**——下游规则域未失效（给档位即产 cheat / 给路由锚即产
 *      N 通道），精简代只是不喂
 *   D. BP 因子答案（精简代）：维度全缺席，塞单门（纯代码）照拦
 *   E. module-registry：v2 键解析到因子版本、三模块恰两代、混代包合法
 *   F. service 因子模式：cheat 门零 Jev 零拉数不粘滞、拉黑/豁免/翻案三点同构、
 *      判定异常 fail-open；AF 门零 I/O；BP 门不加载 LLM、塞单门与 minTicks
 *      预门保留、落行版本域独立
 *   G. 引擎挂点集成（AbstractTradingEngine 三挂点 × 真 service 因子模式）+
 *      引擎接线源码锁（两引擎按包键注入 factorMode）+ metadata 形状
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
check('A1 三版本常量', [FR.CHEAT_FACTOR_VERSION, FR.ACT_FRONT_FACTOR_VERSION, FR.BUY_POINT_FACTOR_VERSION], ['CF1', 'AF2', 'BPF2']);
check('A2 model 标记', [FR.factorModel('CF1'), FR.factorModel(FR.ACT_FRONT_FACTOR_VERSION)], ['factor@CF1', 'factor@AF2']);

console.log('\nB. AF 因子判定（精简代）');
const af = FR.judgeActFrontFactor();
check('B1 act / sbw / wash 全 null（未评估不冒充）', af, { act: null, sbw: null, wash: null, model: 'factor@AF2' });
check('B2 分流照走 cheat 门（act 缺席 = mid_full）', actFrontRoute(af.act, af.sbw === 'burst', af.wash, false, false), 'mid_full');
check('B3 不落任何拒买 / 故障路径', ['reject_low', 'reject_ultra', 'reject_wash', 'fail_open'].includes(actFrontRoute(af.act, false, af.wash)), false);

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

console.log('\nD. BP 因子答案（BPF2：crash 形态复核因子臂 + 其余维度缺席）');
const bp = FR.answerBuyPointQuestions();
check('D1 无快照：维度全缺席 + 判据留痕（no_snapshot）', [bp.answers, bp.model, bp.usage, bp.factor.crashForm.hit, bp.factor.crashForm.branch],
  [{}, 'factor@BPF2', null, false, 'no_snapshot']);
const REF_DIMS = bpMapper.buildBuyPointObservation({}, {}).dimensions; // Jev 代 mapper 对空答案的产物=维度键集参照
const dims = bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 3 }).dimensions;
check('D2 维度键集与 Jev 代 mapper 同构、未命中时值全 null', [Object.keys(dims), Object.values(dims).every((v) => v === null)],
  [Object.keys(REF_DIMS), true]);
check('D2b 维度题逐题容缺（维度键含已退役 price_trend / price_level——形状兼容键，Jev 代同）', Object.keys(dims).sort(),
  ['entry_shape', 'holder_concentration', 'market_pattern', 'price_level', 'price_trend']);
check('D3 塞单门照拦（恰 8 钱包）', bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 8 }).assessment,
  { bucket: 'poor', prob: null, rule: 'stuffing_gate' });
check('D4 塞单门线下放行（7 钱包）', bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 7 }).assessment,
  { bucket: 'neutral', prob: null, rule: 'gates_passed' });
check('D5 塞单锚缺席容缺放行', bpMapper.buildBuyPointObservation(bp.answers, {}).assessment.rule, 'gates_passed');

console.log('\nD6. crash 形态复核 judgeCrashForm（BPF2）——真值表 / 边界 / 研究集反例');
{
  // 基底 = 研究集命中形状：提示臂①深跌 ∧ 仍在线性下行 ∧ 尾 10s 买归零卖未停 ∧ 锚在场
  const base = (o = {}) => ({
    chg5Pct: -4.6, chg10Pct: -4.6, chg30Pct: 9.7, currentVsAthPct: -24.4, nearMaxDn5Pct: -25.5, curVsMinGapPct: 10.9,
    recentDip5Pct: -10.6, activity: { nearTail10BuyN: 0, nearTail10SellBnb: 0.11 }, ...o,
  });
  const act = (o) => base({ activity: { nearTail10BuyN: 0, nearTail10SellBnb: 0.11, ...o } });
  const hit = (bd) => FR.judgeCrashForm(bd).hit;
  const br = (bd) => FR.judgeCrashForm(bd).branch;
  check('D6-1 全条件成立 → hit / crash_form', [hit(base()), br(base())], [true, 'crash_form']);
  check('D6-2 提示臂四选一各自单独成立', [
    hit(base({ currentVsAthPct: -25.01, chg30Pct: 9.7, nearMaxDn5Pct: -5, curVsMinGapPct: 30 })),
    hit(base({ currentVsAthPct: -8, chg30Pct: -25.01, nearMaxDn5Pct: -5, curVsMinGapPct: 30 })),
    hit(base({ currentVsAthPct: -8, chg30Pct: 9.7, nearMaxDn5Pct: -15.01, curVsMinGapPct: 30 })),
    hit(base({ currentVsAthPct: -8, chg30Pct: 9.7, nearMaxDn5Pct: -5, curVsMinGapPct: 2 })),
  ], [true, true, true, true]);
  check('D6-3 提示臂四臂全不中 → no_hint（火星酱形状：仅缓跌、离低点 5 个点）',
    [hit(base({ currentVsAthPct: -7.6, chg30Pct: -7.6, nearMaxDn5Pct: -12, curVsMinGapPct: 5 })), br(base({ currentVsAthPct: -7.6, chg30Pct: -7.6, nearMaxDn5Pct: -12, curVsMinGapPct: 5 }))],
    [false, 'no_hint']);
  check('D6-4 提示臂边界：恰在线上不中（≤ 严格含线：-25 / -25 / -15 / 2 恰值命中，线外 0.01 不中）', [
    hit(base({ chg30Pct: -25, currentVsAthPct: -24.99, nearMaxDn5Pct: -14.99, curVsMinGapPct: 2.01 })),
    hit(base({ chg30Pct: -24.99, currentVsAthPct: -24.99, nearMaxDn5Pct: -14.99, curVsMinGapPct: 2.01 })),
    hit(base({ currentVsAthPct: -25, chg30Pct: -24.99, nearMaxDn5Pct: -14.99, curVsMinGapPct: 2.01 })),
    hit(base({ nearMaxDn5Pct: -15, currentVsAthPct: -24.99, chg30Pct: -24.99, curVsMinGapPct: 2.01 })),
    hit(base({ curVsMinGapPct: 2, currentVsAthPct: -24.99, chg30Pct: -24.99, nearMaxDn5Pct: -14.99 })),
  ], [true, false, true, true, true]);
  check('D6-5 提示臂键缺席容缺：其余臂仍可命中；四键全 null → no_hint', [
    hit(base({ currentVsAthPct: null, chg30Pct: null, curVsMinGapPct: null })),
    br(base({ currentVsAthPct: null, chg30Pct: null, nearMaxDn5Pct: null, curVsMinGapPct: null })),
  ], [true, 'no_hint']);
  check('D6-6 有回调 → 放行（chg5 恰 -1.5 仍命中；-1.49 起判反弹）', [
    hit(base({ chg5Pct: -1.5 })), br(base({ chg5Pct: -1.49 })), br(base({ chg5Pct: 0 })), br(base({ chg5Pct: 6.4 })),
  ], [true, 'rebounding', 'rebounding', 'rebounding']);
  check('D6-7 有换手 → 放行（尾 10s 买 1 笔即算买方在场，哪怕是尘埃单）', [hit(act({ nearTail10BuyN: 1 })), br(act({ nearTail10BuyN: 3 }))],
    [false, 'turnover_present']);
  check('D6-8 卖单已停 → 放行（买归零卖也归零 = 量能枯竭平静，非单边下跌）', [hit(act({ nearTail10SellBnb: 0 })), br(act({ nearTail10SellBnb: 0 }))],
    [false, 'no_sell']);
  check('D6-9 锚缺席不判（题面反锚①「判缺不猜」）——四个关键锚任一 null 即 anchors_missing', [
    br(base({ recentDip5Pct: null })), br(base({ chg5Pct: null })), br(act({ nearTail10BuyN: null })), br(act({ nearTail10SellBnb: null })), br(null),
  ], ['anchors_missing', 'anchors_missing', 'anchors_missing', 'anchors_missing', 'no_snapshot']);
  // 研究集（BP69 时代 380 个 Jev 标签信号重放，2026-11-26）反例锚：锚缺失面含金狗 쿠우타（+55%）
  check('D6-10 研究集反例：金狗 쿠우塔形状（尾 10 买 0、仍跌，但 recentDip5 缺席）→ 不判', hit(base({ chg5Pct: -4, recentDip5Pct: null, nearMaxDn5Pct: null })), false);
  check('D6-11 线值常量导出（改线必同步本断言）', [
    FR.CRASHFORM_VS_ATH_MAX, FR.CRASHFORM_CHG30_MAX, FR.CRASHFORM_NEAR_DN5_MAX, FR.CRASHFORM_MIN_GAP_MAX, FR.CRASHFORM_CHG5_MAX, FR.CRASHFORM_TAIL_BUY_N_MAX,
  ], [-25, -25, -15, 2, -1.5, 0]);
  // 门链接力：命中 → entry_shape=crash → mapper entry_gate 拒；塞单门仍在其前
  const aHit = FR.answerBuyPointQuestions({ buyDerived: base() });
  const oHit = bpMapper.buildBuyPointObservation(aHit.answers, { exactEqualBlockMaxWallets: 0 });
  check('D6-12 命中 → answers.entry_shape=crash(1) → mapper poor/entry_gate', [aHit.answers, aHit.model, oHit.assessment, oHit.dimensions.entry_shape, aHit.factor.crashForm.branch],
    [{ entry_shape: { type: 'choice', choice: 'crash', probabilities: { crash: 1 } } }, 'factor@BPF2', { bucket: 'poor', prob: 1, rule: 'entry_gate' }, { bucket: 'crash', prob: 1 }, 'crash_form']);
  check('D6-13 塞单门先于形态门（两者同中 → rule=stuffing_gate）',
    bpMapper.buildBuyPointObservation(aHit.answers, { exactEqualBlockMaxWallets: 9 }).assessment, { bucket: 'poor', prob: null, rule: 'stuffing_gate' });
  const aMiss = FR.answerBuyPointQuestions({ buyDerived: act({ nearTail10BuyN: 2 }) });
  check('D6-14 未命中 → answers 空、留痕带放行分支', [aMiss.answers, aMiss.factor.crashForm.branch, Object.keys(aMiss.factor)], [{}, 'turnover_present', ['crashForm']]);
  check('D6-15 判据数值随 trace 透出（信号页展示用）', FR.judgeCrashForm(base()).trace,
    { chg5Pct: -4.6, chg30Pct: 9.7, currentVsAthPct: -24.4, nearMaxDn5Pct: -25.5, curVsMinGapPct: 10.9, recentDip5Pct: -10.6, nearTail10BuyN: 0, nearTail10SellBnb: 0.11 });
}

console.log('\nE. module-registry');
const resolved = await registry.resolveModules({ factorCheck: 'v1', cheatCheck: 'v2', actFrontGate: 'v2', buyPointCheck: 'v2', pointType: 'v1' });
check('E1 因子代键解析到因子版本', [resolved.cheatCheck, resolved.actFrontGate, resolved.buyPointCheck], ['CF1', 'AF2', 'BPF2']);
const listed = registry.listModuleVersions();
check('E2 三模块恰两代（v1 Jev / v2 因子）', [listed.cheatCheck, listed.actFrontGate, listed.buyPointCheck],
  [['v1', 'v2'], ['v1', 'v2'], ['v1', 'v2']]);
check('E3 factorCheck / pointType 无因子代键', [listed.factorCheck, listed.pointType], [['v1'], ['v1']]);
check('E4 全注册表每模块 ≤2 代（规约锁）', Object.values(listed).every((v) => v.length <= 2), true);
check('E5 FACTOR_GENERATION_KEY / isFactorGeneration', [registry.FACTOR_GENERATION_KEY, registry.isFactorGeneration('v2'), registry.isFactorGeneration('v1'), registry.isFactorGeneration(undefined)],
  ['v2', true, false, false]);
const mixed = await registry.resolveModules({ cheatCheck: 'v1', actFrontGate: 'v2' });
check('E6 混代包合法（逐门消融对拍）', mixed, { cheatCheck: (await import(path.join(ROOT, 'src/market-analysis/llm/cheat-questions.mjs'))).CHEAT_QUESTIONS_VERSION, actFrontGate: 'AF2' });
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
}

console.log('\nF. service 因子模式');
{
  // F1 cheat 门：零 Jev、零拉数、零 bootstrap、零落表
  const db = mkDb({ ticksDesc: normalTicks });
  const svc = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000 });
  ok('F1 factorMode getter', svc.factorMode === true && svc.enabled === true);
  check('F1 版本域独立（CF1，不与 Jev 代 D3.x 串粘滞 / bootstrap）', [svc._version, new CheatCheckService({ enabled: true }, null, {})._version], ['CF1', null]);
  const r1 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F1 gateBuyPoint → analyzed healthy + model', { s: r1.status, g: r1.grade, r: r1.reasons, m: r1.model, ug: r1.unhealthyGrades, sb: r1.strongbackerLike },
    { s: 'analyzed', g: 'healthy', r: [], m: 'factor@CF1', ug: 0, sb: 0 });
  check('F1 零拉数零 bootstrap 零落表', [db.st.tickQueries, db.st.otherTables.length, db.st.inserts.length], [0, 0, 0]);
  check('F1 gateGraded 计数', svc.stats.gateGraded, 1);
  const r2 = await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F1 每信号现评（不粘滞：二次调用无 cached、再判一次）', [r2.cached, svc.stats.factorJudged, svc.stats.stickyReused], [undefined, 2, 0]);
  check('F1 规则集差集透传', (await svc.gateBuyPoint('0xtok', META, {}, { ruleset: 'g23NoE' })).grade, 'healthy');
  check('F1 awaitMs 竞速不参与（awaitMs=1 仍即时返回）', (await svc.gateBuyPoint('0xtok', META, {}, { awaitMs: 1 })).status, 'analyzed');
  // F2 拉黑三点同构：因子判定产 cheat → 登记 → 短路秒回（后续因子臂接入后即生效）
  const cheatMid = () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:equal_amount_split' }],
    levels: { equalAmountSplit: 3 }, buckets: { activityLevel: 'mid' }, anchors: {} });
  const s2 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, factorJudge: cheatMid, now: () => 1700000000000 });
  const c1 = await s2.gateBuyPoint('0xc1', {}, {});
  check('F2 因子判 cheat（mid 桶）→ 原判返回 + 登记拉黑', [c1.grade, c1.exempt, s2.isGateBlocked('0xc1')], ['cheat', undefined, true]);
  const c2 = await s2.gateBuyPoint('0xc1', {}, {});
  check('F2 拉黑后短路秒回（零再判）', [c2.blocked, c2.grade, c2.reasons, s2.stats.factorJudged], [true, 'cheat', [{ level: 'cheat', code: 'gate_blocked' }], 1]);
  // F3 豁免出口变换同构：因子判 cheat ∧ activity 桶 high → 不登记拉黑 + 出口翻 healthy
  const cheatHigh = () => ({ status: 'analyzed', grade: 'cheat', reasons: [{ level: 'cheat', code: 'A_strong:equal_amount_split' }],
    levels: {}, buckets: { activityLevel: 'high' }, anchors: {} });
  const s3 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, factorJudge: cheatHigh, now: () => 1700000000000 });
  const h1 = await s3.gateBuyPoint('0xh1', {}, {});
  check('F3 因子判 cheat ∧ high 桶 → 出口豁免翻 healthy', { g: h1.grade, e: h1.exempt }, { g: 'healthy', e: { code: 'activity_high', originalGrade: 'cheat' } });
  check('F3 豁免票不登记拉黑', s3.isGateBlocked('0xh1'), false);
  // F4 翻案同构：已拉黑票 forceRecheck → 因子重检非 cheat → 解除拉黑
  let flip = 'cheat';
  const s4 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, now: () => 1700000000000,
    factorJudge: () => (flip === 'cheat' ? cheatMid() : { status: 'analyzed', grade: 'healthy', reasons: [], levels: {}, buckets: {}, anchors: {} }) });
  await s4.gateBuyPoint('0xf1', {}, {});
  flip = 'healthy';
  const f2 = await s4.gateBuyPoint('0xf1', {}, {}, { forceRecheck: true });
  check('F4 forceRecheck 重检翻正 → 解除拉黑', [f2.grade, f2.unblocked, s4.isGateBlocked('0xf1')], ['healthy', true, false]);
  // F5 判定异常 = 检测层故障 fail-open
  const s5 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, now: () => 1700000000000,
    factorJudge: () => { throw new Error('boom'); } });
  const e1 = await s5.gateBuyPoint('0xe1', {}, {});
  check('F5 判定异常 fail-open（fail/factor_error，不抛）', [e1.status, e1.reason, s5.stats.factorErrors], ['fail', 'factor_error', 1]);
  // F6 unhealthy 观测计数同构
  const s6 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true, now: () => 1700000000000,
    factorJudge: () => ({ status: 'analyzed', grade: 'unhealthy', reasons: [{ level: 'unhealthy', code: 'E_low_activity' }], levels: {}, buckets: { activityLevel: 'low' }, anchors: {} }) });
  const u1 = await s6.gateBuyPoint('0xu1', {}, {}), u2 = await s6.gateBuyPoint('0xu1', {}, {});
  check('F6 unhealthy 不拉黑 + 观测计数递增', [u1.grade, u1.unhealthyGrades, u2.unhealthyGrades, s6.isGateBlocked('0xu1')], ['unhealthy', 1, 2, false]);
  // F7 Jev 代不注入 factorMode 时开关为关（存量接线零变化）
  check('F7 缺省 factorMode=false', new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client }).factorMode, false);

  // F8 AF 门：零 I/O 直通
  const a1 = await svc.evaluateActFront('0xtok', META, {}, { awaitMs: 3000 });
  check('F8 evaluateActFront → assessed/mid_full/AF2', a1,
    { status: 'assessed', act: null, sbw: null, wash: null, path: 'mid_full', version: 'AF2', model: 'factor@AF2' });
  check('F8 零拉数', [db.st.tickQueries, db.st.otherTables.length], [0, 0]);
  check('F8 路径计数走 mid_full（不计 fail_open）', [svc.stats.actFrontRouted.mid_full, svc.stats.actFrontRouted.fail_open, svc.stats.actFrontFactorJudged], [1, 0, 1]);
  check('F8 disabled 语义不变', await new CheatCheckService({}, null, { factorMode: true }).evaluateActFront('0xtok', {}, {}), { status: 'disabled' });
  // F9 AF 门：注入判定返回 low → 分流函数照常产 reject_low（后续分类器接入即生效）
  const s9 = new CheatCheckService({ enabled: true }, SILENT, { dbClient: db.client, factorMode: true,
    actFrontFactorJudge: () => ({ act: 'low', sbw: 'none', wash: 'none', model: 'factor@AF2' }) });
  check('F9 反证：因子判 low → reject_low', (await s9.evaluateActFront('0xtok', {}, {})).path, 'reject_low');

  // F10 BP 门因子模式：不加载 LLM；塞单门 / minTicks 预门保留；落行版本域独立
  //（deps.arbBotWallets 直注=ctor 不预热查库，零 DB）
  const mkBp = (ticks, config = {}) => {
    const d = mkDb({});
    const svcBp = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, ...config }, SILENT,
      { dbClient: d.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000, pullTicks: memPull(ticks), arbBotWallets: new Set() });
    return { d, svcBp };
  };
  const n = mkBp(normalTicks);
  const n1 = await n.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-1' }, { awaitMs: 3000 });
  check('F10 正常形状 → assessed neutral/gates_passed + model', { s: n1.status, a: n1.assessment, m: n1.model, u: n1.usage },
    { s: 'assessed', a: { bucket: 'neutral', prob: null, rule: 'gates_passed' }, m: 'factor@BPF2', u: null });
  // normalTicks 单调上涨、末 30s 内无任何 5s 内下跌 → recentDip5 缺席 → anchors_missing 放行
  //（recentDip5 = 末 30s 内最深 5s 跌幅；稀疏 tick / 不跌的盘面天然缺席=「锚缺失不判」的放行面）
  check('F10 判据留痕透出（未命中=放行分支；无 5s 内下跌 → recentDip5 缺席）', [n1.factorTrace && n1.factorTrace.crashForm.branch, n1.factorTrace.crashForm.hit], ['anchors_missing', false]);
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
  // 落行：persist=true 下写 buy_point_analyses，版本域 BPF2，jev_prompt=null，model 标因子
  const p = mkBp(normalTicks, { persist: true });
  await p.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-9', experimentId: 'exp-1' }, {});
  const rowP = p.d.st.inserts[0];
  check('F10 落行版本域 BPF2 + 答案来源标因子 + 无 jev_prompt', rowP && { qv: rowP.question_version, model: rowP.answers_raw && rowP.answers_raw.model, jp: rowP.jev_prompt, sid: rowP.signal_id },
    { qv: 'BPF2', model: 'factor@BPF2', jp: null, sid: 'sig-9' });
  check('F10 _version 因子代独立', [p.svcBp._version, new BuyPointCheckService({ enabled: true }, SILENT, { arbBotWallets: new Set() })._version], ['BPF2', null]);
  check('F10 缺省 factorMode=false', new BuyPointCheckService({ enabled: true }, SILENT, { dbClient: mkDb({}).client, arbBotWallets: new Set() }).factorMode, false);
  const st = mkBp(stuffingTicks, { persist: true });
  await st.svcBp.gateBuyPoint('0xtok', META, {}, {});
  await st.svcBp.gateBuyPoint('0xtok', META, {}, {});
  check('F10 无粘滞：同票二连各判一次各落一行（BP 本无终态，Jev 代同语义）', [st.svcBp.stats.factorAnswered, st.d.st.inserts.length], [2, 2]);

  // F11 BPF2 crash 形态复核：service 全链（真快照 → 判定 → mapper 门链）
  const cf = mkBp(crashFormTicks);
  const cf1 = await cf.svcBp.gateBuyPoint('0xtok', META, { signalId: 'sig-cf' }, { awaitMs: 3000 });
  check('F11 缓跌无承接形状 → poor/entry_gate + entry_shape=crash', { s: cf1.status, a: cf1.assessment, es: cf1.dimensions.entry_shape, m: cf1.model },
    { s: 'assessed', a: { bucket: 'poor', prob: 1, rule: 'entry_gate' }, es: { bucket: 'crash', prob: 1 }, m: 'factor@BPF2' });
  // 数值手算：chg5=1.00/1.135−1；chg30=窗长 26s 无 30s 前价 → 回落首价=0；vsAth=1.00/1.4002−1；
  // 近段最深 5s 跌幅=t20(1.18)→t25(1.03)；尾 10s=(16,26] 卖 8 笔×0.08
  check('F11 判据留痕：分支 + 关键数值', { br: cf1.factorTrace.crashForm.branch, tr: cf1.factorTrace.crashForm.trace },
    { br: 'crash_form', tr: { chg5Pct: -11.89, chg30Pct: 0, currentVsAthPct: -28.58, nearMaxDn5Pct: -12.71, curVsMinGapPct: 0, recentDip5Pct: -12.71, nearTail10BuyN: 0, nearTail10SellBnb: 0.64 } });
  const cfT = mkBp(crashFormTurnoverTicks);
  const cfT1 = await cfT.svcBp.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F11 尾 10s 有一笔买（有换手）→ 放行 neutral', [cfT1.assessment.rule, cfT1.factorTrace.crashForm.branch], ['gates_passed', 'turnover_present']);
  const cfR = mkBp(crashFormReboundTicks);
  const cfR1 = await cfR.svcBp.gateBuyPoint('0xtok', META, {}, { awaitMs: 3000 });
  check('F11 末段回升（有回调）→ 放行 neutral', [cfR1.assessment.rule, ['rebounding', 'no_hint'].includes(cfR1.factorTrace.crashForm.branch)], ['gates_passed', true]);
}

console.log('\nG. 引擎挂点集成 + 接线源码锁');
{
  const mkEng = (ticks, { cheatSvc, signalGate = { maxTriggers: 1 } } = {}) => {
    const d = mkDb({});
    const cheat = cheatSvc || new CheatCheckService({ enabled: true }, SILENT, { dbClient: d.client, factorMode: true, loadLlm: neverLlm, now: () => 1700000000000 });
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
  // G1 全链直通：AF2 → CF1 → BPF2
  const g = mkEng(normalTicks);
  const a = await g.eng._actFrontGateEvaluate('0xtok', TOKEN, {}, 'sig-1', { factorResults: {} });
  check('G1 AF 门挂点：pass / 不跳 cheat', a, { pass: true, skipCheat: false, info: { status: 'assessed', act: null, sbw: null, wash: null, path: 'mid_full', version: 'AF2', model: 'factor@AF2' } });
  const c = await g.eng._cheatGateEvaluateBinary('0xtok', TOKEN, {}, 'sig-1', { maxTriggers: 1 }, { factorResults: { currentVsLaunchPct: 12 } });
  const judgedRef = FR.judgeCheatFactor(null);
  check('G1 cheat 门挂点：pass + info 同构（档位/锚原样透传）+ model 来源', { p: c.pass, i: c.info },
    { p: true, i: { status: 'analyzed', grade: 'healthy', cached: false, reasons: [], unhealthyGrades: 0, levels: judgedRef.levels, buckets: judgedRef.buckets, anchors: judgedRef.anchors,
      strongbackerLike: 0, exempt: null, unblocked: false, model: 'factor@CF1' } });
  check('G1 cheat 门 FA 投影照常（grade healthy / blocked false；档位全 null）',
    [FA.getCheatFactors('0xtok'), Object.values(FA.getCheatFactors('0xtok').levels).every((v) => v === null)],
    [{ grade: 'healthy', unhealthyGrades: 0, blocked: false, levels: judgedRef.levels, anchors: judgedRef.anchors, strongbackerLike: 0, codeLevels: null }, true]);
  FA.clearCheatFactors('0xtok');
  const b = await g.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-1', { maxTriggers: 1 }, {});
  check('G1 BP 门挂点：pass + model 来源', [b.pass, b.info.status, b.info.model, b.info.assessment, b.info.dimensions.market_pattern], [true, 'assessed', 'factor@BPF2', { bucket: 'neutral', prob: null, rule: 'gates_passed' }, null]);
  check('G1 BP info 带判据留痕（未命中；normalTicks 无 5s 内下跌 → recentDip5 缺席放行）', ['factorTrace' in b.info, b.info.factorTrace.crashForm.branch], [true, 'anchors_missing']);
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
  // G3c BPF2 crash 形态复核 × 引擎挂点：normal 通路（全 BP）命中 → fail-closed 拒 + metadata 留判据
  const g3c = mkEng(crashFormTicks);
  const b3c = await g3c.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-3c', { maxTriggers: 1 }, {});
  check('G3c crash 形态命中 → BP 门拒 reason=bp_gate_assessment', [b3c.pass, b3c.reason, g3c.statuses], [false, 'BP 门拒买（assessed: poor）', [{ id: 'sig-3c', status: 'failed', reason: 'bp_gate_assessment' }]]);
  const mdC = g3c.metas.find((m) => m.id === 'sig-3c').data.buyPoint;
  check('G3c metadata.buyPoint：entry_shape=crash + 判据留痕 + model', { es: mdC.dimensions.entry_shape, a: mdC.assessment, br: mdC.factorTrace.crashForm.branch, buyN: mdC.factorTrace.crashForm.trace.nearTail10BuyN, m: mdC.model },
    { es: { bucket: 'crash', prob: 1 }, a: { bucket: 'poor', prob: 1, rule: 'entry_gate' }, br: 'crash_form', buyN: 0, m: 'factor@BPF2' });
  // G3d 全豁类型（stuffingOnly）不吃形态臂——与 Jev 代同：类型票 BP 只评塞单门
  const g3d = mkEng(crashFormTicks);
  const b3d = await g3d.eng._bpGateEvaluate('0xtok', TOKEN, {}, 'sig-3d', { maxTriggers: 1 }, { pointTypePolicy: { buyPoint: 'stuffingOnly' } });
  check('G3d stuffingOnly policy × crash 形态 → 直通（类型豁免优先，形态臂不评）', [b3d.pass, b3d.info.assessment.rule], [true, 'policy_stuffing_only']);
  // G4 cheat 门 info：Jev 代返回无 model → metadata 不带键（v1 形状不变）
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
  ok('G5 _cheatGateInfo model 键条件携带', stripComments(abs).includes('...(res.model ? { model: res.model } : {})'));
  // G6 service 源码锁：因子代分支不触碰 Jev 链件（_ensureLlm / buildCheatState / _runJev 不在因子路径上）
  const svcSrc = stripComments(read('src/market-analysis/CheatCheckService.js'));
  const fcStart = svcSrc.indexOf('async _factorChain(');
  const factorChain = svcSrc.slice(fcStart, svcSrc.indexOf('async _ensureLlm() {', fcStart));
  ok('G6 _factorChain 方法体定位非空', factorChain.length > 200 && factorChain.length < 2500, factorChain.length);
  ok('G6 _factorChain 零 Jev 件', !/_ensureLlm|buildCheatState|_runJev|_pullTicks|_bootstrapHistory|_writeRow/.test(factorChain), factorChain.slice(0, 200));
  ok('G6 gateBuyPoint 因子分支先于粘滞 / inflight（粘滞与 join 不参与）',
    svcSrc.indexOf('if (this._factorMode) {') < svcSrc.indexOf('const lg = this._lastGrade.get(skey);'), '');
  const bpSrc = stripComments(read('src/market-analysis/BuyPointCheckService.js'));
  ok('G6 BP 链因子分支：LLM 加载与 state 构建均受 factorMode 守卫',
    bpSrc.includes('if (!this._factorMode) {') && bpSrc.includes('this._factorMode ? null : buildBuyPointState(snapshot).state')
    && bpSrc.includes('? { ok: true, result: answerBuyPointQuestions(snapshot) }'), '');
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
