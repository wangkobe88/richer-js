#!/usr/bin/env node
/**
 * top1 买入集中度因子（单钱包主导拦截）——本地零 DB 单测（打桩 supabase）
 *
 * 背景（2026-09-29 用户裁定，buy-dominance 扫描案衍生）：
 *   「买的时候就一个钱包占据绝大多数流动性（购买量）」才算作弊票——叙事好、
 *   后期多人参与稀释的不算。首 90s 窗纯买入量（BNB）最大钱包占比 ≥60% 拦截；
 *   与 sniperPct 互补（4444 家族低频新钱包 sniper 率 3%，只靠本因子防）。
 *   刻意不含卖腿（walletTop1VolumeRatio 已覆盖买卖混合口径）。
 *
 * 覆盖：
 *   A. _calculateTop1BuyShare 聚合矩阵（纯买入 / 卖腿不计 / 协议地址剔除 /
 *      尘埃 bnb<=0 跳过 / 大小写归一 / covered 矩阵 / 空窗 0 值）
 *   B. 数值锚定：0x01bf…877777 真实案形状（12 钱包 → share 65.7% 简化复刻）
 *   C. performCheck 集成（复用同一 ticks 查询零新增 / 因子键与数值 /
 *      查询异常走 _getEmptyResult 0 值放行）
 *   D. 源码口径防回归（empty 两路径 4 键 / PreBuyCheckService context /
 *      FactorBuilder 映射含 4 键）
 *
 * 用法：node scripts/_test_top1_buy_share.cjs
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
const TOKEN = '0x01bff44174f387490dbce7c5a0f5fd5fca877777';

/** _mapTickRow 后形状的买/卖交易（bnb 可配） */
function mk(trader, type, bnb) {
  return {
    wallet_address: trader, from_address: trader,
    to_token: type === 'buy' ? TOKEN : WBNB,
    token_amount: 1000, bnb_amount: bnb,
  };
}

/** performCheck 输入形状的 DB tick 行 */
function tick(trader, type, bnb, blockTimeSec) {
  return {
    token_address: TOKEN,
    tx_hash: '0x' + Math.random().toString(16).slice(2).padEnd(8, '0'),
    log_index: Math.floor(Math.random() * 1000),
    trade_type: type,
    trader_address: trader,
    price_usd: 0.00001,
    bnb_amount: bnb,
    token_amount: 1000,
    block_number: 1000,
    block_time: new Date(blockTimeSec * 1000).toISOString(),
  };
}

async function main() {
  const { EarlyParticipantCheckService } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'EarlyParticipantCheckService.js')
  );
  const { buildPreBuyCheckFactorValues } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'core', 'FactorBuilder.js')
  );

  // ════════ A. _calculateTop1BuyShare 聚合矩阵 ════════
  console.log('\nA. _calculateTop1BuyShare 聚合矩阵');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const king = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const retail1 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const retail2 = '0xcccccccccccccccccccccccccccccccccccccccc';

    const LAUNCH = 1000, CHECK = 1080; // age 80s ≤ 90s → covered

    // 主案：king 买 3.0+0.6（多笔合并），散 0.6/0.4；king 卖 2.5 必须不计入
    const trades = [
      mk(king, 'buy', 3.0), mk(king, 'buy', 0.6), mk(king, 'sell', 2.5),
      mk(retail1, 'buy', 0.6), mk(retail2, 'buy', 0.4),
      mk(PROTOCOL, 'buy', 5.0),       // 协议地址剔除
      mk('0xdddddddddddddddddddddddddddddddddddddddd', 'buy', 0), // 尘埃 bnb=0 跳过
    ];
    const r = svc._calculateTop1BuyShare(trades, TOKEN, LAUNCH, CHECK);
    check('A1 纯买入聚合 pct=3.6/4.6', r.pct, 78.26);
    check('A2 top1Bnb=3.6（多笔合并）', r.top1Bnb, 3.6);
    check('A3 totalBnb=4.6（卖腿/协议/尘埃不计）', r.totalBnb, 4.6);
    check('A4 covered=1', r.covered, 1);

    // 大小写归一：to_token 大写也能判买腿；钱包大小写合并
    const tradesCase = [
      { ...mk(king.toUpperCase(), 'buy', 2), to_token: TOKEN.toUpperCase() },
      { ...mk(king, 'buy', 1), to_token: TOKEN }, // 同钱包不同大小写 → 合并 3
      mk(retail1, 'buy', 1),
    ];
    const rc = svc._calculateTop1BuyShare(tradesCase, TOKEN, LAUNCH, CHECK);
    check('A5 to_token 大小写归一判买腿', rc.totalBnb, 4);
    check('A6 钱包大小写合并 top1=3', [rc.top1Bnb, rc.pct], [3, 75]);

    // covered 矩阵
    check('A7 launchAt=null → covered=0 0 值放行',
      svc._calculateTop1BuyShare(trades, TOKEN, null, CHECK),
      { pct: 0, top1Bnb: 0, totalBnb: 0, covered: 0 });
    check('A8 launchAt=0 → covered=0', svc._calculateTop1BuyShare(trades, TOKEN, 0, CHECK).covered, 0);
    check('A9 age>90s → covered=0', svc._calculateTop1BuyShare(trades, TOKEN, LAUNCH, CHECK + 91).covered, 0);
    check('A10 age=90s 边界 covered=1', svc._calculateTop1BuyShare(trades, TOKEN, LAUNCH, CHECK + 10).covered, 1);

    // 空窗 / 全尘埃：covered=1 但 0 值（死票归量门管辖）
    check('A11 空窗 → covered=1 0 值', svc._calculateTop1BuyShare([], TOKEN, LAUNCH, CHECK),
      { pct: 0, top1Bnb: 0, totalBnb: 0, covered: 1 });
    check('A12 只有卖腿 → totalBnb=0 0 值', svc._calculateTop1BuyShare([mk(king, 'sell', 5)], TOKEN, LAUNCH, CHECK).pct, 0);

    // 单钱包全买 → 100
    check('A13 单钱包 → pct=100', svc._calculateTop1BuyShare([mk(king, 'buy', 1.5)], TOKEN, LAUNCH, CHECK).pct, 100);

    // 非数值脏 bnb（字符串/null）跳过不炸
    const dirty = [mk(king, 'buy', 'abc'), mk(king, 'buy', null), mk(retail1, 'buy', 1)];
    const rd = svc._calculateTop1BuyShare(dirty, TOKEN, LAUNCH, CHECK);
    check('A14 脏 bnb 行跳过（只剩 1）', [rd.totalBnb, rd.pct], [1, 100]);
  }

  // ════════ B. 数值锚定：0x01bf…877777 真实案简化复刻 ════════
  console.log('\nB. 0x01bf 案形状锚定（扫描 share=65.7%）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const LAUNCH = 1000, CHECK = 1061; // 买点 age≈61s（12:29:41 创建 → 12:30:42 买）
    // 扫描口径首窗 4.567 BNB，1de460f3 买 3.0（65.7%）；简化为 5 钱包比例复刻
    const gang = '0x1de460f363af910f51726def188f9004276bf4bc'.slice(0, 40);
    const trades = [
      mk('0xa83b73f5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'buy', 0.298),
      mk(gang, 'buy', 1.5), mk(gang, 'buy', 0.9), mk(gang, 'buy', 0.6), // 3.0
      mk('0x4dc28942aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'buy', 0.059),
      mk('0xe931f1faaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'buy', 0.058),
      mk('0x3544af3caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'buy', 0.147),
      mk('0xb6864c01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'buy', 0.15),
      mk(gang, 'sell', 0.5), // 对倒卖腿不计
    ];
    const r = svc._calculateTop1BuyShare(trades, TOKEN, LAUNCH, CHECK);
    check('B1 top1=对倒主力 3.0 BNB', r.top1Bnb, 3);
    check('B2 total=3.712（真实 4.567 的简化复刻）', Number(r.totalBnb.toFixed(3)), 3.712);
    check('B3 share≈71% ≥60 拦截档', r.pct >= 60, true);
    check('B4 covered=1（age 61s）', r.covered, 1);
  }

  // ════════ C. performCheck 集成 ════════
  console.log('\nC. performCheck 集成（复用同一 ticks 查询）');
  {
    const king = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const retail = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const LAUNCH = 1000, CHECK = 1080;
    const ticks = [
      tick(king, 'buy', 3.6, 1005),
      tick(king, 'sell', 2.5, 1010),   // 卖腿不得计入
      tick(retail, 'buy', 0.6, 1015),
      tick(retail, 'buy', 0.4, 1020),
      tick(PROTOCOL, 'buy', 5.0, 1025),
    ];
    const counters = { tickQueries: 0 };
    const supabase = makeSupabase({ ticks, counters });
    const svc = new EarlyParticipantCheckService(logger, {}, supabase);
    const result = await svc.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);

    check('C1 因子键 pct=3.6/4.6=78.26', result.earlyTradesTop1BuySharePct, 78.26);
    check('C2 top1Bnb', result.earlyTradesTop1BuyBnb, 3.6);
    check('C3 buyBnb（总买入）', result.earlyTradesBuyBnb, 4.6);
    check('C4 covered', result.earlyTradesTop1BuyCovered, 1);
    check('C5 ticks 查询 1 次（因子复用 trades 零新增）', counters.tickQueries, 1);
    check('C6 sniper 因子并存无回归', result.earlyTradesSniperHoldingPct !== undefined, true);

    // 尘埃豁免复刻口径：`share<60 OR buyBnb<1` 两因子可组合表达
    const tiny = [tick(king, 'buy', 0.3, 1005), tick(retail, 'buy', 0.2, 1010)];
    const supabase2 = makeSupabase({ ticks: tiny, counters: { tickQueries: 0 } });
    const svc2 = new EarlyParticipantCheckService(logger, {}, supabase2);
    const r2 = await svc2.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);
    check('C7 尘埃窗 share 高但 buyBnb<1 可豁免', [r2.earlyTradesTop1BuySharePct, r2.earlyTradesBuyBnb], [60, 0.5]);
  }
  {
    // ticks 查询异常 → _getEmptyResult 0 值放行
    const errSupabase = { from() { return chainStub({ data: null, error: { message: 'db down' } }); } };
    const svc = new EarlyParticipantCheckService(logger, {}, errSupabase);
    const result = await svc.performCheck(TOKEN, null, 'bsc', 1000, 1080, 0);
    check('C8 查询异常 → pct 0 放行', result.earlyTradesTop1BuySharePct, 0);
    check('C9 查询异常 → covered 0', result.earlyTradesTop1BuyCovered, 0);
  }

  // ════════ D. 源码口径防回归 ════════
  console.log('\nD. 源码口径防回归');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const emptyKeys = svc.getEmptyFactorValues();
    check('D1 getEmptyFactorValues 含 4 键且为 0（null 会让 <60 恒 false 误拦）', [
      emptyKeys.earlyTradesTop1BuySharePct, emptyKeys.earlyTradesTop1BuyBnb,
      emptyKeys.earlyTradesBuyBnb, emptyKeys.earlyTradesTop1BuyCovered,
    ], [0, 0, 0, 0]);

    const er = svc._getEmptyResult();
    check('D2 _getEmptyResult 含 4 键且为 0', [
      er.earlyTradesTop1BuySharePct, er.earlyTradesTop1BuyBnb,
      er.earlyTradesBuyBnb, er.earlyTradesTop1BuyCovered,
    ], [0, 0, 0, 0]);

    const pbs = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'PreBuyCheckService.js'), 'utf8');
    check('D3 PreBuyCheckService context 含 4 键', [
      pbs.includes('earlyTradesTop1BuySharePct: earlyParticipantCheck.earlyTradesTop1BuySharePct ?? 0'),
      pbs.includes('earlyTradesTop1BuyBnb: earlyParticipantCheck.earlyTradesTop1BuyBnb ?? 0'),
      pbs.includes('earlyTradesBuyBnb: earlyParticipantCheck.earlyTradesBuyBnb ?? 0'),
      pbs.includes('earlyTradesTop1BuyCovered: earlyParticipantCheck.earlyTradesTop1BuyCovered ?? 0'),
    ], [true, true, true, true]);

    const fv = buildPreBuyCheckFactorValues({ earlyTradesTop1BuySharePct: 65.7, earlyTradesTop1BuyBnb: 3, earlyTradesBuyBnb: 4.567, earlyTradesTop1BuyCovered: 1 });
    check('D4 FactorBuilder 映射透传', [
      fv.earlyTradesTop1BuySharePct, fv.earlyTradesTop1BuyBnb,
      fv.earlyTradesBuyBnb, fv.earlyTradesTop1BuyCovered,
    ], [65.7, 3, 4.567, 1]);
    const fvEmpty = buildPreBuyCheckFactorValues({});
    check('D5 FactorBuilder 缺省 0（不落 null）', [
      fvEmpty.earlyTradesTop1BuySharePct, fvEmpty.earlyTradesTop1BuyBnb,
      fvEmpty.earlyTradesBuyBnb, fvEmpty.earlyTradesTop1BuyCovered,
    ], [0, 0, 0, 0]);

    // 语义防混：与既有 walletTop1VolumeRatio（买卖混合）是两个因子
    check('D6 与 walletTop1VolumeRatio 键名区分（防误以为同口径）',
      fv.earlyTradesTop1BuySharePct !== undefined && fv.walletTop1VolumeRatio !== undefined, true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
