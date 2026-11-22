#!/usr/bin/env node
// 临时冒烟（不进 git）：信号垂直线标注撤 BUY/SELL 文字（2026-11-21 用户裁定：
// 顶部文字挡成交信息）——行为锁：产物无 label 键、颜色/线宽/dash 三态语义保持、
// 同刻 buy 在前排序保持、OBSERVE 行仍排除、窗口外仍剔除。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../src/web/static/js/experiment_signals.js'), 'utf8');

function makeEl() {
  let _html = '', _text = '';
  return {
    tagName: 'div', className: '', style: {}, dataset: {}, children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return _html; }, set innerHTML(v) { _html = String(v); },
    get textContent() { return _text; }, set textContent(v) { _text = String(v); if (_html === '') _html = _text; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, insertBefore() {}, setAttribute() {}, getAttribute: () => null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 50 }),
    closest: () => null, contains: () => false, focus() {}, click() {},
  };
}
global.window = global;
global.document = {
  createElement: () => makeEl(), getElementById: () => makeEl(),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {}, body: makeEl(), documentElement: makeEl(),
};
global.navigator = { clipboard: { writeText: async () => {} } };
global.Chart = function () { return { destroy() {}, update() {}, resize() {}, data: { datasets: [] }, options: {} }; };
global.Chart.register = () => {}; global.Chart.defaults = { plugins: { tooltip: {} }, scales: {} };
global.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
global.requestAnimationFrame = (fn) => setTimeout(fn, 0);
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

eval(src + '\n; global.ExperimentSignals = ExperimentSignals;'); // eval 作用域内类绑定经 global 暴露
const inst = Object.create(ExperimentSignals.prototype);

const T = 1791000000000;
const sigs = [
  { id: 'a', created_at: new Date(T).toISOString(), signal_type: 'SELL', action: 'sell', executed: true },      // 同刻 sell 成交
  { id: 'b', created_at: new Date(T).toISOString(), signal_type: 'BUY', action: 'buy', executed: false },      // 同刻 buy 未成交
  { id: 'c', created_at: new Date(T + 5000).toISOString(), signal_type: 'SELL', action: 'sell', executed: false, execution_status: 'blocked' }, // 拦截靛蓝
  { id: 'd', created_at: new Date(T + 9000).toISOString(), signal_type: 'OBSERVE', action: 'hold' },           // 观察行不画
  { id: 'e', created_at: new Date(T - 9999).toISOString(), signal_type: 'BUY', action: 'buy', executed: true },// 窗口外剔除
];
const out = inst._buildSignalAnnotations(sigs, T, T + 6000);
let fails = 0;
const assert = (c, m) => { console.log(`${c ? '✅' : '❌'} ${m}`); if (!c) fails++; };

assert(out.length === 3, `3 条线（OBSERVE/窗外剔除）：${out.length}`);
assert(out.every(a => !('label' in a)), '全部产物无 label 键（BUY/SELL 文字撤净）');
// 同刻 buy 排前 sell 后（红盖绿旧行为）
const sameT = out.filter(a => a.xMin === T);
assert(sameT[1].borderDash.length === 0 && sameT[1].borderWidth === 3, '同刻 sell 成交=实线 3px 保持');
assert(sameT.length === 2 && sameT[0].borderColor === '#86efac' && sameT[1].borderColor === '#dc2626', '同刻 buy(浅绿) 在前 sell(深红成交) 在后');
const blocked = out.find(a => a.xMin === T + 5000);
assert(blocked && blocked.borderColor === '#6366f1' && blocked.borderDash.join() === '5,5', '拦截靛蓝虚线保持');
process.exit(fails ? 1 : 0);
