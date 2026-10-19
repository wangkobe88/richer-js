#!/usr/bin/env node
/**
 * trades 过滤列名单测（2026-10-19 修复 C110 扫描顺带发现的潜伏 bug）
 * ——本地零 DB 零网络（打桩 dbManager/Logger require cache，真模块永不加载）。
 *
 * 事故现场：getTrades 过滤分支误写列名 'direction'（trades 表真实列=trade_direction，
 * 传参必报 PGRST 42703 column does not exist）；同函数 'trade_type' 列在 trades 表
 * 从未存在（前端无人传，死分支已删）。与 C2b 扫描脚本踩的是同一个坑。
 *
 * 覆盖：
 *   A1 direction 过滤走 trade_direction 列 + 全链无 'direction' eq（事故现场反证）
 *   A2 tradeType 传入不再产生任何 eq（死分支已删，列不存在）
 *   A3 success 布尔转换 / token_address / experiment_id 正常过滤（防回归）
 *   A4 无过滤时仅 experiment_id
 *   A5 返回行经 Trade.fromDatabaseFormat 正常转实体（管线完好）
 *
 * 用法：node scripts/_test_trades_filter_columns.cjs
 */
'use strict';

// ── 打桩：先污染 require cache 再加载被测模块 ──
const dbManagerPath = require.resolve('../src/services/dbManager');
const loggerPath = require.resolve('../src/services/logger');

let eqCalls = [];
let lastTable = null;
const qb = {
  select: () => qb,
  eq: (col, val) => { eqCalls.push([col, val]); return qb; },
  range: () => qb,
  order: () => qb,
  then: (resolve) => resolve({ data: rows, error: null }), // await query 直接命中
};
let rows = [];

class StubLogger { constructor() {} info() {} warn() {} error() {} debug() {} }

require.cache[dbManagerPath] = {
  id: dbManagerPath, filename: dbManagerPath, loaded: true,
  exports: { dbManager: { getClient: () => ({ from: (t) => { lastTable = t; return qb; } }) } },
};
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true, exports: StubLogger,
};

const { ExperimentDataService } = require('../src/web/services/ExperimentDataService');

const check = (name, cond, detail) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) { console.error(`   失败详情: ${detail || ''}`); process.exit(1); }
};

async function main() {
  const svc = new ExperimentDataService();
  const sampleRow = {
    id: 1, experiment_id: 'exp1', token_address: '0xabc', token_symbol: 'TST',
    trade_direction: 'buy', trade_status: 'executed', success: true,
    input_currency: 'BNB', output_currency: 'TST', input_amount: 0.1, output_amount: 1000,
    unit_price: 0.0001, is_virtual_trade: true,
    created_at: new Date().toISOString(), metadata: {},
  };

  // A1 direction 过滤 → trade_direction 列（事故现场反证：旧形状 'direction' 必炸 PGRST 42703）
  eqCalls = []; rows = [sampleRow];
  const t1 = await svc.getTrades('exp1', { direction: 'buy', limit: 5 });
  check('A1a direction 过滤走 trade_direction 列',
    eqCalls.some(([c, v]) => c === 'trade_direction' && v === 'buy'), JSON.stringify(eqCalls));
  check('A1b 全链无 direction 裸列名（事故形状反证）',
    !eqCalls.some(([c]) => c === 'direction'), JSON.stringify(eqCalls));
  check('A1c 查询落在 trades 表', lastTable === 'trades', String(lastTable));

  // A2 tradeType 传入不产生任何 eq（trade_type 列在 trades 表不存在，死分支已删）
  eqCalls = []; rows = [sampleRow];
  await svc.getTrades('exp1', { tradeType: 'buy', limit: 5 });
  check('A2 tradeType 不再映射任何列（死分支已删）',
    !eqCalls.some(([c]) => c === 'trade_type'), JSON.stringify(eqCalls));

  // A3 其余过滤防回归
  eqCalls = []; rows = [sampleRow];
  await svc.getTrades('exp1', { success: 'true', tokenAddress: '0xabc', limit: 5 });
  check('A3a success 字符串转布尔',
    eqCalls.some(([c, v]) => c === 'success' && v === true), JSON.stringify(eqCalls));
  check('A3b token_address 正常过滤',
    eqCalls.some(([c, v]) => c === 'token_address' && v === '0xabc'), JSON.stringify(eqCalls));

  // A4 无过滤仅 experiment_id
  eqCalls = []; rows = [sampleRow];
  await svc.getTrades('exp1', { limit: 5 });
  check('A4 无过滤时仅 experiment_id 条件',
    eqCalls.length === 1 && eqCalls[0][0] === 'experiment_id', JSON.stringify(eqCalls));

  // A5 实体转换完好
  check('A5 返回行转 Trade 实体（tradeDirection 透传）',
    t1.length === 1 && t1[0].tradeDirection === 'buy', JSON.stringify(t1.map(t => t.tradeDirection)));

  console.log('\n全部通过 ✅（trades 过滤列名）');
}

main().catch((err) => { console.error('测试异常:', err); process.exit(1); });
