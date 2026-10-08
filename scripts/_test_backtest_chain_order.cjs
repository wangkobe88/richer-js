/**
 * 回测链上真序回放（compareByChainOrder）零 DB 单测
 *
 * 背景（2026-10-08 凑凑 0x8ea2…7777 案，回测 44a198c9）：
 *   原 raw.sort((a,b)=>a.id-b.id) 用 bigserial 分配序回放，而 watcher 延迟落库
 *   （重试/flush 竞态）会让 id 序 ≠ block_time 序：07:45:38 的峰行（usd 9.723e-6）
 *   id=3412243 反而小于 07:45:35 的卖出行 id=3412246。乱序回放把未来 3 秒的峰
 *   提前喂进 FA 价格史，P11（peakProfitPct>=10 AND drawdownFromHighest<=-35）
 *   据此算出 +49% 峰 → -35.19% 回撤提前全清；真实时序该刻峰值仅 +8.7%（<10）
 *   不触发。修复 = 回放排序改链上真序 (block_number, log_index)。
 *
 * 覆盖矩阵：
 *   A. 比较函数：block_number 主序 / 同 block log_index 次序 / id tie-breaker
 *   B. 凑凑案形状复现：id 序与链序交叉的 raw 数组 → sort 后回放序=链上序
 *   C. 多 token 混排：不同 token 行交织时全局链序仍严格（跨 token 可比）
 *   D. 源码口径：raw.sort(compareByChainOrder) 已接线、旧 id 排序已移除、
 *      compareByChainOrder 已导出、block_time 倒退检测（tsRegressions）存在
 *
 * 零 DB：纯函数矩阵 + 源码字符串断言（项目既有「源码口径」风格）。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ENGINE_PATH = path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js');
const { compareByChainOrder } = require('../src/trading-engine/implementations/BacktestEngine');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; console.log(`  ✓ ${msg}`); }

// ==================== A. 比较函数矩阵 ====================
console.log('\n[A] 比较函数矩阵');

ok(compareByChainOrder({ block_number: 100, log_index: 5, id: 9 }, { block_number: 101, log_index: 0, id: 1 }) < 0,
  'block_number 主序：block 100 < 101（id 相反也不影响）');
ok(compareByChainOrder({ block_number: 100, log_index: 7, id: 9 }, { block_number: 100, log_index: 3, id: 1 }) > 0,
  '同 block：log_index 次序（id 相反也不影响）');
ok(compareByChainOrder({ block_number: 100, log_index: 5, id: 2 }, { block_number: 100, log_index: 5, id: 8 }) < 0,
  '同 block 同 log_index：id tie-breaker（理论不出现，仅保证确定性）');
ok(compareByChainOrder({ block_number: 100, log_index: 5, id: 1 }, { block_number: 100, log_index: 5, id: 1 }) === 0,
  '全同 → 0');

// ==================== B. 凑凑案形状复现 ====================
console.log('\n[B] 凑凑案形状：id 序与链序交叉');

// 实测行形（id / block_time / block_number 单调性还原）：38s 峰行的 block_number
// 大于 35s 行（链上 38s 在后），但 id 反小。此处用相对 block_number 复现。
const raw = [
  { id: 3412232, block_number: 125638570, log_index: 210, block_time: '2026-10-04T07:45:37', price_usd: 6.392e-6 },
  { id: 3412243, block_number: 125638573, log_index: 180, block_time: '2026-10-04T07:45:38', price_usd: 9.723e-6 },  // 未来峰，id 反小
  { id: 3412245, block_number: 125638573, log_index: 182, block_time: '2026-10-04T07:45:38', price_usd: 9.704e-6 },
  { id: 3412246, block_number: 125638571, log_index: 90,  block_time: '2026-10-04T07:45:35', price_usd: 6.302e-6 },  // 卖出评估 tick，id 更大
  { id: 3412248, block_number: 125638575, log_index: 10,  block_time: '2026-10-04T07:45:39', price_usd: 1.056e-5 },
];
raw.sort(compareByChainOrder);
ok(raw.map(r => r.id).join(',') === '3412232,3412246,3412243,3412245,3412248',
  `排序后按链序回放：35s 行(3412246)先于 38s 峰行(3412243)——得到 [${raw.map(r => r.id).join(',')}]`);
ok(raw.every((r, i) => i === 0 || r.block_number >= raw[i - 1].block_number),
  '排序后 block_number 非递减');

// id 序回放（旧口径）的反证：id 序会把 3412243 排在 3412246 前
const byId = [...raw].sort((a, b) => a.id - b.id);
ok(byId.findIndex(r => r.id === 3412243) < byId.findIndex(r => r.id === 3412246),
  '反证：id 序下峰行(3412243)先于卖出行(3412246)——旧口径前视形状成立');

// ==================== C. 多 token 混排 ====================
console.log('\n[C] 多 token 混排：跨 token 全局链序');

const mixed = [
  { id: 10, token: 'B', block_number: 200, log_index: 50 },
  { id: 11, token: 'A', block_number: 199, log_index: 99 },
  { id: 12, token: 'A', block_number: 200, log_index: 49 },
  { id: 13, token: 'B', block_number: 200, log_index: 51 },
  { id: 14, token: 'A', block_number: 198, log_index: 1 },
];
mixed.sort(compareByChainOrder);
ok(mixed.map(r => r.id).join(',') === '14,11,12,10,13',
  `不同 token 行交织：全局 (block_number, log_index) 严格序 [${mixed.map(r => `${r.id}(${r.block_number}/${r.log_index})`).join(' ')}]`);
// 同 block 内 token A log 49 排在 token B log 50 前（区块内日志序，跨 token 无关紧要只需全序）
ok(mixed[2].id === 12 && mixed[3].id === 10, '同 block 内按 log_index 定序（A:49 < B:50）');

// ==================== D. 源码口径 ====================
console.log('\n[D] 源码口径');

const src = fs.readFileSync(ENGINE_PATH, 'utf8');
ok(src.includes('raw.sort(compareByChainOrder)'),
  '装载排序已接线 raw.sort(compareByChainOrder)');
ok(!src.includes('raw.sort((a, b) => a.id - b.id)'),
  '旧 id 排序已移除（不再出现 raw.sort((a, b) => a.id - b.id)）');
ok(/module\.exports\s*=\s*\{\s*BacktestEngine,\s*compareByChainOrder\s*\}/.test(src),
  'compareByChainOrder 随模块导出（单测与装载共用同一实现）');
ok(src.includes('tsRegressions'),
  'block_time 倒退检测存在（链序下 timestamp 应单调，倒退=WARN 留痕）');
ok(src.includes('compareByChainOrder(a, b)'),
  '比较函数定义存在于引擎文件（单一事实源）');

console.log(`\n全部通过：${passed} 断言`);
