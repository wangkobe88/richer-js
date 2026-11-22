// 临时冒烟（不进 git）：token-ticks 页 famous/聪明钱标记——stub 最小 DOM 加载真实
// token-ticks.js，fetch 回放真实名单/_ticks 数据（/tmp 下拉取件），断言气泡图与
// K 线图数据集形状。零 DB 零网络。
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../src/web/static/js/token-ticks.js'), 'utf8');
const ticksDoc = JSON.parse(fs.readFileSync('/tmp/ticks.json', 'utf8'));
const famDoc = JSON.parse(fs.readFileSync('/tmp/fam.json', 'utf8'));
const smDoc = JSON.parse(fs.readFileSync('/tmp/sm.json', 'utf8'));

// ── 最小浏览器环境 stub（shape 对齐 tmp-signals-five-layer-smoke.cjs）──
function makeEl() {
  let _html = '';
  let _text = '';
  const el = {
    tagName: 'div', className: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {}, children: [], value: '',
    get innerHTML() { return _html; },
    set innerHTML(v) { _html = String(v); },
    get textContent() { return _text; },
    set textContent(v) { _text = String(v); if (_html === '') _html = _text; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    getContext: () => ({}),
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 50 }),
    closest: () => null, contains: () => false, focus() {}, click() {},
  };
  return el;
}
global.window = global;
global.location = { search: '?token=0xa6bb58abc41e6f1e6c104e765e4976bfbcb77777' };
global.history = { replaceState() {} };
global.document = {
  createElement: () => makeEl(),
  getElementById: () => makeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { /* 吞构造同步异常 */ } } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.addEventListener = (type, fn) => { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { /* 吞构造同步异常 */ } } };
global.removeEventListener = () => {};

// Chart 桩：记录每次 new Chart 的 config（datasets 形状断言用）
const chartCalls = [];
global.Chart = function (ctx, config) {
  chartCalls.push({ ctx: String(ctx), config });
  return {
    destroy() {}, update() {}, resize() {},
    data: (config && config.data) || { datasets: [] },
    options: (config && config.options) || {},
  };
};
global.Chart.register = () => {};
global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };

global.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('/api/rosters/famous-wallets')) return { ok: true, json: async () => famDoc };
  if (u.startsWith('/api/rosters/smart-money-wallets')) return { ok: true, json: async () => smDoc };
  if (u.startsWith('/api/buy-point-sets')) return { ok: true, json: async () => ({ success: true, data: [] }) };
  if (u.startsWith('/api/token-ticks/info')) return { ok: true, json: async () => ({ success: true, data: null }) };
  if (u.startsWith('/api/ticks')) return { ok: true, json: async () => ticksDoc };
  return { ok: false, status: 404, json: async () => ({}) };
};
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.setInterval = () => 0; global.clearInterval = () => {};

eval(src); // 尾部 DOMContentLoaded → new TokenTicksPage()（constructor 内 init() 异步）

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ❌ FAIL: ' + label); }
}

(async () => {
  await new Promise(r => setTimeout(r, 200)); // 等 init() 全链路（名单→BP→图表→表格）

  // 实例捕获：DOMContentLoaded 闭包内 new，instance 挂不到全局——经 chartCalls 反查即可，
  // 另从 src 尾部改挂不入侵；直接断言图表调用形状。
  const bubble = chartCalls.find(c => c.config.type === 'bubble');
  const candle = chartCalls.find(c => c.config.type === 'candlestick');
  ok(bubble != null, '气泡图已创建');
  ok(candle != null, 'K 线图已创建');

  // ① 气泡图：四个名单数据集在场、计数正确（数据侧预算 = famous 0/0、聪明钱 1/1）
  const ds = (bubble && bubble.config.data.datasets) || [];
  const labelOf = (d) => d.label || '';
  const famBuy = ds.find(d => labelOf(d).includes('⭐Famous买'));
  const famSell = ds.find(d => labelOf(d).includes('⭐Famous卖'));
  const smBuy = ds.find(d => labelOf(d).includes('🧠聪明钱买'));
  const smSell = ds.find(d => labelOf(d).includes('🧠聪明钱卖'));
  ok(!!famBuy && !!famSell && !!smBuy && !!smSell, '气泡图四个名单数据集在场');
  ok(famBuy && famBuy.label === '⭐Famous买 (0)', `Famous买计数=0（实际 ${famBuy && famBuy.label}）`);
  ok(smBuy && smBuy.label === '🧠聪明钱买 (1)', `聪明钱买计数=1（实际 ${smBuy && smBuy.label}）`);
  ok(smSell && smSell.label === '🧠聪明钱卖 (1)', `聪明钱卖计数=1（实际 ${smSell && smSell.label}）`);

  // ② 点位形状：_smart 挂载键 + wallet/bnb/tradeType 字段
  const smPt = smBuy && smBuy.data && smBuy.data[0];
  ok(smPt && smPt._smart && /^0x[0-9a-f]{40}$/.test(smPt._smart.wallet) && smPt._smart.bnb > 0 && smPt._smart.tradeType === '买',
    '聪明钱点位带 _smart{wallet,bnb,tradeType}');

  // ③ 层序：名单标记 → BP → 主 Buy/Sell（倒序绘制=靠前叠上层）
  const idxFam = ds.indexOf(famBuy), idxBuy = ds.findIndex(d => labelOf(d).startsWith('Buy ('));
  ok(idxFam !== -1 && idxBuy !== -1 && idxFam < idxBuy, '名单数据集排在主气泡之前');

  // ④ 主气泡剔重：合格 ticks 总数 = 主 Buy+Sell + 名单标记数（无双计）
  const MIN_BNB = 0.005;
  const qualifying = ticksDoc.data.filter(t => {
    const bnb = parseFloat(t.bnb_amount) || 0;
    const p = parseFloat(t.price_usd);
    return bnb >= MIN_BNB && p > 0;
  }).length;
  const mainBuy = ds.find(d => /^Buy \(/.test(labelOf(d)));
  const mainSell = ds.find(d => /^Sell \(/.test(labelOf(d)));
  const mainCount = (mainBuy ? mainBuy.data.length : -1) + (mainSell ? mainSell.data.length : -1);
  const markCount = (famBuy.data.length + famSell.data.length + smBuy.data.length + smSell.data.length);
  ok(mainCount + markCount === qualifying, `主气泡剔重守恒：主 ${mainCount} + 标记 ${markCount} = 合格 ${qualifying}`);

  // ⑤ K 线图：unshift 后 roster 四数据集在 OHLC 之前（叠上层）
  const cds = (candle && candle.config.data.datasets) || [];
  ok(cds.length >= 5 && cds.slice(0, 4).every(d => labelOf(d).includes('Famous') || labelOf(d).includes('聪明钱')),
    `K 线图前四数据集=名单标记（实际 ${cds.slice(0, 4).map(labelOf).join(' / ')}）`);
  ok(cds[4] && labelOf(cds[4]) === 'OHLC(USD)', 'K 线图 OHLC 本体在名单标记之后');
  const cSmBuy = cds.find(d => labelOf(d).includes('🧠聪明钱买'));
  ok(cSmBuy && cSmBuy.type === 'scatter' && cSmBuy.pointStyle === 'triangle' && cSmBuy.pointRadius === 8,
    'K 线聪明钱标记=triangle scatter pointRadius 8');

  // ⑥ tooltip 分支：K 线 label 回调对 _smart 点位产聪明钱文案、对 OHLC 行保持原输出
  const candleLabel = candle && candle.config.options.plugins.tooltip.callbacks.label;
  const candleTitle = candle && candle.config.options.plugins.tooltip.callbacks.title;
  const smLines = candleLabel && candleLabel({ raw: smPt });
  ok(Array.isArray(smLines) && smLines[0].startsWith('🧠聪明钱 买') && smLines.some(l => l.startsWith('钱包: ')),
    `K 线 tooltip 聪明钱分支（${smLines && smLines[0]}）`);
  const ohlcLines = candleLabel && candleLabel({ raw: { x: 1, o: 1, h: 2, l: 0.5, c: 1.5, blockSeq: 3 } });
  ok(Array.isArray(ohlcLines) && ohlcLines[0].includes('O $') && ohlcLines[0].includes('H $'), 'K 线 tooltip OHLC 分支不变');
  const titleNoSeq = candleTitle && candleTitle([{ raw: { x: 1700000000000 } }]);
  ok(!String(titleNoSeq).includes('undefined'), `无 blockSeq 点位标题不冒充（${titleNoSeq}）`);

  // ⑦ 气泡图 tooltip 聪明钱分支
  const bubbleLabel = bubble && bubble.config.options.plugins.tooltip.callbacks.label;
  const bLines = bubbleLabel && bubbleLabel({ raw: smPt });
  ok(Array.isArray(bLines) && bLines[0].startsWith('🧠聪明钱 买') && bLines.some(l => l.startsWith('Price: $')),
    '气泡图 tooltip 聪明钱分支');

  console.log(`\n${passed}/${passed + failed}`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('冒烟异常:', e); process.exit(1); });
