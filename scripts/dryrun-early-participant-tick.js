#!/usr/bin/env node

/**
 * EarlyParticipantCheckService WSS 源自检（Phase 7）
 *
 * 本地轻量自检，零网络零真实 DB：mock supabase 查询链，验证：
 *  1. tick → AVE trade 兼容形态映射字段（含下游消费方特化字段）
 *  2. 真实 WalletClusterService 消费映射后数据（聚簇分析跑通）
 *  3. performCheck 有数据路径统计断言
 *  4. performCheck 空数据路径（真实空统计 → evaluateBuyEligibility 拒绝，不再走通过值兜底）
 *  5. 查询异常路径（_getEmptyResult 通过值，既有行为保留）
 *  6. 回测缓存路径（useCache 命中时不查 wss_price_ticks）
 */

const { EarlyParticipantCheckService } = require('../src/trading-engine/pre-check/EarlyParticipantCheckService');
const { WalletClusterService } = require('../src/trading-engine/pre-check/WalletClusterService');

// ═══════════════ mock supabase ═══════════════

/**
 * 构造 mock supabase 客户端。
 * @param {Object} tables - { 表名: { rows: Array, error: Object|null } }
 * @param {Object} opts - { onQuery: (table, filters) => void } 查询观测
 */
function makeMockSupabase(tables, opts = {}) {
  const client = {
    from(table) {
      const state = { table, filters: [] };
      const chain = {
        select() { return chain; },
        eq(col, val) { state.filters.push(['eq', col, val]); return chain; },
        gte(col, val) { state.filters.push(['gte', col, val]); return chain; },
        lte(col, val) { state.filters.push(['lte', col, val]); return chain; },
        not(col, op, val) { state.filters.push(['not', col, op, val]); return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve) {
          if (opts.onQuery) opts.onQuery(state.table, state.filters);
          const t = tables[table] || { rows: [], error: null };
          resolve({ data: t.error ? null : t.rows, error: t.error });
        }
      };
      return chain;
    }
  };
  return client;
}

// ═══════════════ 测试工具 ═══════════════

let passed = 0;
let failed = 0;

function assert(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const TOKEN = '0xaaa1111111111111111111111111111111111111';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

function makeTick(overrides = {}) {
  return {
    token_address: TOKEN,
    tx_hash: '0xdeadbeef',
    log_index: 0,
    trade_type: 'buy',
    trader_address: '0xtrader1',
    price_usd: '0.00001',   // NUMERIC 列经 JSON 化为字符串（PostgREST 行为）
    bnb_amount: '0.5',
    token_amount: '50000',
    block_number: 45000000,
    block_time: '2026-09-03T12:00:00.000Z',
    ...overrides
  };
}

// ═══════════════ 1. 映射断言 ═══════════════

function testMapping() {
  console.log('\n[1] tick → AVE trade 映射断言');
  const svc = new EarlyParticipantCheckService(console, {}, {});

  const buyTick = makeTick();
  const buy = svc._mapTickRow(buyTick, TOKEN);

  assert('buy: time 为秒级时间戳', buy.time === Math.floor(new Date('2026-09-03T12:00:00.000Z').getTime() / 1000));
  assert('buy: tx_id = tx_hash-log_index', buy.tx_id === '0xdeadbeef-0');
  assert('buy: wallet_address = trader_address', buy.wallet_address === '0xtrader1');
  assert('buy: from_usd = price_usd × token_amount', buy.from_usd === 0.00001 * 50000, `got ${buy.from_usd}`);
  assert('buy: to_usd 同 from_usd', buy.to_usd === buy.from_usd);
  assert('buy: to_token_price_usd = price_usd（<1 判代币价）', buy.to_token_price_usd === 0.00001);
  assert('buy: to_token = tokenAddress（WalletCluster 买入手数累计）', buy.to_token === TOKEN);
  assert('buy: from_token = WBNB', buy.from_token === WBNB);
  assert('buy: to_amount = token_amount', buy.to_amount === 50000);
  assert('buy: from_token_symbol=BNB（WalletLabel isBuy 判定命中）', buy.from_token_symbol === 'BNB');
  assert('buy: block_number 透传', buy.block_number === 45000000);
  assert('buy: pair_liquidity_usd = null（tick 无此语义）', buy.pair_liquidity_usd === null);
  assert('buy: 保留 tick 原始字段', buy.trade_type === 'buy' && buy.token_amount === 50000 && buy.bnb_amount === 0.5);

  const sellTick = makeTick({ trade_type: 'sell', trader_address: '0xtrader2', token_amount: '30000', bnb_amount: '0.3', log_index: 1 });
  const sell = svc._mapTickRow(sellTick, TOKEN);
  assert('sell: from_token = tokenAddress', sell.from_token === TOKEN);
  assert('sell: to_token = WBNB', sell.to_token === WBNB);
  assert('sell: to_amount = bnb_amount', sell.to_amount === 0.3);
  assert('sell: from_token_symbol=Token 不命中 isBuy 集合 {SOL,BNB,ETH}', sell.from_token_symbol === 'TOKEN');

  // WalletLabelService L108-111 isBuy 判定逐字复刻（SOL wrap 精确比较 + symbol 集合）
  const isBuyExpr = (t) => t.from_token === 'So11111111111111111111111111111111111111112'
    || t.from_token_symbol === 'SOL'
    || t.from_token_symbol === 'BNB'
    || t.from_token_symbol === 'ETH';
  assert('WalletLabel isBuy 表达式：buy→true / sell→false', isBuyExpr(buy) === true && isBuyExpr(sell) === false);
}

// ═══════════════ 2. 真实下游 WalletClusterService 消费 ═══════════════

function testDownstreamCluster() {
  console.log('\n[2] 真实 WalletClusterService 消费映射数据');
  const svc = new EarlyParticipantCheckService(console, {}, {});
  const ticks = [
    makeTick({ trader_address: '0xw1', token_amount: '50000', block_number: 100, log_index: 0 }),  // $500 高价值
    makeTick({ trader_address: '0xw2', token_amount: '100000', block_number: 101, log_index: 1 }), // $1000
    makeTick({ trader_address: '0xw3', token_amount: '50000', block_number: 102, log_index: 2 }),
    makeTick({ trade_type: 'sell', trader_address: '0xw4', token_amount: '30000', bnb_amount: '0.3', block_number: 103, log_index: 3 })
  ];
  const trades = ticks.map((t, i) => svc._mapTickRow({ ...t, block_time: `2026-09-03T12:00:0${i}.000Z` }, TOKEN));

  const clusterService = new WalletClusterService(console, { mode: 'block', clusterBlockThreshold: 7 });
  let analysis = null;
  let threw = null;
  try {
    analysis = clusterService.performClusterAnalysis(trades, TOKEN);
  } catch (e) {
    threw = e;
  }
  assert('performClusterAnalysis 跑通不抛错', threw === null, threw ? threw.message : '');
  assert('返回结构含因子键', analysis && typeof analysis === 'object', JSON.stringify(analysis));
}

// ═══════════════ 3. performCheck 有数据路径 ═══════════════

async function testPerformWithData() {
  console.log('\n[3] performCheck 有数据路径（mock 3 笔 tick）');
  // 高价值 $1000 + 低价值 $2 + sell —— 跨度 0~2 秒
  const rows = [
    makeTick({ trader_address: '0xw1', price_usd: '0.00002', token_amount: '50000000', block_time: '2026-09-03T12:00:00.000Z', log_index: 0 }),
    makeTick({ trader_address: '0xw2', price_usd: '0.00001', token_amount: '200', block_time: '2026-09-03T12:00:01.000Z', log_index: 1 }),
    makeTick({ trade_type: 'sell', trader_address: '0xw3', price_usd: '0.00001', token_amount: '30000', bnb_amount: '0.3', block_time: '2026-09-03T12:00:02.000Z', log_index: 2 })
  ];
  const supabase = makeMockSupabase({ wss_price_ticks: { rows } });
  const svc = new EarlyParticipantCheckService(console, {}, supabase);
  const checkTime = Math.floor(new Date('2026-09-03T12:00:02.000Z').getTime() / 1000);
  const result = await svc.performCheck(TOKEN, `${TOKEN}_fo`, 'bsc', checkTime - 200, checkTime);

  assert('earlyTradesChecked = 1', result.earlyTradesChecked === 1);
  assert('totalCount = 3', result.earlyTradesTotalCount === 3, `got ${result.earlyTradesTotalCount}`);
  assert('volume = 1000+0.002+0.3（price×amount 合计）', Math.abs(result.earlyTradesVolume - (0.00002 * 50000000 + 0.00001 * 200 + 0.00001 * 30000)) < 0.01, `got ${result.earlyTradesVolume}`);
  assert('highValueCount = 1（$1000 ≥ 80）', result.earlyTradesHighValueCount === 1, `got ${result.earlyTradesHighValueCount}`);
  assert('uniqueWallets = 3', result.earlyTradesUniqueWallets === 3, `got ${result.earlyTradesUniqueWallets}`);
  assert('earlyTradesNoInnerData = 0', result.earlyTradesNoInnerData === 0);
  assert('_trades 携带映射数据', Array.isArray(result._trades) && result._trades.length === 3);
  assert('dataFirstTime 为首 tick 秒', result.earlyTradesDataFirstTime === Math.floor(new Date('2026-09-03T12:00:00.000Z').getTime() / 1000));

  const elig = svc.evaluateBuyEligibility(result, {});
  assert('evaluateBuyEligibility 返回结构', elig && typeof elig.canBuy === 'boolean' && typeof elig.reason === 'string');
}

// ═══════════════ 4. 空数据路径 ═══════════════

async function testEmptyPath() {
  console.log('\n[4] performCheck 空数据路径（窗口内无 tick → 真实空统计，拒绝语义）');
  const supabase = makeMockSupabase({ wss_price_ticks: { rows: [] } });
  const svc = new EarlyParticipantCheckService(console, {}, supabase);
  const checkTime = Math.floor(Date.now() / 1000);
  const result = await svc.performCheck(TOKEN, `${TOKEN}_fo`, 'bsc', checkTime - 200, checkTime);

  assert('earlyTradesChecked = 1（正常完成非异常）', result.earlyTradesChecked === 1);
  assert('totalCount = 0（真实空统计）', result.earlyTradesTotalCount === 0);
  assert('volumePerMin = 0', result.earlyTradesVolumePerMin === 0);
  assert('countPerMin = 0', result.earlyTradesCountPerMin === 0);
  assert('earlyTradesNoInnerData = 1（标记无数据）', result.earlyTradesNoInnerData === 1);
  assert('无 9999 通过值', result.earlyTradesVolume !== 9999 && result.earlyTradesTotalCount !== 9999);

  const elig = svc.evaluateBuyEligibility(result, {});
  assert('evaluateBuyEligibility 拒绝（canBuy=false）', elig.canBuy === false, `reason: ${elig.reason}`);
}

// ═══════════════ 5. 查询异常路径 ═══════════════

async function testErrorPath() {
  console.log('\n[5] 查询异常路径（DB 错误 → _getEmptyResult 通过值，既有行为）');
  const supabase = makeMockSupabase({ wss_price_ticks: { rows: null, error: { message: 'connection refused' } } });
  const svc = new EarlyParticipantCheckService(console, {}, supabase);
  const checkTime = Math.floor(Date.now() / 1000);
  const result = await svc.performCheck(TOKEN, `${TOKEN}_fo`, 'bsc', checkTime - 200, checkTime);

  assert('返回 _getEmptyResult 通过值（9999）', result.earlyTradesVolume === 9999, `got ${result.earlyTradesVolume}`);
  assert('earlyTradesNoInnerData = 1', result.earlyTradesNoInnerData === 1);
  const elig = svc.evaluateBuyEligibility(result, {});
  assert('evaluateBuyEligibility 通过（canBuy=true）', elig.canBuy === true);
}

// ═══════════════ 6. 回测缓存路径 ═══════════════

async function testCachePath() {
  console.log('\n[6] 回测缓存路径（useCache 命中时不查 wss_price_ticks）');
  const svcForBuild = new EarlyParticipantCheckService(console, {}, {});
  const tradesData = [svcForBuild._mapTickRow(makeTick(), TOKEN)];

  const queried = [];
  const supabase = makeMockSupabase(
    { early_participant_trades: { rows: [{ trades_data: tradesData, check_time: 1000 }] } },
    { onQuery: (table) => queried.push(table) }
  );
  const svc = new EarlyParticipantCheckService(console, {}, supabase);
  const result = await svc.performCheck(TOKEN, `${TOKEN}_fo`, 'bsc', 800, 1000, 0, { useCache: true });

  assert('_fromCache = true', result._fromCache === true);
  assert('缓存数据参与统计', result.earlyTradesTotalCount === 1);
  assert('未查询 wss_price_ticks', !queried.includes('wss_price_ticks'), `queried: ${queried.join(',')}`);
}

// ═══════════════ 主流程 ═══════════════

(async () => {
  testMapping();
  testDownstreamCluster();
  await testPerformWithData();
  await testEmptyPath();
  await testErrorPath();
  await testCachePath();

  console.log('\n══════════════════════════════');
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
})().catch(e => {
  console.error('自检脚本异常:', e);
  process.exit(1);
});
