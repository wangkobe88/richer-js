// 临时冒烟（不进 git）：⚙️机器钱包标记端到端——stub DOM 加载真实
// experiment_signals.js，stub fetch 返回 arb-bot roster + 本票真实两 bot 的
// ticks 形状，断言 ensureArbBotRoster/_buildArbBotPoints 产出与剔重/排除链。零 DB 零网络。
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
    closest: () => null, contains: () => false, focus() {}, click() {},
  };
  return el;
}
global.window = global;
global.document = {
  createElement: () => makeEl(),
  getElementById: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) {} } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: { datasets: [] }, options: {} }; };
global.Chart.register = () => {};
global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.setInterval = () => 0; global.clearInterval = () => {};

const BOT_A = '0xedcbcc3173a69c86b5c67f75b5656cd70b65399c';
const BOT_B = '0x073c01e779677c6ce5085840794d3647ac183efb';
const FAM_W = '0xaaaa000000000000000000000000000000000001';
const SMART_W = '0xbbbb000000000000000000000000000000000002';
const BOTH_FAM_AND_BOT = '0xcccc000000000000000000000000000000000003'; // famous ∩ 机器 → 归 famous

let fetchCalls = [];
global.fetch = async (url) => {
  fetchCalls.push(url);
  if (url.startsWith('/api/rosters/arb-bot-wallets')) {
    return { ok: true, status: 200, json: async () => ({
      success: true,
      data: {
        wallets: [BOT_A, BOT_B, BOTH_FAM_AND_BOT],
        profiles: {
          [BOT_A]: { tags: ['sandwich_bot'], buyCount: 2792, sellCount: 1612, tokenNum: 1415, winrate: 0.28, realizedProfitUsd: -9050 },
          [BOT_B]: { tags: ['sandwich_bot'], buyCount: 3163, sellCount: 1891, tokenNum: 1598, winrate: 0.23, realizedProfitUsd: -15084 },
          [BOTH_FAM_AND_BOT]: { tags: ['wash_trader'], buyCount: 10, sellCount: 10, tokenNum: 5, winrate: null, realizedProfitUsd: null },
        },
        meta: { source: 'gmgn_wallet_profiles' },
      },
    }) };
  }
  if (url.startsWith('/api/rosters/famous-wallets')) {
    return { ok: true, status: 200, json: async () => ({ success: true, data: { wallets: [FAM_W, BOTH_FAM_AND_BOT], profiles: {} } }) };
  }
  if (url.startsWith('/api/rosters/smart-money-wallets')) {
    return { ok: true, status: 200, json: async () => ({ success: true, data: { wallets: [SMART_W], profiles: {} } }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

eval(src);
const inst = global.experimentSignals;
if (!inst) { console.error('❌ 实例未创建'); process.exit(1); }

let passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.error('  ❌ FAIL: ' + label); }
}

(async () => {
  await inst.ensureArbBotRoster();
  ok(inst._arbBotWallets && inst._arbBotWallets.size === 3, `roster 加载 3 址（实际 ${inst._arbBotWallets && inst._arbBotWallets.size}）`);
  ok(inst._arbBotProfiles && inst._arbBotProfiles[BOT_A].tags[0] === 'sandwich_bot', 'profiles 画像透传（tags）');
  ok(fetchCalls.filter(u => u.startsWith('/api/rosters/arb-bot-wallets')).length === 1, 'roster memoized 恰拉一次');

  // 著名/聪明钱名单就位（排除链原料）
  await inst.ensureFamousRoster();
  await inst.ensureSmartRoster();

  const mk = (sender, type, bnb, usd, t) => ({
    sender_address: sender, trader_address: null, trade_type: type,
    bnb_amount: String(bnb), price_usd: String(usd), block_time: `2026-10-04T06:50:${t}+00:00`,
  });
  const trimmed = [
    mk(BOT_A, 'buy', 0.158, 8.6e-9, '01'),   // 机器买
    mk(BOT_A, 'sell', 0.201, 1.55e-8, '30'), // 机器卖
    mk(BOT_B, 'buy', 0.158, 8.9e-9, '01'),   // 机器买
    mk('0xddd000000000000000000000000000000000004', 'buy', 0.01, 8.8e-9, '02'), // 普通人
    mk(FAM_W, 'buy', 0.05, 8.8e-9, '03'),    // famous（不在机器集）
    mk(BOTH_FAM_AND_BOT, 'buy', 0.05, 8.8e-9, '04'), // famous∩机器 → 归 famous
    mk(BOT_A, 'buy', 0.001, 8.6e-9, '05'),   // 机器但 < MIN_BNB → 不标
  ];
  const marks = inst._buildArbBotPoints(trimmed);
  ok(marks.buyPoints.length === 2, `机器买 2 点（实际 ${marks.buyPoints.length}）`);
  ok(marks.sellPoints.length === 1, `机器卖 1 点（实际 ${marks.sellPoints.length}）`);
  ok(marks.buyPoints.every(p => p._arbbot && p._arbbot.wallet !== BOTH_FAM_AND_BOT), 'famous∩机器行归 famous 不双计');
  const a = marks.buyPoints.find(p => p._arbbot.wallet === BOT_A);
  ok(a && a._arbbot.tags.join(',') === 'sandwich_bot', '点位携带画像 tags');
  ok(a && a._arbbot.stats && a._arbbot.stats.tokenNum === 1415, '点位携带 30d 统计（tokenNum）');

  // 失败路径：端点 500 → 空集零标记不抛
  const inst2proto = Object.getPrototypeOf(inst);
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const inst2 = Object.create(inst2proto);
  inst2._arbBotWallets = null; inst2._arbBotProfiles = null; inst2._arbBotRosterPromise = null;
  const w2 = await inst2.ensureArbBotRoster();
  ok(w2 && w2.size === 0, '端点失败 fail-open 空集');
  const marks2 = inst2._buildArbBotPoints(trimmed);
  ok(marks2.buyPoints.length === 0 && marks2.sellPoints.length === 0, '空集=零标记不阻塞');

  console.log(`\n${failed === 0 ? '✅' : '❌'} 机器钱包标记冒烟：${passed} 通过 / ${failed} 失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
