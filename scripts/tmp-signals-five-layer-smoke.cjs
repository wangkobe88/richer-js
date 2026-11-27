// 临时冒烟（不进 git）：四层门链展示渲染验证（2026-11-26 活跃度并入②因子检查层）——stub 最小 DOM 加载真实
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
global.location = { pathname: '/experiment/test-exp/signals' };
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

// ── 样例工厂：门链 metadata 形状 ──
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

// ── 形状 A：AF reject_low（四层 pipeline：②因子放行、③④未到达；活跃度卡照常渲染真判定）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'low', sbw: 'none', wash: 'none', path: 'reject_low', version: 'AF1' },
  });
  ok(h.includes('前置活跃度门（第 2 层'), 'A: 活跃度门卡片标题在场');
  ok(h.includes('拒买（low ∧ 非 burst）'), 'A: reject_low path 徽章');
  ok(h.includes('活跃度 low'), 'A: 档位徽章 low');
  ok(h.includes('信号源门链（四层）'), 'A: pipeline 容器（四层）标题');
  ok(!h.includes('信号源门链（五层）'), 'A: 五层标题不渲染');
  ok(h.includes('① 信号触发 ✅'), 'A: 层1 触发');
  ok(h.includes('② 因子检查 ✅'), 'A: 层2 因子放行');
  ok(!h.includes('③ 活跃度'), 'A: 活跃度流水线段已移除（并入②）');
  ok(h.includes('③ 作弊 — 未到达'), 'A: 层3 作弊未到达');
  ok(h.includes('④ BP 买点 — 未到达'), 'A: 层4 BP 未到达');
}

// ── 形状 B：high_skip（③作弊被活跃度门跳过 ④ BP neutral 放行成交）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'high', sbw: 'none', wash: 'none', path: 'high_skip', version: 'AF1' },
    cheatCheck: { status: 'skipped_by_act_front', path: 'high_skip', act: 'high', sbw: 'none', wash: 'none', version: 'AF1', levels: { stallBurstWave: null } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.72, rule: 'gates_passed' }, dimensions: { market_pattern: { bucket: 'none', prob: 0.9 } }, anchors: { totalVolumeBnb: 3.2 }, model: 'fake', usage: { input_tokens: 100, output_tokens: 50 } },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('③ 作弊 ⏭ 被活跃度门跳过'), 'B: 层3 作弊被跳过');
  ok(h.includes('④ BP 买点 🟡 neutral'), 'B: 层4 neutral 过');
  ok(h.includes('被活跃度门跳过'), 'B: 作弊卡跳过徽章');
  ok(h.includes('分流 path=high_skip'), 'B: 跳过卡 path 留痕');
  ok(h.includes('跳过③作弊门 → 直进④'), 'B: path 徽章文案');
  ok(h.includes('活跃度 high'), 'B: 档位徽章 high');
}

// ── 形状 C：mid_full 全链过（③healthy ④neutral）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'mid', sbw: 'none', wash: 'none', path: 'mid_full', version: 'AF1' },
    cheatCheck: { status: 'graded', grade: 'healthy', cached: false, reasons: [], levels: {}, buckets: { activityLevel: 'mid', stallBurstWave: 'none' } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.66, rule: 'gates_passed' }, dimensions: {}, anchors: {}, model: 'fake', usage: {} },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('③ 作弊 ✅ healthy'), 'C: 层3 healthy');
  ok(h.includes('④ BP 买点 🟡 neutral'), 'C: 层4 neutral');
  ok(h.includes('mid → 照走③全链'), 'C: path 徽章');
  ok(h.includes('作弊盘检测门（第 3 层'), 'C: 作弊卡标题第 3 层');
  ok(h.includes('BP 买入点位门（第 4 层'), 'C: BP 卡标题第 4 层');
  ok(h.includes('因子购买前检查门（第 1 层'), 'C: 因子卡标题第 1 层');
}

// ── 形状 D：burst_exempt（low∧burst 豁免跳过作弊直进 BP）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'assessed', act: 'low', sbw: 'burst', wash: 'none', path: 'burst_exempt', version: 'AF1' },
    cheatCheck: { status: 'skipped_by_act_front', path: 'burst_exempt', act: 'low', sbw: 'burst', version: 'AF1', levels: { stallBurstWave: 1 } },
    buyPoint: { status: 'assessed', passed: true, assessment: { bucket: 'neutral', prob: 0.7, rule: 'gates_passed' }, dimensions: {}, anchors: {}, model: 'fake', usage: {} },
  }, { executed: true, execution_status: 'executed', failure_message: null });
  ok(h.includes('③ 作弊 ⏭ 被活跃度门跳过'), 'D: 层3 作弊被跳过');
  ok(h.includes('burst 豁免 → 跳过③直进④'), 'D: path 徽章');
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
  ok(h.includes('③ 作弊 ✅ healthy'), 'E: 层3 healthy');
  ok(!h.includes('前置活跃度门（第 2 层'), 'E: AF 段缺席卡片不渲染（零痕迹）');
  ok(!h.includes('因子购买前检查门（第 1 层'), 'E: 因子 disabled 卡片不渲染');
}

// ── 形状 F：AF 检测层故障（timeout fail-open 进作弊，cheat unhealthy 拒）──
{
  const h = render({
    signalGate: sgBase, factorCheck: fcPass,
    actFrontGate: { status: 'timeout_fail_open' },
    cheatCheck: { status: 'graded', grade: 'unhealthy', cached: false, reasons: [{ code: 'E_low_activity' }], levels: {}, buckets: { activityLevel: 'low' }, unhealthyGrades: 2 },
  });
  ok(h.includes('前置活跃度门（第 2 层'), 'F: AF 故障卡片渲染');
  ok(h.includes('③ 作弊 🚫 unhealthy'), 'F: 层3 unhealthy 拒');
  ok(h.includes('fail-open 放行进③作弊门全链'), 'F: 故障说明文案');
}

// ── 形状 G：T202 策略库形状——包腿物化后条件表达式+因子 chips 恢复展示（异步）──
(async () => {
  const _fetch = global.fetch;
  const packResp = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {
    id: 'pk1', name: 'trading-standard-v1', version: 3,
    definition: {
      buyLegs: [{ priority: 1, condition: 'tradeCount >= 6 AND currentVsLaunchPct <= 28.5', signalGate: {} }],
      sellLegs: [{ priority: 2, condition: 'profitPercent >= 100' }],
    },
  } }) });
  // G1 物化成功：id enrichment 与引擎组装点同构（buy_0_1 命中），叙事面板源双写
  global.fetch = async (url) => String(url).includes('/api/strategy-library/') ? packResp() : _fetch(url);
  inst.experimentConfig = { strategyId: 'pk1', strategiesConfig: { stats: {} }, strategyResolved: { version: 1 } };
  inst._experimentData = { config: inst.experimentConfig };
  inst._packVersionNote = '';
  await inst._loadStrategyPackLegs();
  const g1buy = inst._getBuyCondition('buy', 'buy_0_1');
  ok(g1buy === 'tradeCount >= 6 AND currentVsLaunchPct <= 28.5', 'G1: 物化后 buy_0_1 命中腿条件');
  ok(inst._getBuyCondition('sell', 'sell_0_2') === 'profitPercent >= 100', 'G1: sell_0_2 命中卖腿条件');
  ok(Array.isArray(inst._experimentData.config.strategiesConfig.buyStrategies), 'G1: 叙事面板源（_experimentData）双写物化');
  ok(inst._packVersionNote.includes('库 v3 ≠ 启动解析 v1'), 'G1: 版本漂移注记（库 v3 ≠ 启动解析 v1）');
  const gh = render({ trendFactors: { tradeCount: 7, currentVsLaunchPct: 10 } });
  ok(gh.includes('买入条件配置'), 'G1: 卡片渲染含买入条件配置行');
  ok(gh.includes('tradeCount = 7.00 >= 6 ✓'), 'G1: 因子 chip 命中（tradeCount=7 过门）');
  ok(gh.includes('currentVsLaunchPct = 10.00 <= 28.5 ✓'), 'G1: 因子 chip 命中（curVs=10 过门）');
  ok(gh.includes('库 v3 ≠ 启动解析 v1'), 'G1: 卡片含版本漂移注记');

  // G2 版本一致：strategyResolved.version 与库同版 → 无漂移注记
  inst.experimentConfig = { strategyId: 'pk1', strategiesConfig: {}, strategyResolved: { version: 3 } };
  inst._packVersionNote = '';
  await inst._loadStrategyPackLegs();
  ok(inst._packVersionNote === '', 'G2: 版本一致无漂移注记');

  // G3 拉取失败降级：不物化不炸、条件区不渲染（页面其余功能不受影响）
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  inst.experimentConfig = { strategyId: 'pk2', strategiesConfig: {} };
  inst._packVersionNote = '';
  await inst._loadStrategyPackLegs();
  ok(!Array.isArray(inst.experimentConfig.strategiesConfig.buyStrategies), 'G3: 失败不物化');
  const g3h = render({ trendFactors: { tradeCount: 7 } });
  ok(!g3h.includes('买入条件配置'), 'G3: 条件配置行不渲染');

  // G4 T242 专属腿停用对齐（2026-11-27 修存量显示缺口，bt-v337 实证）：引擎 _buildStrategyConfig
  // 不组装「绑定类型未激活」的买腿，且腿 id 按过滤后数组编号——页面物化须按
  // strategyResolved.pointTypes.disabledLegs 同款剔除。事故现场：PT72 起 P18 缺省停用，P20 腿
  // 信号 strategyId=buy_17_20 在页面成了 buy_18_20 → 未命中回退首腿，「📋 买入条件配置」
  // 把做市类型票显示成 P1 腿（tradeCount >= 6 …）的条件与因子 chips
  const packT242 = () => ({ ok: true, status: 200, json: async () => ({ success: true, data: {
    id: 'pk3', name: 'trading-standard-v1', version: 58,
    definition: {
      buyLegs: [
        { priority: 1, condition: 'tradeCount >= 6', gmgnCheckCondition: 'gmgnRiskCovered == 0' },
        { priority: 18, condition: 'tokenAgeSec >= 20', pointType: 'famous_participation_pit' }, // 停用专属腿
        { priority: 19, condition: 'tokenAgeSec >= 60', pointType: 'steady_trend_climb' },
        { priority: 20, condition: 'tokenAgeSec >= 3', pointType: 'market_maker_rhythm_pit' },
      ],
      sellLegs: [{ priority: 2, condition: 'profitPercent >= 100' }],
    },
  } }) });
  global.fetch = async () => packT242();
  inst._experimentData = null;
  const auditP18 = { source: 'registry', active: ['steady_trend_climb', 'market_maker_rhythm_pit'], inactive: ['famous_participation_pit'], disabledLegs: [18] };
  inst.experimentConfig = { strategyId: 'pk3', strategiesConfig: {}, strategyResolved: { version: 58, pointTypes: auditP18 } };
  await inst._loadStrategyPackLegs();
  const legsA = inst.experimentConfig.strategiesConfig.buyStrategies;
  ok(legsA.length === 3 && legsA.every((l) => l.priority !== 18), 'G4a 审计停用 P18：该专属腿不物化（引擎同款不组装），其余 3 腿在');
  ok(inst._getBuyCondition('buy', 'buy_2_20') === 'tokenAgeSec >= 3', 'G4a 事故现场反证：P20 腿信号 strategyId=buy_2_20 命中本腿条件（修前未命中回退首腿）');
  ok(inst._getBuyCondition('buy', 'buy_1_19') === 'tokenAgeSec >= 60' && inst._getBuyCondition('buy', 'buy_0_1') === 'tradeCount >= 6', 'G4a P19 / P1 腿 id 同构');
  ok(inst._getGmgnCheckCondition('buy_2_20') === null, 'G4a GMGN 条件查找同受益（本腿无 gmgnCheckCondition=null，不再回落首腿）');
  const g4h = render({ strategyId: 'buy_2_20', trendFactors: { tradeCount: 7, tokenAgeSec: 36.2 } });
  ok(g4h.includes('tokenAgeSec = 36.20 >= 3 ✓') && !g4h.includes('tradeCount = 7.00 >= 6'), 'G4a 卡片级：P20 票「买入条件配置」显示本腿条件与 chips（修前显示 P1 腿）');
  inst.experimentConfig = { strategyId: 'pk3', strategiesConfig: {}, strategyResolved: { version: 58 } };
  await inst._loadStrategyPackLegs();
  ok(inst.experimentConfig.strategiesConfig.buyStrategies.length === 4
    && inst._getBuyCondition('buy', 'buy_3_20') === 'tokenAgeSec >= 3' && inst._getBuyCondition('buy', 'buy_1_18') === 'tokenAgeSec >= 20',
    'G4b 无审计段（T242 前实验=引擎不过滤）：全量物化零变化，P20=buy_3_20');
  inst.experimentConfig = { strategyId: 'pk3', strategiesConfig: {}, strategyResolved: { version: 58, pointTypes: { source: 'registry', active: [], inactive: [], disabledLegs: [] } } };
  await inst._loadStrategyPackLegs();
  ok(inst.experimentConfig.strategiesConfig.buyStrategies.length === 4, 'G4c 审计段在但无停用腿：全量物化');
  global.fetch = _fetch;

  console.log(`\n${failed === 0 ? '✅' : '❌'} 四层展示冒烟：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})();
