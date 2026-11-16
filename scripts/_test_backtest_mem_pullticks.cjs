#!/usr/bin/env node
// T148b 回测门链内存拉数单测（2026-11-16 前视+性能双修事故）：
// ①形状契约（服务端 Array.isArray(mem.rows)——首版裸数组=恒 miss 根因）
// ②anchorMs as-of 截窗（前视防线——服务端漏传=全窗口行含未来 ticks）
// ③tail 帽+head 补（DB 路径逐位一致）
// ④服务端锚透传源码锁
// 零 DB 零网络。用法：node scripts/_test_backtest_mem_pullticks.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const { memPullTicksFromIndex } = require(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'));

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { passed++; console.log(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

// 构造索引行（block_time ISO 升序=链上真序）
const T0 = Date.UTC(2026, 10, 2, 6, 0, 0);
const row = (i) => ({
  block_number: 100 + i, log_index: 0,
  block_time: new Date(T0 + i * 1000).toISOString(),
  token_address: '0xa', trade_type: 'buy', bnb_amount: 0.01,
});
const idx = new Map([['0xa', Array.from({ length: 5000 }, (_, i) => row(i))]]);

console.log('A. 形状契约（首版裸数组=服务端恒 miss→600ms sleep+DB 查询/次=50min 根因）');
ok('A1 返回对象 {rows,anchorTickCount,capped}（Array.isArray(mem.rows) 契约）', () => {
  const m = memPullTicksFromIndex(idx, '0xA', T0 + 100 * 1000); // 大写归一
  assert.ok(Array.isArray(m.rows) && m.rows.length > 0);
  assert.strictEqual(typeof m.anchorTickCount, 'number');
  assert.strictEqual(typeof m.capped, 'boolean');
});
ok('A2 空票/缺索引 → 空对象形状（非裸数组）', () => {
  const m1 = memPullTicksFromIndex(idx, '0xmissing', T0);
  const m2 = memPullTicksFromIndex(null, '0xa', T0);
  for (const m of [m1, m2]) { assert.ok(Array.isArray(m.rows) && m.rows.length === 0 && m.capped === false); }
});

console.log('B. anchorMs as-of 截窗（前视防线）');
ok('B1 锚=第 100 行时刻 → 恰 100 行（未来行不吃进）', () => {
  const m = memPullTicksFromIndex(idx, '0xa', T0 + 100 * 1000);
  assert.strictEqual(m.rows.length, 101); // ≤ 锚含锚行
  assert.strictEqual(m.rows[100].block_time, new Date(T0 + 100 * 1000).toISOString());
});
ok('B2 锚早于首行 → 0 行', () => {
  const m = memPullTicksFromIndex(idx, '0xa', T0 - 1000);
  assert.strictEqual(m.rows.length, 0);
});
ok('B3 无锚=全量防御形状（超帽也走 tail+head=3300，与 DB 路径一致）', () => {
  const m = memPullTicksFromIndex(idx, '0xa', null);
  assert.strictEqual(m.rows.length, 3300); // 5000 超帽 → tail3000+head300 去重（无重叠）
});

console.log('C. tail 帽 + head 补（DB 路径逐位一致：pullLimit 3000/headLimit 300）');
ok('C1 全量 5000 行 → tail 3000 + head 300，capped=true，anchorTickCount=3000', () => {
  const m = memPullTicksFromIndex(idx, '0xa', T0 + 4999 * 1000);
  assert.strictEqual(m.anchorTickCount, 3000);
  assert.strictEqual(m.capped, true);
  assert.strictEqual(m.rows.length, 3300); // head(300)+tail(3000) 无重叠
  assert.strictEqual(m.rows[0].block_number, 100);          // head=最早首段
  assert.strictEqual(m.rows[300].block_number, 100 + 2000); // tail 起点=第 2000 行
});
ok('C2 未满帽（≤3000）→ capped=false 全量', () => {
  const small = new Map([['0xb', Array.from({ length: 250 }, (_, i) => row(i))]]);
  const m = memPullTicksFromIndex(small, '0xb', T0 + 300 * 1000);
  assert.strictEqual(m.rows.length, 250);
  assert.strictEqual(m.capped, false);
  assert.strictEqual(m.anchorTickCount, 250);
});

console.log('D. 服务端锚透传源码锁（两服务 pullMem(token, anchorMs)——漏传=全窗前视）');
ok('D1 CheatCheckService 锚透传', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/market-analysis/CheatCheckService.js'), 'utf8');
  assert.ok(src.includes('await pullMem(token, anchorMs)'), '锚漏传回归');
});
ok('D2 BuyPointCheckService 锚透传', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/market-analysis/BuyPointCheckService.js'), 'utf8');
  assert.ok(src.includes('await pullMem(token, anchorMs)'), '锚漏传回归');
});
ok('D3 引擎注入走 memPullTicksFromIndex 单一真相源', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/trading-engine/implementations/BacktestEngine.js'), 'utf8');
  assert.ok(src.includes('memPullTicksFromIndex(this._tokenTickIndex'), '内联闭包回归');
});

console.log(`\n结果: ${passed} 断言`);
