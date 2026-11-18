// 临时冒烟（不进 git）：五层门链展示渲染验证——stub 最小 DOM 加载真实
// experiment_signals.js，构造五种分流形状的样例 signal 调 createSignalCard，
// 断言 pipeline/卡片关键串在场。零 DB 零网络。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/web/static/js/experiment_signals.js'), 'utf8');

// ── 最小浏览器环境 stub ──
// 关键：_escapeHtml 靠「textContent 赋值 → innerHTML 读取」的真实 DOM 转义行为
// （纯文本原样），stub 必须做 getter/setter 联动——否则所有经 escapeHtml 的动态
// 值渲染成空串（首版 stub 踩坑：断言全空实为 stub 缺陷非渲染 bug）
function makeEl() {
  let _html = '';
  let _text = '';
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
  getElementById: () => makeEl(), // loading 等元素返回可链式 stub（init 失败路径不崩）
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { /* init 同步异常吞掉——实例已赋值即可 */ } } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: { datasets: [] }, options: {} }; };
global.Chart.register = () => {};
global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.setInterval = () => 0; global.clearInterval = () => {};

eval(src); // 尾部 window.experimentSignals = new ExperimentSignals()（constructor 纯赋值）
const inst = global.experimentSignals;
if (!inst) { console.error('❌ 实例未创建'); process.exit(1); }

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ❌ FAIL: ' + label); }
}

// ── 样例工厂：五层 metadata 形状 ──
const mkSig = (md, extra = {}) => ({
  id: 'sig-1', action: 'buy', signal_type: 'BUY',
  signal_timestamp: '2026-11-18T08:00:00Z',
  token_symbol: 'TEST', token_address: '0xabc123',
  executed: false, execution_status: 'failed',
  failure_message: 'x', strategy_name: 't0', price: 1e-9,
  current_price: 1e-9, metadata: md, ...extra,
});
const sgBase = { legId: 't0', triggerNo: 1, maxTriggers: 2, bpPassLevels: ['good', 'neutral'] };
const fcPass = { status: 'assessed', pass: true, version: 'FP15', trace: {}, arms: [], gates: [] };

function render(md, extra) {
  const card = inst.createSignalCard(mkSig(md, extra));
  return card.innerHTML || '';
}

// ── 形状 A：AF reject_low（五层 pipeline：③红拒、④⑤未到达）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'low', sbw: 'none', wash: 'none', path: 'reject_low', version: 'AF1' },
  });
  ok(h.includes('前置活跃度门（第 2 层'), 'A: 活跃度门卡片标题在场');
  ok(h.includes('拒买（low ∧ 非 burst）'), 'A: reject_low path 徽章');
  ok(h.includes('活跃度 low'), 'A: 档位徽章 low');
  ok(h.includes('信号源门链（五层）'), 'A: pipeline 容器（五层）标题');
  ok(h.includes('① 信号触发 ✅'), 'A: 层1 触发');
  ok(h.includes('② 因子检查 ✅'), 'A: 层2 因子放行');
  ok(h.includes('③ 活跃度 🚫 拒（low）'), 'A: 层3 活跃度拒');
  ok(h.includes('④ 作弊 — 未到达'), 'A: 层4 未到达');
  ok(h.includes('⑤ BP 买点 — 未到达'), 'A: 层5 未到达');
}

// ── 形状 B：high_skip（③跳过 ④被跳过 ⑤ BP neutral 放行成交）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'high', sbw: 'none', wash: 'none', path: 'high_skip', version: 'AF1' },
    cheatCheck: { status: 'skipped_by_act_front', path: 'high_skip', act: 'high', sbw: 'none', wash: 'none', version: 'AF1', levels: { stallBurstWave: null } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.72, rule: 'gates_passed' }, dimensions: { market_pattern: { bucket: 'none', prob: 0.9 } }, anchors: { totalVolumeBnb: 3.2 }, model: 'fake', usage: { input_tokens: 100, output_tokens: 50 } },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('③ 活跃度 ⏭ high·跳过作弊'), 'B: 层3 high 跳过');
  ok(h.includes('④ 作弊 ⏭ 被③跳过'), 'B: 层4 被跳过');
  ok(h.includes('⑤ BP 买点 🟡 neutral'), 'B: 层5 neutral 过');
  ok(h.includes('被③活跃度门跳过'), 'B: 作弊卡跳过徽章');
  ok(h.includes('分流 path=high_skip'), 'B: 跳过卡 path 留痕');
  ok(h.includes('跳过④作弊门 → 直进⑤'), 'B: path 徽章文案');
  ok(h.includes('活跃度 high'), 'B: 档位徽章 high');
}

// ── 形状 C：mid_full 全链过（③走全链 ④healthy ⑤neutral）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'mid', sbw: 'none', wash: 'none', path: 'mid_full', version: 'AF1' },
    cheatCheck: { status: 'graded', grade: 'healthy', cached: false, reasons: [], levels: {}, buckets: { activityLevel: 'mid', stallBurstWave: 'none' } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.66, rule: 'gates_passed' }, dimensions: {}, anchors: {}, model: 'fake', usage: {} },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('③ 活跃度 ✅ mid·走全链'), 'C: 层3 mid 走全链');
  ok(h.includes('④ 作弊 ✅ healthy'), 'C: 层4 healthy');
  ok(h.includes('⑤ BP 买点 🟡 neutral'), 'C: 层5 neutral');
  ok(h.includes('mid → 照走④全链'), 'C: path 徽章');
  ok(h.includes('作弊盘检测门（第 3 层'), 'C: 作弊卡标题第 3 层');
  ok(h.includes('BP 买入点位门（第 4 层'), 'C: BP 卡标题第 4 层');
  ok(h.includes('因子购买前检查门（第 1 层'), 'C: 因子卡标题第 1 层');
}

// ── 形状 D：burst_exempt（low∧burst 豁免跳过）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'low', sbw: 'burst', wash: 'none', path: 'burst_exempt', version: 'AF1' },
    cheatCheck: { status: 'skipped_by_act_front', path: 'burst_exempt', act: 'low', sbw: 'burst', version: 'AF1', levels: { stallBurstWave: 1 } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.7, rule: 'gates_passed' }, dimensions: {}, anchors: {}, model: 'fake', usage: {} },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('③ 活跃度 ⏭ low·burst 豁免'), 'D: 层3 burst 豁免');
  ok(h.includes('burst 豁免 → 跳过④直进⑤'), 'D: path 徽章');
  ok(h.includes('停滞突发波 burst'), 'D: sbw 徽章');
}

// ── 形状 E：灰度关（AF/因子段缺席——pipeline 未启用·直通，卡片不渲染）──
{
  const h = render({
    signalGate: sgBase,
    cheatCheck: { status: 'graded', grade: 'healthy', cached: true, reasons: [], levels: {}, buckets: { activityLevel: 'high' } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.8, rule: 'gates_passed' }, dimensions: {}, anchors: {}, model: 'fake', usage: {} },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('② 因子检查 — 未启用·直通'), 'E: 层2 灰度关直通');
  ok(h.includes('③ 活跃度 — 未启用·直通'), 'E: 层3 灰度关直通');
  ok(!h.includes('前置活跃度门（第 2 层'), 'E: AF 段缺席卡片不渲染（零痕迹）');
  ok(!h.includes('因子购买前检查门（第 1 层'), 'E: 因子 disabled 卡片不渲染');
}

// ── 形状 F：AF 检测层故障（timeout fail-open 进 cheat，cheat unhealthy 拒）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'timeout_fail_open' },
    cheatCheck: { status: 'graded', grade: 'unhealthy', cached: false, reasons: [{ code: 'E_low_activity' }], levels: {}, buckets: { activityLevel: 'low' }, unhealthyGrades: 2 },
  });
  ok(h.includes('③ 活跃度 ⏱ 超时·放行') || h.includes('③ 活跃度 ⚠ 故障·放行'), 'F: 层3 故障放行');
  ok(h.includes('前置活跃度门（第 2 层'), 'F: AF 故障卡片渲染');
  ok(h.includes('④ 作弊 🚫 unhealthy'), 'F: 层4 unhealthy 拒');
  ok(h.includes('fail-open 放行进④作弊门全链'), 'F: 故障说明文案');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} 五层展示冒烟：${passed} 通过 / ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
