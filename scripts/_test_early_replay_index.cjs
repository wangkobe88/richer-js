#!/usr/bin/env node
/**
 * EarlyParticipant 回放 ticks 内存索引（P0-2，bc4f756e 性能案 2026-09-28）——本地零 DB 单测
 *
 * _queryReplayWindow 二分窗口查询语义（逐条镜像 _fetchEarlyTrades 的 SQL）：
 *   A. 闭区间边界：恰在 [checkTime-90s, checkTime] 两端的 tick 均包含
 *   B. 过滤口径：price_outlier=true 排除 / price_usd=null 排除
 *   C. 截断：过滤后截断 maxTickRows（含 outlier/null 混入时先过滤后截断）
 *   D. 桶 miss → []（等价 SQL 空结果，走真实空统计拒绝语义）
 *   E. 桶内序：输出保持 (timestamp, log_index) 升序（注入方排序契约）
 *   F. _mapTickRow 对拍：内存路径伪 DB 行 vs 手写 DB 行（block_time ISO 串毫秒
 *      无损往返）→ 映射输出逐字段 deep equal（AVE 兼容形状零漂移）
 *   G. getReplayHits 命中计数 / setReplayTicksIndex(null) 摘除回退 DB 路径
 *
 * 用法：node scripts/_test_early_replay_index.cjs
 */

'use strict';

const { EarlyParticipantCheckService } = require('../src/trading-engine/pre-check/EarlyParticipantCheckService');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ ${name}${detail ? ` | ${detail}` : ''}`); }
}

const loggerStub = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const T0 = 1750000000; // checkTime（秒）

function mkTick(tsMs, over = {}) {
  return Object.assign({
    token_address: '0xT', tx_hash: '0xhash', log_index: 0, trade_type: 'buy',
    trader_address: '0xw', price_usd: 0.5, bnb_amount: 0.1, token_amount: 100,
    block_number: 1, timestamp: tsMs, price_outlier: false, platform: 'fourmeme',
  }, over);
}

function mkService(config = {}) {
  return new EarlyParticipantCheckService(loggerStub, config, null);
}

async function main() {
  console.log('A. 闭区间边界 [checkTime-90s, checkTime]');
  {
    const svc = mkService();
    const fromMs = (T0 - 90) * 1000;
    svc.setReplayTicksIndex(new Map([['0xT', [
      mkTick(fromMs - 1, { log_index: 0 }),   // 窗外 1ms 前 → 排除
      mkTick(fromMs, { log_index: 1 }),       // 恰在左端 → 包含
      mkTick(T0 * 1000, { log_index: 2 }),    // 恰在右端 → 包含
      mkTick(T0 * 1000 + 1, { log_index: 3 }),// 窗外 1ms 后 → 排除
    ]]]));
    const rows = svc._queryReplayWindow('0xT', T0);
    check('恰好 2 行（两端闭包含、窗外排除）', rows.length === 2, `got ${rows.length}`);
    check('窗口内 tick 的 log_index 正确', rows[0].log_index === 1 && rows[1].log_index === 2);
  }

  console.log('B. 过滤口径：outlier / null usd');
  {
    const svc = mkService();
    const base = T0 * 1000 - 50000;
    svc.setReplayTicksIndex(new Map([['0xT', [
      mkTick(base + 1, { price_outlier: true }),            // outlier → 排除
      mkTick(base + 2, { price_usd: null }),                // usd null → 排除
      mkTick(base + 3),                                     // 正常 → 包含
    ]]]));
    const rows = svc._queryReplayWindow('0xT', T0);
    check('仅正常行入选', rows.length === 1 && rows[0].timestamp === undefined && rows[0].bnb_amount === 0.1);
  }

  console.log('C. 过滤后截断 maxTickRows');
  {
    // 小上限验证「先过滤后截断」语义（maxTickRows=3，7 行其中 2 行 outlier）
    const svc = mkService({ maxTickRows: 3 });
    const base = (T0 - 60) * 1000;
    const ticks = [];
    for (let i = 0; i < 9; i++) {
      ticks.push(mkTick(base + i * 1000, {
        log_index: i,
        price_outlier: i === 2 || i === 6, // 2 行 outlier → 7 行合格
      }));
    }
    svc.setReplayTicksIndex(new Map([['0xT', ticks]]));
    const rows = svc._queryReplayWindow('0xT', T0);
    check('截断到 maxTickRows=3（非 outlier 前 3：idx 0,1,3）',
      rows.length === 3 && rows.map(r => r.log_index).join(',') === '0,1,3',
      `got ${rows.map(r => r.log_index).join(',')}`);
  }

  console.log('D. 桶 miss → 空数组（真实空统计拒绝语义）');
  {
    const svc = mkService();
    svc.setReplayTicksIndex(new Map([['0xOther', [mkTick(T0 * 1000)]]]));
    check('无桶 → []', svc._queryReplayWindow('0xT', T0).length === 0);
  }

  console.log('E. 桶内升序（注入方排序契约下输出保序）');
  {
    const svc = mkService();
    const base = (T0 - 60) * 1000;
    const ticks = [mkTick(base + 3000, { log_index: 5 }), mkTick(base + 3000, { log_index: 4 }), mkTick(base + 1000, { log_index: 9 })];
    ticks.sort((a, b) => (a.timestamp - b.timestamp) || (a.log_index - b.log_index));
    svc.setReplayTicksIndex(new Map([['0xT', ticks]]));
    const rows = svc._queryReplayWindow('0xT', T0);
    check('同 timestamp 按 log_index 破平，跨 timestamp 按时间',
      rows.map(r => r.log_index).join(',') === '9,4,5', `got ${rows.map(r => r.log_index).join(',')}`);
  }

  console.log('F. _mapTickRow 对拍：内存伪 DB 行 vs 手写 DB 行 逐字段相等');
  {
    const svc = mkService();
    const tsMs = 1750000000123; // 非整秒毫秒，验证无损往返
    const tick = mkTick(tsMs, {
      tx_hash: '0xdeadbeef', log_index: 7, trade_type: 'sell',
      trader_address: '0xwallet9', price_usd: 0.0012345, bnb_amount: 0.4567, token_amount: 987.5,
      block_number: 4321,
    });
    // 内存路径：_queryReplayWindow 产伪 DB 行
    svc.setReplayTicksIndex(new Map([['0xT', [tick]]]));
    const pseudoRow = svc._queryReplayWindow('0xT', Math.ceil(tsMs / 1000))[0];
    // DB 路径形状：block_time 为 ISO 串（DB select 产物）
    const dbRow = {
      token_address: tick.token_address, tx_hash: tick.tx_hash, log_index: tick.log_index,
      trade_type: tick.trade_type, trader_address: tick.trader_address,
      price_usd: tick.price_usd, bnb_amount: tick.bnb_amount, token_amount: tick.token_amount,
      block_number: tick.block_number, block_time: new Date(tsMs).toISOString(),
    };
    check('伪 DB 行 block_time 与 DB ISO 串毫秒级相等', pseudoRow.block_time === dbRow.block_time,
      `${pseudoRow.block_time} vs ${dbRow.block_time}`);
    const fromMem = svc._mapTickRow(pseudoRow, '0xT');
    const fromDb = svc._mapTickRow(dbRow, '0xT');
    check('映射输出逐字段 deep equal', JSON.stringify(fromMem) === JSON.stringify(fromDb));
    check('映射形状关键位（sell 方向 W/T 币位 + 时间秒）',
      fromMem.from_token === '0xT' && fromMem.to_token !== '0xT' && fromMem.time === Math.floor(tsMs / 1000)
        && fromMem.tx_id === '0xdeadbeef-7');
  }

  console.log('G. 命中计数 / 摘除回退');
  {
    const svc = mkService();
    svc.setReplayTicksIndex(new Map([['0xT', [mkTick(T0 * 1000)]]]));
    check('初始计数 0', svc.getReplayHits() === 0);
    await svc._fetchEarlyTrades('0xT', T0);
    await svc._fetchEarlyTrades('0xT', T0);
    check('命中计数 2（内存路径每次累计）', svc.getReplayHits() === 2);
    svc.setReplayTicksIndex(null);
    check('摘除后计数归零', svc.getReplayHits() === 0);
    let threw = false;
    try { await svc._fetchEarlyTrades('0xT', T0); } catch (e) { threw = true; /* 无 supabase → throw（DB 路径） */ }
    check('摘除后回退 DB 路径（无 supabase 即抛错，证明未走内存）', threw);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('测试执行异常:', err);
  process.exitCode = 1;
});
