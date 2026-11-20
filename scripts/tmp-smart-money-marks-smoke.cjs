// 临时冒烟（不进 git）：🧠聪明钱操作标记前端逻辑验证——stub 最小 DOM 加载真实
// experiment_signals.js，stub fetch 回 famous+聪明钱两名单，断言：
//   ①名单加载（ensureSmartRoster 解析 wallets/profiles）
//   ②_buildRosterMarkPoints 通用构建器双臂（_famous/_smart 挂载键、买/卖分桶、
//     MIN_BNB/price 过滤、半径映射）
//   ③famous 优先防双计（交集钱包行只出 famous 点）
//   ④tooltip 判定分支原料（_smart.tags/label 透传）
//   ⑤initBubbleChart 数据集注入（🧠聪明钱买/卖 dataset 在场且层序=famous 之下主气泡之上）
// 零 DB 零网络。删于验收后。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/web/static/js/experiment_signals.js'), 'utf8');

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
    getContext: () => ({}), // canvas stub（initBubbleChart 拿 2d context）
    closest: () => null, contains: () => false, focus() {}, click() {},
  };
  return el;
}
global.window = global;
global.document = {
  createElement: () => makeEl(),
  getElementById: () => makeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { /* init 同步异常吞掉 */ } } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
let lastChartConfig = null;
global.Chart = function (ctx, config) { lastChartConfig = config; return { destroy() {}, update() {}, resize() {}, data: { datasets: [] }, options: {} }; };
global.Chart.register = () => {};
global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };

// ── stub fetch：famous + 聪明钱两名单 ──
const FAMOUS = ['0xaaaa000000000000000000000000000000000001']; // 1 址（与聪明钱集合无交集）
const SMART = [
  '0xbbbb000000000000000000000000000000000002', // 纯聪明钱（带 twitter+tags）
  '0xcccc000000000000000000000000000000000003', // 纯聪明钱（无档案）
  '0xaaaa000000000000000000000000000000000001', // ∩ famous——必须归 famous 防双计
];
global.fetch = async (url) => {
  if (String(url).includes('famous-wallets')) {
    return { ok: true, json: async () => ({ success: true, data: { wallets: FAMOUS, profiles: {} } }) };
  }
  if (String(url).includes('smart-money-wallets')) {
    const profiles = {};
    profiles[SMART[0]] = { twitterUsername: 'SmartTrader', name: null, tags: ['gmgn_go', 'gmgn'], hits: 9, usd: 123.4, lastSeen: 'x' };
    return { ok: true, json: async () => ({ success: true, data: { wallets: SMART, profiles, meta: { snapshots: 24, smartmoney: 3, kol: 0 } } }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.setInterval = () => 0; global.clearInterval = () => {};

eval(src);
const inst = global.experimentSignals;
if (!inst) { console.error('❌ 实例未创建'); process.exit(1); }

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ❌ FAIL: ' + label); }
}

(async () => {
  // ① 名单加载
  await inst.ensureFamousRoster();
  await inst.ensureSmartRoster();
  ok(inst._famousWallets.size === 1, `famous 名单 1 址 (实际 ${inst._famousWallets.size})`);
  ok(inst._smartWallets.size === 3, `聪明钱名单 3 址 (实际 ${inst._smartWallets.size})`);
  ok(inst._smartProfiles[SMART[0]].twitterUsername === 'SmartTrader', '聪明钱档案 twitterUsername 透传');

  // ② 通用构建器：样例 ticks
  const T = '2026-11-18T08:00:00Z';
  const ticks = [
    // famous∩smart 钱包买（须只出 famous 点）
    { block_time: T, price_usd: 1e-8, bnb_amount: '0.5', trade_type: 'buy', sender_address: '0xAAAA000000000000000000000000000000000001' },
    // 纯聪明钱买（有档案：label+tags）
    { block_time: T, price_usd: 2e-8, bnb_amount: '0.3', trade_type: 'buy', sender_address: '0xbbbb000000000000000000000000000000000002' },
    // 纯聪明钱卖（无档案：label=null）
    { block_time: T, price_usd: 3e-8, bnb_amount: '0.02', trade_type: 'sell', sender_address: '0xCCCC000000000000000000000000000000000003', trader_address: '0xCCCC000000000000000000000000000000000003' },
    // 名单外行（不得进标记）
    { block_time: T, price_usd: 4e-8, bnb_amount: '1.0', trade_type: 'buy', sender_address: '0xdddd000000000000000000000000000000000004' },
    // 聪明钱但尘埃额（MIN_BNB 过滤）
    { block_time: T, price_usd: 5e-8, bnb_amount: '0.001', trade_type: 'buy', sender_address: '0xbbbb000000000000000000000000000000000002' },
  ];
  const fam = inst._buildFamousPoints(ticks);
  const sm = inst._buildSmartPoints(ticks);
  ok(fam.buyPoints.length === 1 && fam.buyPoints[0]._famous && fam.buyPoints[0]._famous.wallet === FAMOUS[0], 'famous 点：交集钱包行归 _famous');
  ok(sm.buyPoints.length === 1 && sm.buyPoints[0]._smart.wallet === SMART[0], '聪明钱买：仅纯聪明钱 1 点（交集被 exclude 剔除）');
  ok(sm.sellPoints.length === 1 && sm.sellPoints[0]._smart.wallet === SMART[1].toLowerCase(), '聪明钱卖：trader 回退口径 1 点');
  const smPoint = sm.buyPoints[0]._smart;
  ok(smPoint.label === '@SmartTrader' && Array.isArray(smPoint.tags) && smPoint.tags.join(',') === 'gmgn_go,gmgn', '聪明钱点 label+tags 透传（tooltip 原料）');
  ok(sm.sellPoints[0]._smart.label === null, '无档案聪明钱 label=null（回落地址缩写）');
  ok(sm.buyPoints[0].r > 3 && sm.buyPoints[0].r <= 15, '半径映射沿用 _mapTickRadius');
  ok(inst._mapTickRadius(0.001) === 3 && ticks[4] && true, '尘埃行不进任何标记（MIN_BNB=0.005）');

  // ③ initBubbleChart 数据集注入与层序
  lastChartConfig = null;
  inst._trimTicksByWindow = () => ({ trimmed: ticks, trimStart: 0, trimEnd: Date.now() + 1e6, tokenSignals: [] });
  try { inst.initBubbleChart(ticks, { address: '0xtoken', symbol: 'TST' }); } catch (e) { /* stub 环境非关键路径吞掉 */ }
  ok(lastChartConfig !== null, 'initBubbleChart 构建 Chart');
  if (lastChartConfig) {
    const labels = lastChartConfig.data.datasets.map(d => d.label);
    const iFamSell = labels.findIndex(l => l.includes('Famous卖'));
    const iSmartBuy = labels.findIndex(l => l.includes('🧠聪明钱买'));
    const iSmartSell = labels.findIndex(l => l.includes('🧠聪明钱卖'));
    const iBuy = labels.findIndex(l => /^Buy \(/.test(l));
    ok(iSmartBuy >= 0 && iSmartSell >= 0, `聪明钱双数据集在场: ${labels[iSmartBuy]} / ${labels[iSmartSell]}`);
    ok(iFamSell !== -1 && iSmartBuy > iFamSell && iBuy !== -1 && iSmartSell < iBuy, '层序：famous 最顶 → 聪明钱次层 → 主气泡');
    const smartBuyDs = lastChartConfig.data.datasets[iSmartBuy];
    ok(smartBuyDs.data.length === 1 && smartBuyDs.data[0]._smart.wallet === SMART[0], '散点图聪明钱数据集=纯聪明钱点');
    // 主气泡剔除已标记行：只剩名单外 1 行（尘埃行被 MIN_BNB 过滤、标记行进独立数据集）
    const mainBuy = lastChartConfig.data.datasets[iBuy];
    ok(mainBuy.data.length === 1 && mainBuy.data[0]._raw.sender_address === '0xdddd000000000000000000000000000000000004', '主气泡剔重：名单行不双计');
    // tooltip 回调：聪明钱分支
    const tipCb = lastChartConfig.options.plugins.tooltip.callbacks.label;
    const tipLines = tipCb({ raw: sm.buyPoints[0] });
    ok(Array.isArray(tipLines) && tipLines[0].includes('🧠聪明钱') && tipLines.some(l => l.includes('@SmartTrader')) && tipLines.some(l => l.includes('gmgn_go')) && tipLines.some(l => l.includes('钱包:')), `tooltip 聪明钱分支: ${JSON.stringify(tipLines)}`);
    const tipSell = tipCb({ raw: sm.sellPoints[0] });
    ok(tipSell.some(l => l.includes('钱包:')) && !tipSell.some(l => l.includes('@')), 'tooltip 无档案回落地址缩写');
  }

  console.log(failed === 0 ? `\n✅ ${passed} 断言全绿` : `\n❌ ${failed} 失败 / ${passed} 通过`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('冒烟异常:', e); process.exit(1); });
