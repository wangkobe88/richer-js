#!/usr/bin/env node
/**
 * 因子门分类单测（T241b，2026-11-26 用户提案「因子门就很多了，建议进行一下因子分类。
 * 在信号页面，也已分类为分块展示数据」）——零 DB 零网络
 *
 * 覆盖：
 *   A. 两份分类表对锁：后端 factor-pre-buy-check.js（单一真相源）↔ 信号页
 *      experiment_signals.js 镜像（FACTOR_GATE_CATEGORIES / FACTOR_GATE_CATEGORY_BY_ID）
 *   B. 后端分类完备：每条因子门门行都带 category；类别表每类非空；类别 id 两表自洽；
 *      未登记门 → null 不冒充；代表性臂命中 → 对应门行 hit 落在预期类别
 *   C. 信号页渲染（stub DOM 加载真实 experiment_signals.js）：
 *      C1 因子代全链放行：代次徽章 / 三卡标题与文案 / 分类分块 / BP 两条门行并入
 *      C2 crash 形态复核命中拒：BP 卡判据块 + 拒因块 + 流水线
 *      C3 因子门拒（历史行无 category）：按门 id 归类分块 + 拒因块带因子门分类
 *      C4 Jev 代历史行：零因子代文案、原文案不变
 *      C5 未登记门行：不冒充归类，显式提示
 *
 * 用法：node scripts/_test_factor_gate_categories.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FP = require(path.join(ROOT, 'src/market-analysis/factor-pre-buy-check.js'));

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

// ── 信号页 JS 里的分类镜像提取（标记注释之间；对象字面量 eval 成真值）──
const JS_SRC = read('src/web/static/js/experiment_signals.js');
function extractMarked(src, name) {
  const re = new RegExp(`\\/\\* ${name}:BEGIN \\*\\/([\\s\\S]*?)\\/\\* ${name}:END \\*\\/`);
  const m = src.match(re);
  if (!m) throw new Error(`信号页 JS 缺 ${name} 标记块`);
  const body = m[1];
  const expr = body.slice(body.indexOf('=') + 1).trim().replace(/;$/, '');
  return Function(`"use strict"; return (${expr});`)();
}

console.log('A. 两份分类表对锁（后端 ↔ 信号页镜像）');
{
  const jsCats = extractMarked(JS_SRC, 'FACTOR_GATE_CATEGORIES');
  const jsMap = extractMarked(JS_SRC, 'FACTOR_GATE_CATEGORY_BY_ID');
  check('A1 类别表逐项一致（id / label / question / 顺序）',
    jsCats.map((c) => ({ id: c.id, label: c.label, question: c.question })),
    FP.FACTOR_GATE_CATEGORIES.map((c) => ({ id: c.id, label: c.label, question: c.question })));
  check('A2 门 → 类别映射一致', jsMap, { ...FP.FACTOR_GATE_CATEGORY_BY_ID });
  const norm = (s) => JSON.stringify(Object.keys(s).sort());
  ok('A3 映射键集一致（门 id 集合两侧同）', norm(jsMap) === norm(FP.FACTOR_GATE_CATEGORY_BY_ID),
    { js: Object.keys(jsMap).length, backend: Object.keys(FP.FACTOR_GATE_CATEGORY_BY_ID).length });
}

console.log('\nB. 后端分类完备');
{
  const snap = (bd, cd) => ({
    ticks: [{ dt: 400 }],
    wallets: [{ maxBuyBnb: 0.2994 }],
    buyDerived: Object.assign({ activity: { nearTail10BuyN: 3, nearTail10SellBnb: 0.2 } }, bd),
    cheatDerived: Object.assign({}, cd),
  });
  const r = FP.evaluateFactorPreBuy(snap({ chg30Pct: 0 }, {}));
  check('B1 每条门行都带 category（无一 null）', r.gates.filter((g) => !g.category).map((g) => g.id), []);
  ok('B2 门行数（37 存量 + FP47a/b 两条）', r.gates.length === 39, r.gates.length);
  const gateIds = new Set(r.gates.map((g) => g.id));
  const mapKeys = Object.keys(FP.FACTOR_GATE_CATEGORY_BY_ID);
  check('B3 映射键 = 因子门门行 ∪ BP 门两条（无多余键）',
    mapKeys.filter((k) => !gateIds.has(k) && !['stuffing_gate', 'crash_form'].includes(k)), []);
  check('B4 每条门行都在映射里', r.gates.filter((g) => !mapKeys.includes(g.id)).map((g) => g.id), []);
  const catIds = new Set(FP.FACTOR_GATE_CATEGORIES.map((c) => c.id));
  check('B5 映射值都是类别表里的 id', mapKeys.filter((k) => !catIds.has(FP.FACTOR_GATE_CATEGORY_BY_ID[k])), []);
  check('B6 每个类别都至少有一道门',
    FP.FACTOR_GATE_CATEGORIES.filter((c) => !mapKeys.some((k) => FP.FACTOR_GATE_CATEGORY_BY_ID[k] === c.id)).map((c) => c.id), []);
  check('B7 未登记门 → null（不冒充归类）', FP.factorGateCategory('nope_gate'), null);
  check('B8 BP 门两条归类', [FP.factorGateCategory('stuffing_gate'), FP.factorGateCategory('crash_form')], ['organized', 'entry']);
  // 代表性臂：命中 → 对应门行 hit=true 且落在预期类别
  const hitCats = (res) => [...new Set(res.gates.filter((g) => g.hit).map((g) => g.category))];
  const pvp = FP.evaluateFactorPreBuy({ ticks: [{ dt: 400 }], wallets: [], buyDerived: { activity: { nearTail10BuyN: 3 } }, cheatDerived: {} });
  check('B9 像样买方缺席（pvp）→ 参与结构', [pvp.reason, hitCats(pvp)], ['pvp_no_big_participation', ['participation']]);
  const WIN = (buyBnb, sellBnb) => ({ buyBnb, sellBnb, buyN: 2, sellN: 2, netBnb: 0, buySharePct: 50, ticksPerMin: 10, buyers: 2, sellers: 2, newBuyers: 0 });
  const tail = FP.evaluateFactorPreBuy(snap({ athVsLaunchPct: 233.7, totalVolumeBnb: 47.29,
    win: { 30: WIN(0.2475, 0.4879), 120: WIN(0.2475, 0.5861) } }, {}));
  check('B10 尾声延伸活跃 → 活跃度流动性', [tail.reason, hitCats(tail)], ['act_tail_flat', ['liquidity']]);
  // 门行形状：category + 存量四键齐全
  ok('B11 门行形状（category/id/label/value/line/hit）',
    r.gates.every((g) => typeof g.category === 'string' && g.id && g.label && typeof g.value === 'string' && typeof g.line === 'string' && g.hit === false));
  // FP47a/b 两条臂的门行在位（未命中值 '-'，不冒充判据数值）
  check('B12 FP47a/b 门行在位且未命中值为 -',
    r.gates.filter((g) => ['malicious_dump', 'crash_numeric'].includes(g.id)).map((g) => [g.id, g.value, g.hit, g.category]),
    [['malicious_dump', '-', false, 'entry'], ['crash_numeric', '-', false, 'entry']]);
}

// ── C. 信号页渲染（stub 最小 DOM 加载真实 experiment_signals.js）──
// 关键：_escapeHtml 靠「textContent 赋值 → innerHTML 读取」的 DOM 转义行为，stub 必须
// getter/setter 联动（否则经 escapeHtml 的动态值渲染成空串——仓库冒烟首版踩坑）
function makeEl() {
  let _html = ''; let _text = '';
  const el = {
    tagName: 'div', className: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, children: [],
    get innerHTML() { return _html; },
    set innerHTML(v) { _html = String(v); },
    get textContent() { return _text; },
    set textContent(v) { _text = String(v); if (_html === '') _html = _text; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 50 }),
    closest: () => null, contains: () => false, focus() {}, click() {},
  };
  return el;
}
global.window = global;
global.document = {
  createElement: () => makeEl(),
  getElementById: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { /* init 同步异常吞掉——实例已赋值即可 */ } } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
// Node 23 起 globalThis.navigator 是只读 getter——直接赋值抛 TypeError，须 defineProperty
Object.defineProperty(global, 'navigator', { value: { clipboard: { writeText: async () => {} } }, configurable: true, writable: true });
global.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: { datasets: [] }, options: {} }; };
global.Chart.register = () => {};
global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.setInterval = () => 0; global.clearInterval = () => {};

// eslint-disable-next-line no-eval
eval(JS_SRC);
const inst = global.experimentSignals;
if (!inst) { console.error('❌ 页面实例未创建'); process.exit(1); }

const mkSig = (md, extra = {}) => ({
  id: 'sig-1', action: 'buy', signal_type: 'BUY', signal_timestamp: '2026-11-26T08:00:00Z',
  token_symbol: 'TEST', token_address: '0xabc123',
  executed: false, execution_status: 'failed', failure_message: 'x', strategy_name: 't0', price: 1e-9,
  current_price: 1e-9, metadata: md, ...extra,
});
const sgBase = { legId: 't0', triggerNo: 1, maxTriggers: 2, bpPassLevels: ['good', 'neutral'] };
const render = (md, extra) => { try { return inst.createSignalCard(mkSig(md, extra)).innerHTML || ''; } catch (e) { return `__RENDER_ERROR__ ${e.stack}`; } };
const nulls = (keys) => Object.fromEntries(keys.map((k) => [k, null]));
const LVL = ['equalAmountSplit', 'coordinatedSellBack', 'sellDispersion', 'stallBurstWave', 'amountTiering', 'sameBlockBuyWave', 'insiderSupplySell', 'slowGrindPump', 'washPair', 'activityLevel'];
// 因子代三段 metadata（service 返回形状）
const AF_F = { status: 'assessed', act: null, sbw: null, wash: null, path: 'mid_full', version: 'AF2', model: 'factor@AF2' };
const CH_F = { status: 'analyzed', grade: 'healthy', cached: false, reasons: [], unhealthyGrades: 0, levels: nulls(LVL), buckets: nulls(LVL), anchors: nulls(['washPairCount']), strongbackerLike: 0, exempt: null, unblocked: false, model: 'factor@CF1' };
const DIMS = nulls(['price_trend', 'holder_concentration', 'price_level', 'market_pattern', 'entry_shape']);
const bpFactor = (hit) => ({
  status: 'assessed',
  assessment: hit ? { bucket: 'poor', prob: 1, rule: 'entry_gate' } : { bucket: 'neutral', prob: null, rule: 'gates_passed' },
  dimensions: hit ? { ...DIMS, entry_shape: { bucket: 'crash', prob: 1 } } : DIMS,
  anchors: { exactEqualBlockMaxWallets: 0, tokenAgeSec: 99 }, passLevels: ['good', 'neutral'], passed: !hit, model: 'factor@BPF2', usage: null,
  factorTrace: { crashForm: { hit, branch: hit ? 'crash_form' : 'turnover_present',
    trace: { chg5Pct: -4.61, chg30Pct: 9.68, currentVsAthPct: -24.43, nearMaxDn5Pct: -25.53, curVsMinGapPct: 10.9, recentDip5Pct: -10.64, nearTail10BuyN: hit ? 0 : 1, nearTail10SellBnb: 0.11 } } },
});
const gate = (id, hit) => ({ id, label: `门-${id}`, value: 'v', line: 'l', hit, ...(hit ? {} : {}) });
const GATES_LEGACY = [ // 历史行：无 category 字段
  gate('pvp', false), gate('big_buy_defer', false), gate('act_idle', false), gate('cd400', false),
  gate('tail_dip_knife', false), gate('fam_holding', false), gate('stall_restart', false),
];

console.log('\nC. 信号页渲染');
{
  // C1 因子代全链放行
  const h = render({
    signalGate: sgBase,
    factorCheck: { status: 'assessed', pass: true, version: 'FP47', trace: {}, arms: [], gates: GATES_LEGACY.map((g) => ({ ...g, category: FP.factorGateCategory(g.id) })) },
    actFrontGate: AF_F, cheatCheck: CH_F, buyPoint: bpFactor(false),
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok('C1 渲染无异常', !h.includes('__RENDER_ERROR__'), h.slice(0, 300));
  ok('C1 代次徽章（零 Jev：AF2 · CF1 · BPF2）', h.includes('因子代（零 Jev）') && h.includes('活跃度 AF2') && h.includes('作弊 CF1') && h.includes('BP BPF2'));
  ok('C1 活跃度卡=因子代文案（不判档，不冒充档位）', h.includes('活跃度门（第 2 层 · 因子代 AF2') && h.includes('不判档 → 照走④') && h.includes('不判档·照走④') && !h.includes('活跃度档位缺席'));
  ok('C1 作弊卡=因子代文案（本层无拒臂）', h.includes('作弊门（第 3 层 · 因子代 CF1') && h.includes('本层无拒臂'));
  ok('C1 BP 卡=因子代文案（零 Jev；不显示 Jev 维度题区/综合概率）', h.includes('BP 买点门（第 4 层 · 因子代 BPF2') && !h.includes('综合概率 p=') && !h.includes('维度题（参考不进门链'));
  ok('C1 全卡无「Jev 3 题 / Jev 10 题」字样', !h.includes('Jev 3 题') && !h.includes('Jev 10 题'));
  ok('C1 流水线：③ 不判档·照走④ / ④ 放行 / ⑤ neutral', h.includes('③ 活跃度 ✅ 不判档·照走④') && h.includes('④ 作弊 ✅ 放行') && h.includes('⑤ BP 买点 🟡 neutral'));
  // 分类分块
  const blockTitles = ['参与结构', '组织性协同', '砸盘出货', '活跃度流动性', '点位形态', 'famous / 聪明钱行为', '通路'];
  const allGates = FP.evaluateFactorPreBuy({ ticks: [{ dt: 400 }], wallets: [{ maxBuyBnb: 0.2994 }], buyDerived: { activity: { nearTail10BuyN: 3 } }, cheatDerived: {} }).gates;
  const h2 = render({
    signalGate: sgBase,
    factorCheck: { status: 'assessed', pass: true, version: 'FP47', trace: {}, arms: [], gates: allGates },
    actFrontGate: AF_F, cheatCheck: CH_F, buyPoint: bpFactor(false),
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok('C1 七个类别分块齐全（按类别表顺序）', blockTitles.every((t) => h2.includes(`🧩 ${t} · `)), blockTitles.filter((t) => !h2.includes(`🧩 ${t} · `)));
  const order = blockTitles.map((t) => h2.indexOf(`🧩 ${t} · `));
  ok('C1 分块顺序 = 类别表顺序', order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), order);
  ok('C1 39 门行 + BP 两条门行（塞单门 / crash 形态复核）都进了分块视图',
    allGates.every((g) => h2.includes(g.label)) && h2.includes('BP77·同块等额塞单') && h2.includes('BPF2·crash 形态复核'));
  ok('C1 分块头带门数与问题（如 参与结构 · 有没有像样的买家和主力（3 门））', h2.includes('🧩 参与结构 · 有没有像样的买家和主力（3 门）'));
  ok('C1 放行卡不显示命中类别行', !h2.includes('命中类别：'));
  // C2 crash 形态复核命中拒
  const hcrash = render({ signalGate: sgBase, factorCheck: { status: 'assessed', pass: true, version: 'FP47', trace: {}, arms: [], gates: allGates }, actFrontGate: AF_F, cheatCheck: CH_F, buyPoint: bpFactor(true) },
    { executed: false, execution_status: 'failed', execution_reason: 'bp_gate_assessment' });
  ok('C2 渲染无异常', !hcrash.includes('__RENDER_ERROR__'), hcrash.slice(0, 300));
  // 判据行 = 标签 + 「（线）」+ 数值三段（span 标签分隔，分别断言）
  ok('C2 BP 卡判据块：命中 + 判据八键数值', hcrash.includes('📉 crash 形态复核') && hcrash.includes('🚫 命中') && hcrash.includes('5s 动量 %') && hcrash.includes('（≤-1.5 未反弹）') && hcrash.includes('-4.61') && hcrash.includes('尾 10s 买笔数') && hcrash.includes('（=0 无换手）'));
  ok('C2 拒因块：crash 形态复核命中 + 分支中文', hcrash.includes('BP 门拒（crash 形态复核命中：无回调 + 无换手的单边下跌）') && hcrash.includes('🚫 命中：无回调 + 无换手的单边下跌'));
  ok('C2 流水线 ⑤ 拒带形态复核说明', hcrash.includes('crash 形态复核命中——无回调 + 无换手的单边下跌'));
  ok('C2 命中类别行=点位形态', hcrash.includes('命中类别：') && hcrash.includes('点位形态（1）'));
  // 点位形态块 = ①因子门三条（尾部接刀 / 恶意砸盘 / crash 数值判序）+ ⑤合成的 crash 形态复核一条
  ok('C2 点位形态分块头显示 4 门 · 命中 1', hcrash.includes('🧩 点位形态 · 这个买点是不是在接刀（4 门 · 🚫 命中 1）'));
  // C3 因子门拒（历史行无 category）
  const legacyGates = GATES_LEGACY.map((g) => (g.id === 'cd400' ? { ...g, hit: true } : g));
  const hfp = render({ signalGate: sgBase, factorCheck: { status: 'assessed', pass: false, reason: 'cd400_dump_no_absorption', version: 'FP47', trace: {}, arms: ['cd400_dump_no_absorption'], gates: legacyGates }, actFrontGate: AF_F },
    { executed: false, execution_status: 'failed', execution_reason: 'factor_gate_cd400_dump_no_absorption' });
  ok('C3 渲染无异常', !hfp.includes('__RENDER_ERROR__'), hfp.slice(0, 300));
  ok('C3 历史行按门 id 归类分块（砸盘出货块含 cd400 门行且命中）', hfp.includes('🧩 砸盘出货 · 是不是有人在砸盘出货、有没有人接（1 门 · 🚫 命中 1）') && hfp.includes('门-cd400 🚫'));
  ok('C3 拒因块带「因子门分类: 砸盘出货」', hfp.includes('因子门分类: 砸盘出货'));
  ok('C3 因子门拒=⑤未到达：分块视图无 BP 两条门行', !hfp.includes('BP77·同块等额塞单') && !hfp.includes('BPF2·crash 形态复核'));
  // C4 Jev 代历史行：零因子代文案、原文案不变
  const hjev = render({
    signalGate: sgBase, factorCheck: { status: 'assessed', pass: true, version: 'FP47', trace: {}, arms: [], gates: GATES_LEGACY },
    actFrontGate: { status: 'assessed', act: 'mid', sbw: 'none', wash: 'none', path: 'mid_full', version: 'AF1' },
    cheatCheck: { status: 'graded', grade: 'healthy', cached: false, reasons: [], levels: {}, buckets: { activityLevel: 'mid' } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.66, rule: 'gates_passed' }, dimensions: { market_pattern: { bucket: 'none', prob: 0.9 } }, anchors: { exactEqualBlockMaxWallets: 0 }, model: 'fake', usage: {} },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok('C4 渲染无异常', !hjev.includes('__RENDER_ERROR__'), hjev.slice(0, 300));
  ok('C4 Jev 代无代次徽章 / 无因子代文案', !hjev.includes('因子代') && !hjev.includes('不判档'));
  ok('C4 Jev 代原文案在位（活跃度门 / 作弊盘检测门 / BP 买入点位门 / 综合概率 / 维度题）',
    hjev.includes('前置活跃度门（第 2 层 · Jev 3 题') && hjev.includes('作弊盘检测门（第 3 层 · Jev 10 题）') && hjev.includes('BP 买入点位门（第 4 层 · Jev 3 题）')
    && hjev.includes('综合概率 p=0.66') && hjev.includes('维度题（参考不进门链') && hjev.includes('③ 活跃度 ✅ mid·走全链'));
  ok('C4 Jev 代同样按类别分块（分类对两代一视同仁）', hjev.includes('🧩 参与结构 · ') && hjev.includes('🧩 通路 · ') && hjev.includes('BP77·同块等额塞单'));
  // C5 未登记门行：显式提示，不冒充
  const hund = render({ signalGate: sgBase, factorCheck: { status: 'assessed', pass: true, version: 'FP47', trace: {}, arms: [], gates: [{ id: 'zzz_new_arm', label: '门-zzz', value: 'v', line: 'l', hit: false }] }, actFrontGate: AF_F });
  ok('C5 未归类门显式提示（分类表未登记）', hund.includes('⚠ 未归类的门：zzz_new_arm') && !hund.includes('门-zzz 🚫'));
}

console.log(`\n因子门分类单测：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
