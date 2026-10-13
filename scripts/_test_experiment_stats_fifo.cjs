#!/usr/bin/env node
// ExperimentStatsService FIFO tie-breaker 单测（2026-10-13 pr1b 对拍案，零 DB 零网络）
//
// 事故：calculateTokenPnL 排序仅按 created_at——回测虚拟时间下「买入成功点补毕业卖」
// 产生 buy/sell 同 created_at 行；Postgres 同 order key 行序无契约 → FIFO 配对漂移
// （perf16 vs pr1b trades 七字段 bit 一致，stats 却差 1 票胜负 ±0.3 BNB；0xcc4d…7777
// 组 sell/buy 排列翻转实证：sell 先=+74.95%，buy 先=-25.05%）。修复 = executed_at
// （真实执行墙钟）次级键 + id 终极 tie。
// 用法：node scripts/_test_experiment_stats_fifo.cjs
'use strict';

const fs = require('fs');
const path = require('path');
const { ExperimentStatsService } = require('../src/web/services/ExperimentStatsService');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// 绕构造（constructor 取 dbManager.getClient，单测零 DB）
const svc = Object.create(ExperimentStatsService.prototype);

// 0xcc4d…7777 混向同刻组真实形状（perf16/pr1b 2026-10-04T22:18:20 实测行）：
// buy in=0.4 out=31688.0557；sell in=31688.0557 out=0.2998
const TS = '2026-10-04T22:18:20+00:00';
const mkBuy = (exec, id) => ({ token_address: '0xtok', trade_direction: 'buy', trade_status: 'success', input_amount: 0.4, output_amount: 31688.0557, created_at: TS, executed_at: exec, id });
const mkSell = (exec, id) => ({ token_address: '0xtok', trade_direction: 'sell', trade_status: 'success', input_amount: 31688.0557, output_amount: 0.2998, created_at: TS, executed_at: exec, id });

console.log('A. 混向同刻组 FIFO tie-breaker（事故现场 0xcc4d…7777 形状）');
{
  // 业务真序：buy 先执行（买入成功点补毕业卖，executed_at 分差毫秒级）
  const buyFirst = [mkBuy('2026-10-12T19:29:54.417+00:00', 'b1'), mkSell('2026-10-12T19:29:54.420+00:00', 's1')];
  // DB 返回序漂移形状：sell 行先返回（同 created_at 无契约）
  const sellReturnedFirst = [buyFirst[1], buyFirst[0]];

  const p1 = svc.calculateTokenPnL('0xtok', buyFirst);
  const p2 = svc.calculateTokenPnL('0xtok', sellReturnedFirst);
  ok(close(p1.returnRate, p2.returnRate), 'A1 返回序漂移免疫（executed_at tie 恢复执行序）');
  ok(close(p1.returnRate, -25.05), `A2 buy 先=FIFO 正常配对 -25.05%（实际 ${p1.returnRate.toFixed(2)}）`);
  ok(close(p1.remainingCost, 0), 'A2 buy 先：卖空买队列 remainingCost=0');

  // 键序真正参与判定（非恒 buy 先）：executed_at 反序（sell 执行在先）→ 空卖
  const sellExecFirst = [mkBuy('2026-10-12T19:29:54.420+00:00', 'b2'), mkSell('2026-10-12T19:29:54.417+00:00', 's2')];
  const p3 = svc.calculateTokenPnL('0xtok', sellExecFirst);
  ok(close(p3.returnRate, 74.95), `A3 executed_at 决定序（sell 先执行=空卖 +74.95%，实际 ${p3.returnRate.toFixed(2)}）`);
  ok(close(p3.remainingCost, 0.4), 'A3 sell 先：买队列全留 remainingCost=0.4');
}

console.log('B. executed_at 缺失回退（旧行/直写路径）');
{
  // executed_at 全缺 → id 终极 tie：两种返回序结果一致（确定性）
  const a = svc.calculateTokenPnL('0xtok', [mkBuy(null, 'aaa1'), mkSell(null, 'zzz9')]);
  const b = svc.calculateTokenPnL('0xtok', [mkSell(null, 'zzz9'), mkBuy(null, 'aaa1')]);
  ok(close(a.returnRate, b.returnRate), 'B1 executed_at 全缺时 id tie 保持确定（与返回序无关）');
  // 部分缺：缺行走 || 0（不抛错、不 NaN）
  const c = svc.calculateTokenPnL('0xtok', [mkBuy(null, 'a1'), mkSell('2026-10-12T19:29:54.420+00:00', 's1')]);
  ok(Number.isFinite(c.returnRate), 'B2 部分行缺 executed_at 不产生 NaN');
}

console.log('C. 非同刻行为零变化（回归）');
{
  // 不同 created_at 的普通买卖：排序结果与修复前一致（created_at 主键不变）
  const trades = [
    { token_address: '0xreg', trade_direction: 'buy', trade_status: 'success', input_amount: 0.1, output_amount: 100, created_at: '2026-10-01T00:00:00+00:00', executed_at: '2026-10-12T01:00:00+00:00', id: 'x1' },
    { token_address: '0xreg', trade_direction: 'sell', trade_status: 'success', input_amount: 100, output_amount: 0.15, created_at: '2026-10-01T01:00:00+00:00', executed_at: '2026-10-12T00:30:00+00:00', id: 'x2' }, // executed_at 反序，created_at 正序
  ];
  const p = svc.calculateTokenPnL('0xreg', trades);
  ok(close(p.returnRate, 50), `C1 created_at 主序不被 executed_at 干扰（+50%，实际 ${p.returnRate.toFixed(2)}）`);
}

console.log('D. 胜率计数（stats 口径）');
{
  const t1 = svc.calculateTokenPnL('0xw', [
    { token_address: '0xw', trade_direction: 'buy', trade_status: 'success', input_amount: 1, output_amount: 10, created_at: '2026-10-01T00:00:00+00:00', id: 'w1' },
    { token_address: '0xw', trade_direction: 'sell', trade_status: 'success', input_amount: 10, output_amount: 1.2, created_at: '2026-10-01T01:00:00+00:00', id: 'w2' },
  ]);
  const t2 = svc.calculateTokenPnL('0xl', [
    { token_address: '0xl', trade_direction: 'buy', trade_status: 'success', input_amount: 1, output_amount: 10, created_at: '2026-10-02T00:00:00+00:00', id: 'l1' },
    { token_address: '0xl', trade_direction: 'sell', trade_status: 'success', input_amount: 10, output_amount: 0.8, created_at: '2026-10-02T01:00:00+00:00', id: 'l2' },
  ]);
  const s = svc.calculateStatsFromReturns([t1, t2]);
  ok(s.totalTokens === 2 && s.profitCount === 1 && s.lossCount === 1, 'D1 胜/负票计数');
  ok(close(s.winRate, 50), 'D2 胜率 50%');
  ok(close(s.bnbChange, 0), `D2 bnbChange=Σ收-Σ支（实际 ${s.bnbChange}）`);
}

console.log('E. 源码口径防线（排序三级键）');
{
  const src = fs.readFileSync(path.join(__dirname, '../src/web/services/ExperimentStatsService.js'), 'utf8');
  ok(/\.sort\(\(a, b\) =>\s*\n?\s*\(new Date\(a\.created_at \|\| a\.executed_at\) - new Date\(b\.created_at \|\| b\.executed_at\)\) \|\|\s*\n?\s*\(new Date\(a\.executed_at \|\| 0\) - new Date\(b\.executed_at \|\| 0\)\) \|\|\s*\n?\s*String\(a\.id\)\.localeCompare\(String\(b\.id\)\)\)/.test(src),
    'E1 排序比较函数三级键形状（created_at → executed_at → id）');
  ok(src.includes('FIFO 配对顺序随之漂移'), 'E2 事故注释在档（pr1b 对拍案）');
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
