#!/usr/bin/env node
// 临时冒烟（本地真实 API，不进 git）：signal-stats 涨幅补全补丁端到端验证——
// stub 最小 DOM 加载真实 experiment_signal_stats.js，fetch 走 localhost:3010
// 真实接口（含新 POST /api/tokens/profiles），断言：
// A. 铁匠 0x39ed…7777 maxChange 补到 1050.7 非 null、symbol=铁匠（信号行兜底）
// B. 按 maxChange desc 排序后进前排（null 沉底不复发）
// C. renderTableRow 产出 +1050.72% 与 symbol 文本
const fs = require('fs');
const path = require('path');

// ── 最小浏览器环境 stub（signals 五层冒烟同款） ──
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
global.location = { pathname: '/experiment/9e9163de-a677-4d39-9c33-9ec9df05e400/signal-stats', origin: 'http://localhost:3010' };
global.document = {
  createElement: () => makeEl(),
  getElementById: () => makeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener(type, fn) { if (type === 'DOMContentLoaded') { try { fn(); } catch (e) { console.error('DOMContentLoaded 异常:', e); process.exit(1); } } },
  removeEventListener() {},
  body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.alert = () => {};
global.confirm = () => true;
const realFetch = global.fetch;
global.fetch = (input, init) => realFetch(String(input).startsWith('http') ? String(input) : 'http://localhost:3010' + String(input), init);
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const ADDR = '0x39ed13ccb5e067b7fce459548501cf2659287777';
let fails = 0;
const assert = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) fails++; };

(async () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/web/static/js/experiment_signal_stats.js'), 'utf8');
  eval(src); // 顶层级定义 ExperimentSignalStats + DOMContentLoaded 自动实例化

  // 等 loadData 完成：聚合+补全都在其内 await，最终态=目标票 maxChange 非 null
  //（或超时落败由断言接住）
  const inst = () => global.window.experimentSignalStats;
  for (let i = 0; i < 120; i++) {
    const s = inst();
    const st = s && s.tokenStats && s.tokenStats.find(t => t.tokenAddress === ADDR);
    if (s && s.tokenStats && s.tokenStats.length && s.signalsData && st && st.maxChange != null) break;
    await new Promise(r => setTimeout(r, 500));
  }
  const s = inst();
  if (!s || !s.tokenStats || !s.tokenStats.length) { console.error('❌ loadData 未完成'); process.exit(1); }

  console.log(`tokenStats=${s.tokenStats.length} 信号=${s.signalsData.length}`);
  const stat = s.tokenStats.find(t => t.tokenAddress === ADDR);
  assert(!!stat, `铁匠在 tokenStats（此前按信号聚合就在）`);
  assert(stat && stat.maxChange !== null && stat.maxChange !== undefined, `maxChange 补全非 null（值=${stat && stat.maxChange}）`);
  assert(stat && Math.abs((stat.maxChange || 0) - 1050.71772395862) < 0.01, `maxChange≈1050.72（token_profiles 值）`);
  assert(stat && stat.symbol === '铁匠', `symbol=铁匠（信号行兜底，非 Unknown）`);

  // 补全前的 null 票总数（打印口径）
  const nullCnt = s.tokenStats.filter(t => t.maxChange === null || t.maxChange === undefined).length;
  console.log(`补全后仍 null（无 profile 行/正常）：${nullCnt}/${s.tokenStats.length}`);

  // B. 排序行为：模拟点「最高涨幅」列
  s.sortField = 'maxChange'; s.sortOrder = 'desc'; s.applyFilterAndSort();
  const idx = s.filteredStats.findIndex(t => t.tokenAddress === ADDR);
  assert(idx >= 0 && idx < 50, `maxChange desc 排序第 ${idx + 1} 位（第 1 页可见）`);

  // C. 渲染
  const row = s.renderTableRow(stat);
  assert(row.includes('+1050.72%'), `行渲染含 +1050.72%`);
  assert(row.includes('铁匠'), `行渲染含 symbol 铁匠`);

  // 回归：默认排序路径不炸
  s.sortField = 'buySignals'; s.sortOrder = 'desc'; s.applyFilterAndSort();
  assert(true, '默认排序路径无异常');

  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
