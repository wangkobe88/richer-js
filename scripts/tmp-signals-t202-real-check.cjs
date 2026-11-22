// 临时验证（不进 git）：T202 策略包腿物化 → 真实信号卡片渲染端到端。
// 数据源=本地 web API（真实实验 bt-v164 + 真实策略包 + 真实信号 metadata），
// 渲染走真实 experiment_signals.js createSignalCard（stub 最小 DOM，同冒烟脚本）。
const fs = require('fs');
const path = require('path');

const EXP = process.argv[2] || '9e9163de-a677-4d39-9c33-9ec9df05e400';
const TOKEN = process.argv[3] || '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';

// ── 最小浏览器环境 stub（复用 tmp-signals-five-layer-smoke.cjs 形状）──
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
  getElementById: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  // 同冒烟脚本：DOMContentLoaded 同步触发并吞 init 异常（实例已赋值即可）
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { /* 吞 */ } } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: { datasets: [] }, options: {} }; };
global.Chart.register = () => {};
global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };
global.location = { pathname: `/experiment/${EXP}/signals`, search: `?token=${TOKEN}`, hash: '' };
const realFetch = global.fetch; // node 原生 fetch（stub 覆盖前保存，主流程真实请求用）
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.setInterval = () => 0; global.clearInterval = () => {};

const src = fs.readFileSync(path.join(__dirname, '../src/web/static/js/experiment_signals.js'), 'utf8');
eval(src);
const inst = global.experimentSignals;
if (!inst) { console.error('❌ 实例未创建'); process.exit(1); }

let failed = 0;
function ok(cond, label) {
  if (cond) console.log('  ✓ ' + label);
  else { failed++; console.error('  ❌ FAIL: ' + label); }
}

(async () => {
  const base = 'http://localhost:3010';
  // 1. 真实实验 config
  const expResp = await (await realFetch(`${base}/api/experiment/${EXP}`)).json();
  const cfg = typeof expResp.data.config === 'string' ? JSON.parse(expResp.data.config) : expResp.data.config;
  ok(!!cfg.strategyId && !Array.isArray(cfg.strategiesConfig?.buyStrategies), `实验为 T202 形状（strategyId=${cfg.strategyId.slice(0, 8)}… 无内嵌腿）`);

  // 2. 走页面同款物化路径（真实 API——页面在浏览器里 fetch 即真；node 原生
  //    fetch 不认相对 URL，包一层拼 base 保持页面代码零改动）
  inst.experimentConfig = cfg;
  inst._experimentData = expResp.data;
  global.fetch = (url, opts) => realFetch(String(url).startsWith('/') ? base + url : url, opts);
  await inst._loadStrategyPackLegs();
  ok(Array.isArray(inst.experimentConfig.strategiesConfig?.buyStrategies), `包腿物化（买${inst.experimentConfig.strategiesConfig.buyStrategies.length}/卖${inst.experimentConfig.strategiesConfig.sellLegs?.length ?? inst.experimentConfig.strategiesConfig.sellStrategies.length} 腿）`);
  ok(inst._packVersionNote === '' || inst._packVersionNote.includes('≠'), `版本漂移注记：'${inst._packVersionNote || '（无漂移）'}'`);

  // 3. 真实信号渲染
  const sigResp = await (await realFetch(`${base}/api/experiment/${EXP}/signals?limit=100&tokenAddress=${TOKEN}`)).json();
  const sigs = sigResp.signals || [];
  ok(sigs.length > 0, `拉到 ${sigs.length} 条该 token 信号`);
  const buy = sigs.find(s => (s.action || '').toUpperCase() === 'BUY');
  if (!buy) { console.error('❌ 无 BUY 信号'); process.exit(1); }
  const cardHtml = inst.createSignalCard(buy);
  const h = cardHtml.innerHTML || '';
  const legId = buy.metadata?.signalGate?.legId || buy.metadata?.strategyId;
  ok(h.includes('买入条件配置'), `卡片渲染含「买入条件配置」（leg=${legId}）`);
  ok(h.includes('因子值:'), '因子 chips 行在场');
  const chipMatches = h.match(/[a-zA-Z_]+ = [-\d.]+ (?:>=|<=|>|<|==) [\d.]+ [✓✗]/g) || [];
  ok(chipMatches.length >= 5, `因子 chip ≥5 枚（实际 ${chipMatches.length}）`);
  console.log('    chips 样例: ' + chipMatches.slice(0, 6).join(' | '));
  const cond = inst._getBuyCondition('buy', legId);
  ok(!!cond && cond.length > 50, `leg 条件串取回（${cond ? cond.length : 0} 字符）`);
  console.log('    条件串: ' + cond.slice(0, 120) + '…');

  console.log(`\n${failed === 0 ? '✅' : '❌'} T202 真实链路验证：${failed === 0 ? '全过' : failed + ' 项失败'}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('❌ 异常:', e); process.exit(1); });
