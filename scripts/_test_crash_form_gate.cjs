#!/usr/bin/env node
/**
 * crash 形态因子门单测（T243，2026-11-26 用户裁定「crash 形态复核（纯代码：无回调 + 无
 * 换手的单边下跌）没有必要做复核了吧，直接就是作为一个因子门不就好了」）——零 DB 零网络
 *
 * 覆盖：
 *   A. judgeCrashForm 真值表 / 提示臂边界 / 回调·换手·卖停放行 / 锚缺席不判（自
 *      _test_factor_responders D6 整段迁入——判据逐字不变，只是换了宿主模块）
 *   B. 因子门接线（FP48 臂 crash_form）：命中进 arms / 拒因 crash_form / 臂链末位
 *      （前臂命中时仍报前臂码）/ cheatOnly 类型让位 / 门行（进了复核才显示判据）
 *   C. BP 因子代 BPF3：不再答维度题——形态命中形状经 BP 门 = neutral 放行（形态已在
 *      ①因子门拦，BP 门不再「复核」）
 *   D. 单一真相源与版本锁：判据只在 factor-pre-buy-check.js；FP48 / BPF3；
 *      factor-responders 不再导出 judgeCrashForm
 *   E. 引擎级：真快照 → service 因子门命中 → 拒因 factor_gate_crash_form
 *
 * 用法：node scripts/_test_crash_form_gate.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FP = require(path.join(ROOT, 'src/market-analysis/factor-pre-buy-check.js'));
const FR = require(path.join(ROOT, 'src/market-analysis/factor-responders.js'));
const bpMapper = require(path.join(ROOT, 'src/market-analysis/buy-point-result-mapper'));
const { BuyPointCheckService } = require(path.join(ROOT, 'src/market-analysis/BuyPointCheckService'));

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

// ── 快照夹具（BP 快照口径：链上真序递增）──
const T0 = Date.parse('2026-11-25T10:00:00.000Z');
const at = (dt) => new Date(T0 + dt * 1000).toISOString();
const w = (n) => '0x' + String(n).padStart(4, '0') + 'aa'.repeat(18);
const prow = (i, side, bnb, price, o = {}) => ({
  block_time: at(i), block_number: o.block ?? 1000 + Math.floor(i / 3), log_index: o.li ?? i % 3,
  trade_type: side, trader_address: w(o.wallet ?? (i % 10)), sender_address: w(o.wallet ?? (i % 10)),
  // token_amount 与 bnb_amount×价格自洽（快照按金额口径判尘/可靠性，不自洽的行会被剔）
  bnb_amount: bnb, token_amount: 1e9 * bnb / price, price_bnb: price, price_outlier: false,
  tx_hash: '0xtx' + (o.tx ?? i), quote_token: null,
});
/** 形态命中形状：0~12s 买单拉到 1.40e-8 → 14s 起只有卖单、价格逐笔走低到 1.00e-8
 *  （锚=末笔卖：较窗高 −28.6%=提示臂①、5s 动量 −11.9%=未反弹、尾 10s 买 0 卖 8 笔） */
const crashFormTicks = [
  ...[0, 2, 4, 6, 8, 10, 12].map((i, k) => prow(i, 'buy', 0.1, (1.0 + k * 0.0667) * 1e-8, { wallet: 300 + k })),
  ...[[14, 1.30], [16, 1.26], [18, 1.22], [20, 1.18], [21, 1.135], [22, 1.11], [23, 1.085], [24, 1.055], [25, 1.03], [26, 1.00]]
    .map(([i, p], k) => prow(i, 'sell', 0.08, p * 1e-8, { wallet: 400 + k })),
];
/** 正常形状（因子门全过）：六钱包各一笔买——两笔 0.2 级（0.22/0.24：像样买方在场=PVP 过；
 *  ≥0.19 档合计 0.46<0.79=大户推迟臂 45s 档不触发）+ 四笔 0.08~0.12（中位 ≥0.05=尘埃臂
 *  不触发）缓升，随后三笔稀疏小卖微跌（5s 动量 -1% 以内=无形态提示） */
const normalTicks = [
  ...[0.22, 0.08, 0.24, 0.09, 0.12, 0.1].map((bnb, k) => prow(k * 2, 'buy', bnb, (1.0 + k * 0.012) * 1e-8, { wallet: 200 + k })),
  ...[[20, 1.05], [30, 1.04], [40, 1.03]].map(([tt, p], k) => prow(tt, 'sell', 0.03, p * 1e-8, { wallet: 260 + k })),
];

/** 纯形态夹具（探针实证）：买拉到 1.40 → 稀疏卖单阴跌到 0.729——尾 10s 买 0、卖未停、5s
 *  动量 -9.8%（未反弹）、较窗高 -26.5%（提示臂①）；30s 内卖单 4 笔（<5）= FP26 尾段买力
 *  枯竭臂不认领，前臂全放行 → 只有 crash_form 命中 */
function mkPure() {
  return mkForm([16, 26, 36, 46, 56, 59], 5, [[56, 6], [59, 4]]);
}
/** 形态夹具：买拉到 1.40 → 卖单 @sellTimes（各 stepPct；plan 可逐笔覆盖）阴跌 */
function mkForm(sellTimes, stepPct = 5, plan = []) {
  const t = [prow(0, 'buy', 0.3, 1.00e-8, { wallet: 301 })];
  for (let k = 1; k < 7; k++) t.push(prow(k * 2, 'buy', 0.1, (1.0 + k * 0.0667) * 1e-8, { wallet: 300 + k }));
  let p = 1.40;
  for (const tt of sellTimes) {
    const st = (plan.find(([x]) => x === tt) || [null, stepPct])[1];
    p = p * (1 - st / 100);
    t.push(prow(tt, 'sell', 0.03, p * 1e-8, { wallet: 400 + tt }));
  }
  return t;
}
const pureFormTicks = mkPure();
const base = (o = {}) => ({
  chg5Pct: -4.6, chg10Pct: -4.6, chg30Pct: 9.7, currentVsAthPct: -24.4, nearMaxDn5Pct: -25.5, curVsMinGapPct: 10.9,
  recentDip5Pct: -10.6, activity: { nearTail10BuyN: 0, nearTail10SellBnb: 0.11 }, ...o,
});
const act = (o) => base({ activity: { nearTail10BuyN: 0, nearTail10SellBnb: 0.11, ...o } });
const hit = (bd) => FP.judgeCrashForm(bd).hit;
const br = (bd) => FP.judgeCrashForm(bd).branch;
/** 因子门快照（与 _test_factor_gate_categories 同款：像样买方在场 → PVP 不命中） */
const snap = (bd, cd = {}) => ({
  ticks: [{ dt: 400 }],
  wallets: [{ maxBuyBnb: 0.2994 }],
  buyDerived: Object.assign({ activity: { nearTail10BuyN: 3, nearTail10SellBnb: 0.2 } }, bd),
  cheatDerived: Object.assign({}, cd),
});

console.log('A. judgeCrashForm 真值表（判据自 _test_factor_responders D6 逐字迁入）');
check('A1 全条件成立 → hit / crash_form', [hit(base()), br(base())], [true, 'crash_form']);
check('A2 提示臂四选一各自单独成立', [
  hit(base({ currentVsAthPct: -25.01, chg30Pct: 9.7, nearMaxDn5Pct: -5, curVsMinGapPct: 30 })),
  hit(base({ currentVsAthPct: -8, chg30Pct: -25.01, nearMaxDn5Pct: -5, curVsMinGapPct: 30 })),
  hit(base({ currentVsAthPct: -8, chg30Pct: 9.7, nearMaxDn5Pct: -15.01, curVsMinGapPct: 30 })),
  hit(base({ currentVsAthPct: -8, chg30Pct: 9.7, nearMaxDn5Pct: -5, curVsMinGapPct: 2 })),
], [true, true, true, true]);
check('A3 提示臂四臂全不中 → no_hint（火星酱形状：仅缓跌、离低点 5 个点）',
  [hit(base({ currentVsAthPct: -7.6, chg30Pct: -7.6, nearMaxDn5Pct: -12, curVsMinGapPct: 5 })), br(base({ currentVsAthPct: -7.6, chg30Pct: -7.6, nearMaxDn5Pct: -12, curVsMinGapPct: 5 }))],
  [false, 'no_hint']);
check('A4 提示臂边界（≤ 严格含线：-25 / -25 / -15 / 2 恰值命中，线外 0.01 不中）', [
  hit(base({ chg30Pct: -25, currentVsAthPct: -24.99, nearMaxDn5Pct: -14.99, curVsMinGapPct: 2.01 })),
  hit(base({ chg30Pct: -24.99, currentVsAthPct: -24.99, nearMaxDn5Pct: -14.99, curVsMinGapPct: 2.01 })),
  hit(base({ currentVsAthPct: -25, chg30Pct: -24.99, nearMaxDn5Pct: -14.99, curVsMinGapPct: 2.01 })),
  hit(base({ nearMaxDn5Pct: -15, currentVsAthPct: -24.99, chg30Pct: -24.99, curVsMinGapPct: 2.01 })),
  hit(base({ curVsMinGapPct: 2, currentVsAthPct: -24.99, chg30Pct: -24.99, nearMaxDn5Pct: -14.99 })),
], [true, false, true, true, true]);
check('A5 提示臂键缺席容缺：其余臂仍可命中；四键全 null → no_hint', [
  hit(base({ currentVsAthPct: null, chg30Pct: null, curVsMinGapPct: null })),
  br(base({ currentVsAthPct: null, chg30Pct: null, nearMaxDn5Pct: null, curVsMinGapPct: null })),
], [true, 'no_hint']);
check('A6 有回调 → 放行（chg5 恰 -1.5 仍命中；-1.49 起判反弹）', [
  hit(base({ chg5Pct: -1.5 })), br(base({ chg5Pct: -1.49 })), br(base({ chg5Pct: 0 })), br(base({ chg5Pct: 6.4 })),
], [true, 'rebounding', 'rebounding', 'rebounding']);
check('A7 有换手 → 放行（尾 10s 买 1 笔即算买方在场，哪怕是尘埃单）', [hit(act({ nearTail10BuyN: 1 })), br(act({ nearTail10BuyN: 3 }))],
  [false, 'turnover_present']);
check('A8 卖单已停 → 放行（买归零卖也归零 = 量能枯竭平静，非单边下跌）', [hit(act({ nearTail10SellBnb: 0 })), br(act({ nearTail10SellBnb: 0 }))],
  [false, 'no_sell']);
check('A9 锚缺席不判（题面反锚①「判缺不猜」）——四个关键锚任一 null 即 anchors_missing', [
  br(base({ recentDip5Pct: null })), br(base({ chg5Pct: null })), br(act({ nearTail10BuyN: null })), br(act({ nearTail10SellBnb: null })), br(null),
], ['anchors_missing', 'anchors_missing', 'anchors_missing', 'anchors_missing', 'no_snapshot']);
// 研究集（BP69 时代 380 个 Jev 标签信号重放，2026-11-26）反例锚：锚缺失面含金狗 쿠우타（+55%）
check('A10 研究集反例：金狗 쿠우타形状（尾 10 买 0、仍跌，但 recentDip5 缺席）→ 不判', hit(base({ chg5Pct: -4, recentDip5Pct: null, nearMaxDn5Pct: null })), false);
check('A11 线值常量（改线必同步本断言）', [
  FP.CRASHFORM_VS_ATH_MAX, FP.CRASHFORM_CHG30_MAX, FP.CRASHFORM_NEAR_DN5_MAX, FP.CRASHFORM_MIN_GAP_MAX, FP.CRASHFORM_CHG5_MAX, FP.CRASHFORM_TAIL_BUY_N_MAX,
], [-25, -25, -15, 2, -1.5, 0]);
check('A12 判据数值随 trace 透出（信号页展示用）', FP.judgeCrashForm(base()).trace,
  { chg5Pct: -4.6, chg30Pct: 9.7, currentVsAthPct: -24.4, nearMaxDn5Pct: -25.5, curVsMinGapPct: 10.9, recentDip5Pct: -10.6, nearTail10BuyN: 0, nearTail10SellBnb: 0.11 });

console.log('\nB. 因子门接线（FP48 臂 crash_form）');
{
  const r = FP.evaluateFactorPreBuy(snap(base()));
  check('B1 形态命中 → arms 含 crash_form、拒因 crash_form、pass=false', [r.pass, r.reason, r.arms, r.version], [false, 'crash_form', ['crash_form'], 'FP48']);
  check('B2 trace.crashForm 留痕（分支 + 判据八键）', [r.trace.crashForm.branch, r.trace.crashForm.nearTail10BuyN, r.trace.crashForm.nearTail10SellBnb], ['crash_form', 0, 0.11]);
  const g = r.gates.find((x) => x.id === 'crash_form');
  check('B3 门行 crash_form：点位形态类、hit=true、值带分支与判据', [g.category, g.hit, g.label, g.value.startsWith('无回调+无换手 chg5-4.6% vsAth-24.4%'), g.value.includes('尾10s买0笔 卖0.11B')], ['entry', true, 'FP48·crash形态（无回调无换手）', true, true]);
  // 放行形状：未进复核 → 门行 '-'（不冒充判据）
  const q = FP.evaluateFactorPreBuy(snap({ ...act({ nearTail10BuyN: 3 }), currentVsAthPct: -7.6, chg30Pct: -7.6, nearMaxDn5Pct: -12, curVsMinGapPct: 5 }));
  const gq = q.gates.find((x) => x.id === 'crash_form');
  check('B4 提示臂全不中 → 放行、门行值 -（未进复核不冒充判据）', [q.pass, q.reason, gq.hit, gq.value], [true, null, false, '-']);
  // 进了复核但有换手 → 门行显示分支与判据
  const t = FP.evaluateFactorPreBuy(snap(act({ nearTail10BuyN: 2 })));
  const gt = t.gates.find((x) => x.id === 'crash_form');
  check('B5 进复核后放行（有换手）→ 门行显示「有换手」与判据数值', [t.pass, gt.hit, gt.value.includes('有换手'), gt.value.includes('尾10s买2笔')], [true, false, true, true]);
  check('B6 进复核后放行不留 trace.crashForm（命中才注——形状不变约定）', 'crashForm' in t.trace, false);
  check('B7 锚缺席 → 门行如实「锚缺席不判」', FP.evaluateFactorPreBuy(snap({ ...base(), recentDip5Pct: null })).gates.find((x) => x.id === 'crash_form').value, '锚缺席不判');
  // 臂链末位：更具体的臂同时命中时仍报前臂的码（= 原 BP 位置可达的就是前臂全放行的形状）
  const both = FP.evaluateFactorPreBuy(snap({ ...base(), chg5Pct: -12, chg10Pct: -12.5 }));
  check('B8 臂链末位：crash 数值判序（FP47b）同时命中 → 报前臂码 crash_numeric、arms 不含 crash_form', [both.reason, both.arms], ['crash_numeric', ['crash_numeric']]);
  // cheatOnly 类型（famous_holder_cold_pit）：效果提升类臂让位——与 crash_numeric 同约定
  const cheatOnly = FP.evaluateFactorPreBuy(snap(base()), { armClass: 'cheat' });
  check('B9 cheatOnly 类型让位（armClass=cheat：非作弊类臂不拦）', [cheatOnly.pass, cheatOnly.reason, cheatOnly.arms], [true, null, []]);
  ok('B10 不在作弊类臂清单（CHEAT_CLASS_ARM_CODES）', !FP.CHEAT_CLASS_ARM_CODES.has('crash_form'));
  // 存量臂不受影响：全臂放行形状的门行数 = 39 存量 + 1（crash_form）
  const plain = FP.evaluateFactorPreBuy(snap({ chg30Pct: 0 }));
  check('B11 门行数 40（FP48 加一条 crash_form）且每行带类别', [plain.gates.length, plain.gates.filter((x) => !x.category).length, plain.version], [40, 0, 'FP48']);
}

console.log('\nC. BP 因子代 BPF3：不再答维度题');
{
  const bp = FR.answerBuyPointQuestions({ buyDerived: base() });
  check('C1 形态命中形状经 BP 应答器 → answers 空（无 entry_shape）、无 factor 留痕', [bp.answers, bp.model, bp.usage, 'factor' in bp], [{}, 'factor@BPF3', null, false]);
  check('C2 mapper 读档 → neutral / gates_passed（BP 门不再「复核」crash 形态）',
    bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 0 }).assessment, { bucket: 'neutral', prob: null, rule: 'gates_passed' });
  check('C3 塞单门照常在 BP 门拦（恰 8 钱包）', bpMapper.buildBuyPointObservation(bp.answers, { exactEqualBlockMaxWallets: 8 }).assessment,
    { bucket: 'poor', prob: null, rule: 'stuffing_gate' });
}

console.log('\nD. 单一真相源与版本锁');
{
  ok('D1 判据只在 factor-pre-buy-check.js（factor-responders 不再导出 judgeCrashForm）', !('judgeCrashForm' in FR) && typeof FP.judgeCrashForm === 'function');
  const frSrc = fs.readFileSync(path.join(ROOT, 'src/market-analysis/factor-responders.js'), 'utf8');
  const fpSrc = fs.readFileSync(path.join(ROOT, 'src/market-analysis/factor-pre-buy-check.js'), 'utf8');
  ok('D2 factor-responders 体内无判据实现（防两处判据漂移）', !/function judgeCrashForm\(/.test(frSrc) && !/CRASHFORM_VS_ATH_MAX = /.test(frSrc));
  check('D3 版本常量', [FP.FACTOR_PREBUY_VERSION, FR.BUY_POINT_FACTOR_VERSION, FR.CHEAT_FACTOR_VERSION, FR.ACT_FRONT_FACTOR_VERSION], ['FP48', 'BPF3', 'CF1', 'AF2']);
  ok('D4 臂挂点在臂链末位（famous 早窗快闪分支之前、紧邻 else）', /else if \(_crashFormHit\) arms\.push\('crash_form'\);\s*\n\s*else \{ \/\/ FP11 famous 早窗快闪双支/.test(fpSrc));
  const bpSvc = fs.readFileSync(path.join(ROOT, 'src/market-analysis/BuyPointCheckService.js'), 'utf8');
  const eng = fs.readFileSync(path.join(ROOT, 'src/trading-engine/core/AbstractTradingEngine.js'), 'utf8');
  ok('D5 factorTrace 链路已拆（service / 引擎不再透出该键）', !bpSvc.includes('factorTrace') && !/factorTrace: res\.factorTrace/.test(eng));
}

console.log('\nE. 引擎级：真快照 → service 因子门命中（零 DB：dbClient 桩 + persist:false）');
(async () => {
  const memPull = (ticksAsc) => async () => ({ rows: ticksAsc, anchorTickCount: ticksAsc.length, capped: false });
  // factorCheck.enabled 归策略包 modules.factorCheck——引擎构造时注入；单测显式开。
  // ⚠ 零 DB 纪律（本测试首版漏隔离：service 缺省 persist=true 会去写 buy_point_analyses、
  //   _loadCreateMeta 会真读 wss_events）——dbClient 桩 + persist:false，并断言只经桩读
  const mk = (ticks) => {
    const calls = [];
    const stub = { from(t) { calls.push(t); const c = { select: () => c, eq: () => c, limit: () => Promise.resolve({ data: [], error: null }) }; return c; } };
    const svc = new BuyPointCheckService({ enabled: true, settleDelayMs: 0, factorCheck: { enabled: true }, persist: false }, null,
      { factorMode: true, pullTicks: memPull(ticks), arbBotWallets: new Set(), dbClient: stub });
    return { svc, calls };
  };
  const META = { symbol: 'TST', name: 'Test', platform: 'flap', createdAtMs: T0, totalSupply: 1e9, creatorAddress: w(9) };
  const { svc, calls } = mk(pureFormTicks);
  const fg = await svc.evaluateFactorPreBuy('0xtok', META, {}, {});
  check('E1 纯形态：因子门拒，拒因 crash_form（引擎 execution_reason=factor_gate_crash_form）', [fg.status, fg.pass, fg.reason, fg.version, fg.arms], ['assessed', false, 'crash_form', 'FP48', ['crash_form']]);
  const g = fg.gates.find((x) => x.id === 'crash_form');
  check('E2 门行 crash_form hit、值带判据（无回调+无换手 / 尾10s买0笔）', [g.hit, g.value.includes('无回调+无换手'), g.value.includes('尾10s买0笔 卖0.06B'), g.category], [true, true, true, 'entry']);
  check('E2b trace.crashForm 判据（真快照数值）', [fg.trace.crashForm.branch, fg.trace.crashForm.nearTail10BuyN, fg.trace.crashForm.currentVsAthPct.toFixed(2), fg.trace.crashForm.nearTail10SellBnb], ['crash_form', 0, '-26.51', 0.06]);
  // 事故现场反证（BPF2 时代该形状的拦截点在 BP 门 bp_gate_assessment）：如今直接调 BP 门=放行
  const bp = await svc.gateBuyPoint('0xtok', META, { signalId: 'sig-e' }, {});
  check('E3 同形状直接经 BP 门（BPF3）= neutral 放行、无 factorTrace——「复核」已不存在', [bp.status, bp.assessment, 'factorTrace' in bp, bp.model],
    ['assessed', { bucket: 'neutral', prob: null, rule: 'gates_passed' }, false, 'factor@BPF3']);
  // 形态与 FP26 的重叠面：尾 10s 买=0 ⟹ 尾 5s 买=0，30s 内卖单 ≥5 时 FP26（臂链更前）先认领
  //（卖单须留一对 ≤5s 的尾笔——否则 recentDip5 缺席，形态判据「锚缺席不判」）
  const dense = mkForm([16, 26, 36, 46, 51, 56, 59], 5, [[56, 6], [59, 4]]);
  const { svc: svcD } = mk(dense);
  const fgD = await svcD.evaluateFactorPreBuy('0xtok', META, {}, {});
  check('E4 卖单加密到 30s ≥5 笔 → FP26 尾段买力枯竭先认领（拒因 tail_no_buyer_pressure；crash_form 仍命中留痕）',
    [fgD.pass, fgD.reason, fgD.arms, fgD.trace.crashForm && fgD.trace.crashForm.branch, fgD.gates.find((x) => x.id === 'crash_form').hit],
    [false, 'tail_no_buyer_pressure', ['tail_no_buyer_pressure'], 'crash_form', false]);
  ok('E4b 门行如实：进了复核（值显示分支与判据）但未进 arms（前臂 FP26 已认领）',
    fgD.gates.find((x) => x.id === 'crash_form').value.includes('无回调+无换手'), fgD.gates.find((x) => x.id === 'crash_form').value);
  const { svc: svcN, calls: callsN } = mk(normalTicks);
  const fg2 = await svcN.evaluateFactorPreBuy('0xtok', META, {}, {});
  check('E5 正常形状：因子门放行、crash_form 臂不在 arms、无 trace.crashForm', [fg2.pass, fg2.reason, fg2.arms.includes('crash_form'), 'crashForm' in fg2.trace], [true, null, false, false]);
  check('E6 零 DB 隔离：全程只经桩读 wss_events（createMeta 兜底），无任何写', [...new Set([...calls, ...callsN])], ['wss_events']);
  console.log(`\n${'='.repeat(60)}\ncrash 形态因子门单测：${pass} 通过，${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(`\n❌ 异常: ${e?.stack || e}`); process.exit(1); });
