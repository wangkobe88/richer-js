#!/usr/bin/env node
/**
 * sender 口径切换 + 聚合路由占比因子——本地零 DB 单测（打桩 supabase）
 *
 * 背景（0x1de460 GMGN 路由案 2026-09-30）：
 *   trader_address = 事件 msg.sender——公共聚合路由（GMGN 0x1de460f3…4bc，flap
 *   27.9% 行）的行落路由合约；sender_address = tx.from 真实买家 EOA。对拍终审：
 *   切 sender 口径（top1 聚合不再把路由行聚成单一巨型钱包）可翻案 174/192 假象
 *   误拦，但假想放行 TP -8.566 BNB（亏率 66%）——router 主导盘本身是负信号，
 *   配套 earlyTradesRouterPct（≥60 拦截）显式接管。
 *
 * 覆盖：
 *   A. _mapTickRow COALESCE 矩阵（sender 优先 / NULL 回退 trader / 裸双字段保留）
 *   B. _calculateRouterShare 矩阵（trader 层判定 / 卖腿不计 / covered / 大小写 / 空窗）
 *   C. performCheck 集成：GMGN 主导盘形状（routerPct 高 + top1 低 = 翻案票）/
 *      零新增查询 / 查询异常 0 值放行
 *   D. 协议地址双地址层剔除（sender 切换后协议行 wallet=EOA，trader 层仍剔）
 *   E. 回测装载链（replay 伪行 sender 透传 / BacktestEngine select 列与 tick 对象）
 *   F. 源码口径防回归（empty 两路径 / context / FACTOR 表 / FactorBuilder）
 *
 * 用法：node scripts/_test_sender_switch_and_router.cjs
 */
'use strict';

const { readFileSync } = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n    期望 ${e}\n    实际 ${a}`); }
}

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** supabase 链式查询打桩：任意 .select/.eq/... 链 await 出固定结果（thenable） */
function chainStub(result) {
  const p = {
    select: () => p, eq: () => p, gte: () => p, lte: () => p, not: () => p,
    order: () => p, limit: () => p, in: () => p, range: () => p,
    then: (resolve) => resolve(result),
  };
  return p;
}

function makeSupabase({ ticks, counters }) {
  return {
    from(table) {
      if (table === 'wss_price_ticks') {
        counters.tickQueries++;
        return chainStub({ data: ticks, error: null });
      }
      return chainStub({ data: [], error: null });
    }
  };
}

const PROTOCOL = '0x000006b7be706cdb1e5a43c9fd974c0000000091';
const WBNB = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
const TOKEN = '0x7f3a9c2b4d81e6f0a5c3b8d9e2f4a6c1b7d5e3f2';
const GMGN = '0x1de460f363af910f51726def188f9004276bf4bc';

/** performCheck 输入形状的 DB tick 行（sender 可配，默认无 = NULL 回退口径） */
function tick(trader, type, bnb, blockTimeSec, sender) {
  return {
    token_address: TOKEN,
    tx_hash: '0x' + Math.random().toString(16).slice(2).padEnd(8, '0'),
    log_index: Math.floor(Math.random() * 1000),
    trade_type: type,
    trader_address: trader,
    ...(sender !== undefined ? { sender_address: sender } : {}),
    price_usd: 0.00001,
    bnb_amount: bnb,
    token_amount: 1000,
    block_number: 1000,
    block_time: new Date(blockTimeSec * 1000).toISOString(),
  };
}

/** _mapTickRow 后形状的交易（裸 trader/sender 可配） */
function mk({ trader, sender, type, bnb, token = TOKEN }) {
  return {
    wallet_address: (sender ?? trader), from_address: (sender ?? trader),
    to_token: type === 'buy' ? token : WBNB,
    token_amount: 1000, bnb_amount: bnb,
    trade_type: type,
    trader_address: trader ?? null,
    sender_address: sender ?? null,
  };
}

async function main() {
  const { EarlyParticipantCheckService } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'EarlyParticipantCheckService.js')
  );
  const { buildPreBuyCheckFactorValues } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'core', 'FactorBuilder.js')
  );

  // ════════ A. _mapTickRow COALESCE 矩阵 ════════
  console.log('\nA. _mapTickRow COALESCE 矩阵（真实买家口径单点）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const buyer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    // sender 存在 → wallet/from 用 sender（路由行真实买家）
    const r1 = svc._mapTickRow(tick(GMGN, 'buy', 1, 1000, buyer), TOKEN);
    check('A1 sender 优先：wallet=sender', r1.wallet_address, buyer);
    check('A2 from_address 同步', r1.from_address, buyer);

    // sender NULL → 回退 trader（历史行/未解析，与旧口径等价）
    const r2 = svc._mapTickRow(tick(GMGN, 'buy', 1, 1000), TOKEN);
    check('A3 sender NULL 回退 trader', r2.wallet_address, GMGN);

    // 裸双字段保留（router 因子判定的数据源）
    const r3 = svc._mapTickRow(tick(GMGN, 'buy', 1, 1000, buyer), TOKEN);
    check('A4 裸 trader_address 保留', r3.trader_address, GMGN);
    check('A5 裸 sender_address 保留', r3.sender_address, buyer);

    // 无 sender 键的行（回测旧缓存行形状）→ 裸字段 null 不炸
    const r4 = svc._mapTickRow(tick(GMGN, 'buy', 1, 1000, null), TOKEN);
    check('A6 显式 null sender → 裸字段 null + 回退 trader',
      [r4.sender_address, r4.wallet_address], [null, GMGN]);

    // AVE 兼容形状零漂移（to_token 买=token / 卖=WBNB）
    const r5 = svc._mapTickRow(tick(buyer, 'sell', 1, 1000, buyer), TOKEN);
    check('A7 卖腿 to_token=WBNB 形状不变', r5.to_token, WBNB);
  }

  // ════════ B. _calculateRouterShare 矩阵 ════════
  console.log('\nB. _calculateRouterShare 矩阵（GMGN 主导盘拦截）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const buyer1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const buyer2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const LAUNCH = 1000, CHECK = 1080; // age 80s ≤ 90s → covered

    // 主案：router 行 3.0（sender 分散两买家），直连行 1.0 → 75%
    const trades = [
      mk({ trader: GMGN, sender: buyer1, type: 'buy', bnb: 2.0 }),
      mk({ trader: GMGN, sender: buyer2, type: 'buy', bnb: 1.0 }),
      mk({ trader: buyer1, sender: buyer1, type: 'buy', bnb: 1.0 }),
      mk({ trader: GMGN, sender: buyer1, type: 'sell', bnb: 0.5 }), // 卖腿不计
    ];
    const r = svc._calculateRouterShare(trades, TOKEN, LAUNCH, CHECK);
    check('B1 router 买入占比 3/4=75', r.pct, 75);
    check('B2 routerBnb=3', r.routerBnb, 3);
    check('B3 totalBnb=4（卖腿不计）', r.totalBnb, 4);
    check('B4 covered=1', r.covered, 1);

    // trader 层判定与 wallet 层无关：wallet 全是 sender（分散），照样高占比
    // （这正是 sender 切换后 top1 拦不住、由本因子接管的形状）
    const t2 = svc._calculateTop1BuyShare(trades, TOKEN, LAUNCH, CHECK);
    check('B5 同数据 top1 按 sender 聚合（buyer1 双渠道合并 3/4=75）', t2.pct, 75);

    // 大小写归一（DB 小写恒等；大写 trader 也命中）
    const tradesCase = [
      mk({ trader: GMGN.toUpperCase(), sender: buyer1, type: 'buy', bnb: 1 }),
    ];
    check('B6 trader 大写归一命中',
      svc._calculateRouterShare(tradesCase, TOKEN, LAUNCH, CHECK).pct, 100);

    // 非 router 合约不计：前缀相似但地址不同
    const fake = GMGN.slice(0, 38) + 'ff';
    const tradesFake = [mk({ trader: fake, sender: buyer1, type: 'buy', bnb: 1 })];
    check('B7 前缀相似非恒等不命中',
      svc._calculateRouterShare(tradesFake, TOKEN, LAUNCH, CHECK).pct, 0);

    // covered 矩阵（与 top1 同构）
    check('B8 launchAt=null → 0 值放行',
      svc._calculateRouterShare(trades, TOKEN, null, CHECK),
      { pct: 0, routerBnb: 0, totalBnb: 0, covered: 0 });
    check('B9 age>90s → covered=0',
      svc._calculateRouterShare(trades, TOKEN, LAUNCH, CHECK + 91).covered, 0);
    check('B10 age=90s 边界 covered=1',
      svc._calculateRouterShare(trades, TOKEN, LAUNCH, CHECK + 10).covered, 1);

    // 空窗 / 全尘埃 / 脏数据
    check('B11 空窗 covered=1 0 值', svc._calculateRouterShare([], TOKEN, LAUNCH, CHECK),
      { pct: 0, routerBnb: 0, totalBnb: 0, covered: 1 });
    check('B12 只有卖腿 0 值',
      svc._calculateRouterShare([mk({ trader: GMGN, sender: buyer1, type: 'sell', bnb: 5 })], TOKEN, LAUNCH, CHECK).pct, 0);
    const dirty = [
      mk({ trader: GMGN, sender: buyer1, type: 'buy', bnb: 'abc' }),
      mk({ trader: GMGN, sender: buyer1, type: 'buy', bnb: 0 }),
      mk({ trader: buyer1, sender: buyer1, type: 'buy', bnb: 1 }),
    ];
    check('B13 脏/尘埃行跳过（pct=0 total=1）',
      [svc._calculateRouterShare(dirty, TOKEN, LAUNCH, CHECK).pct,
       svc._calculateRouterShare(dirty, TOKEN, LAUNCH, CHECK).totalBnb], [0, 1]);

    // 无裸 trader 字段（旧形状 trades）→ 不炸、不命中
    const legacy = [{ wallet_address: buyer1, from_address: buyer1, to_token: TOKEN, token_amount: 1, bnb_amount: 1 }];
    check('B14 旧形状（无裸字段）不炸', svc._calculateRouterShare(legacy, TOKEN, LAUNCH, CHECK).pct, 0);
  }

  // ════════ C. performCheck 集成：GMGN 主导盘形状 ════════
  console.log('\nC. performCheck 集成（0x1de460 翻案票形状）');
  {
    const buyer1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const buyer2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const buyer3 = '0xcccccccccccccccccccccccccccccccccccccccc';
    const LAUNCH = 1000, CHECK = 1080;
    // 对拍翻案票典型形状：GMGN 行 70%（3.5 BNB，sender 分散三买家），直连 1.5
    const ticks = [
      tick(GMGN, 'buy', 2.0, 1005, buyer1),
      tick(GMGN, 'buy', 1.0, 1010, buyer2),
      tick(GMGN, 'buy', 0.5, 1015, buyer3),
      tick(buyer1, 'buy', 1.0, 1020),   // 直连（sender NULL 回退 trader）
      tick(buyer2, 'buy', 0.5, 1025),
      tick(GMGN, 'sell', 0.3, 1030, buyer1), // 卖腿不计
    ];
    const counters = { tickQueries: 0 };
    const supabase = makeSupabase({ ticks, counters });
    const svc = new EarlyParticipantCheckService(logger, {}, supabase);
    const result = await svc.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);

    check('C1 routerPct=3.5/5=70 ≥60 拦截档', result.earlyTradesRouterPct, 70);
    check('C2 routerCovered=1', result.earlyTradesRouterCovered, 1);
    // top1 按 sender 聚合：buyer1=3.0（router 2.0 + 直连 1.0）→ 3/5=60
    check('C3 top1 sender 口径=60（旧行为 router 聚 3.5=70 被拦）', result.earlyTradesTop1BuySharePct, 60);
    check('C4 buyBnb=5（卖腿/尘埃不计）', result.earlyTradesBuyBnb, 5);
    check('C5 ticks 查询 1 次（零新增）', counters.tickQueries, 1);
    // 拦截组合可表达：`routerPct < 60`（top1 翻案后由 router 门接管）

    // 无 sender 行（历史窗）形状：trader 层 router 判定照常 + 聚合回退
    const ticksNoSender = [
      tick(GMGN, 'buy', 2.0, 1005),
      tick(buyer1, 'buy', 1.0, 1010),
    ];
    const supabase2 = makeSupabase({ ticks: ticksNoSender, counters: { tickQueries: 0 } });
    const svc2 = new EarlyParticipantCheckService(logger, {}, supabase2);
    const r2 = await svc2.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);
    check('C6 历史行（无 sender）：routerPct 照常 66.67', r2.earlyTradesRouterPct, 66.67);
    check('C7 历史行聚合回退 trader（旧行为等价）', r2.earlyTradesTop1BuySharePct, 66.67);
  }
  {
    // 查询异常 → _getEmptyResult 0 值放行
    const errSupabase = { from() { return chainStub({ data: null, error: { message: 'db down' } }); } };
    const svc = new EarlyParticipantCheckService(logger, {}, errSupabase);
    const result = await svc.performCheck(TOKEN, null, 'bsc', 1000, 1080, 0);
    check('C8 查询异常 → routerPct 0 放行', result.earlyTradesRouterPct, 0);
    check('C9 查询异常 → routerCovered 0', result.earlyTradesRouterCovered, 0);
  }

  // ════════ D. 协议地址双地址层剔除 ════════
  console.log('\nD. 协议地址双地址层剔除（sender 切换防漂移）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const officialEOA = '0xdddddddddddddddddddddddddddddddddddddddd'; // 协议行解析出的 tx.from
    const retail = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const LAUNCH = 1000, CHECK = 1080;

    // 协议行 wallet 层=EOA（剔不掉）但 trader 层=协议（剔除）
    const trades = [
      mk({ trader: PROTOCOL, sender: officialEOA, type: 'buy', bnb: 5.0 }),
      mk({ trader: retail, sender: retail, type: 'buy', bnb: 1.0 }),
    ];
    const top1 = svc._calculateTop1BuyShare(trades, TOKEN, LAUNCH, CHECK);
    check('D1 top1 协议行 trader 层剔除（只计 1.0 → pct=100 total=1）',
      [top1.pct, top1.totalBnb], [100, 1]);

    // sniper 净持仓同款剔除（手动复算聚合段：画像查询打桩跳过，断言聚合口径）
    // retail 买 1000 / 卖 400 → 净 600；协议行净持仓（12000）被剔不计入
    const sniperTrades = [
      mk({ trader: PROTOCOL, sender: officialEOA, type: 'buy', bnb: 5.0 }),
      { ...mk({ trader: retail, sender: retail, type: 'buy', bnb: 1.0 }), token_amount: 1000 },
      { ...mk({ trader: retail, sender: retail, type: 'sell', bnb: 0.4 }), token_amount: 400 },
    ];
    const net = new Map();
    for (const t of sniperTrades) {
      const key = (t.wallet_address || '').toLowerCase();
      if (key === PROTOCOL || String(t.trader_address || '').toLowerCase() === PROTOCOL) continue;
      const isBuy = String(t.to_token || '').toLowerCase() === TOKEN.toLowerCase();
      net.set(key, (net.get(key) || 0) + (isBuy ? t.token_amount : -t.token_amount));
    }
    check('D2 净持仓协议行剔除（retail 净 600）', [...net.entries()], [[retail, 600]]);

    // wallet 层直接命中协议地址（旧形状）仍剔除
    const tradesOld = [mk({ trader: PROTOCOL, sender: undefined, type: 'buy', bnb: 5.0 })];
    check('D3 wallet 层命中（无 sender 回退）仍剔除',
      svc._calculateTop1BuyShare(tradesOld, TOKEN, LAUNCH, CHECK).totalBnb, 0);
  }

  // ════════ E. 回测装载链 ════════
  console.log('\nE. 回测装载链（replay 透传 + select 列）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const buyer = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const LAUNCH = 1000, CHECK = 1080;

    // replay 索引注入 → _queryReplayWindow 伪行含 sender_address
    svc.setReplayTicksIndex(new Map([[TOKEN, [{
      token_address: TOKEN, tx_hash: '0xabc', log_index: 1,
      trade_type: 'buy', trader_address: GMGN, sender_address: buyer,
      price_usd: 0.00001, bnb_amount: 1, token_amount: 1000,
      block_number: 100, timestamp: (LAUNCH + 5) * 1000, price_outlier: false,
    }]]]));
    const trades = await svc._fetchEarlyTrades(TOKEN, CHECK); // replay 路径
    check('E1 replay 伪行透传 sender（映射后 wallet=buyer）', trades[0].wallet_address, buyer);
    check('E2 replay 伪行裸 trader 保留', trades[0].trader_address, GMGN);
    const r = svc._calculateRouterShare(trades, TOKEN, LAUNCH, CHECK);
    check('E3 replay 路径 router 判定生效 pct=100', r.pct, 100);

    // BacktestEngine 源码口径：select 列与 tick 对象带 sender_address
    const be = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'implementations', 'BacktestEngine.js'), 'utf8');
    check('E4 TICK_SELECT_COLUMNS 含 sender_address',
      be.includes("sender_address, price_bnb"), true);
    check('E5 _loadWssTicks tick 对象含 sender_address（stripSenderAddress 对照臂口径，2026-10-01 后）',
      be.includes("sender_address: stripSender ? null : (row.sender_address || null)"), true);
  }

  // ════════ F. 源码口径防回归 ════════
  console.log('\nF. 源码口径防回归');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const emptyKeys = svc.getEmptyFactorValues();
    check('F1 getEmptyFactorValues 含 router 2 键且为 0', [
      emptyKeys.earlyTradesRouterPct, emptyKeys.earlyTradesRouterCovered,
    ], [0, 0]);

    const er = svc._getEmptyResult();
    check('F2 _getEmptyResult 含 router 2 键且为 0', [
      er.earlyTradesRouterPct, er.earlyTradesRouterCovered,
    ], [0, 0]);

    const pbs = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'PreBuyCheckService.js'), 'utf8');
    check('F3 context 含 router 2 键', [
      pbs.includes('earlyTradesRouterPct: earlyParticipantCheck.earlyTradesRouterPct ?? 0'),
      pbs.includes('earlyTradesRouterCovered: earlyParticipantCheck.earlyTradesRouterCovered ?? 0'),
    ], [true, true]);
    check('F4 FACTOR 展示表含 routerPct 定义', pbs.includes('earlyTradesRouterPct: {'), true);

    const fv = buildPreBuyCheckFactorValues({ earlyTradesRouterPct: 71.5, earlyTradesRouterCovered: 1 });
    check('F5 FactorBuilder 透传', [fv.earlyTradesRouterPct, fv.earlyTradesRouterCovered], [71.5, 1]);
    const fvEmpty = buildPreBuyCheckFactorValues({});
    check('F6 FactorBuilder 缺省 0（不落 null）', [
      fvEmpty.earlyTradesRouterPct, fvEmpty.earlyTradesRouterCovered,
    ], [0, 0]);

    // select 列源码（SQL 路径带 sender_address）
    const epcs = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'EarlyParticipantCheckService.js'), 'utf8');
    check('F7 SQL select 列含 sender_address',
      epcs.includes("trade_type, trader_address, sender_address, price_usd"), true);
    check('F8 COALESCE 单点（wallet/from 同源）',
      epcs.includes('wallet_address: row.sender_address || row.trader_address') &&
      epcs.includes('from_address: row.sender_address || row.trader_address'), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
