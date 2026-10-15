#!/usr/bin/env node
/**
 * 每钱包笔数因子（对倒高频作业拦截）+ 找角度语言门——本地零 DB 零网络单测
 *
 * 背景（猪五花案 2026-10-15，0x7603c74b…7777）：14 钱包 t+6s 同刻起跑等额分仓，
 * 90s 183 笔/24 钱包=7.6 笔/钱包（散户 1~2）。门被绕过根因之一是「笔数/钱包」
 * 维度缺失——top1/bundler/sniper 全被分仓摊薄，routerPct 反超门上限。
 * 同案衍生：gampsito 黑名单（用户终裁 2026-10-15：语言门撤销不加，只黑名单单拦）。
 *
 * 覆盖：
 *   A. _calculateBasicStats 每钱包聚合矩阵（多钱包多笔 / 单钱包 / 大小写归一 / 空窗 0）
 *   B. 猪五花事故现场反证（183 笔/24 钱包简化复刻 → tpw 7.63 / max 15）
 *   C. performCheck 集成（复用同一 ticks 查询零新增 / 因子键与数值 / FactorBuilder 透传）
 *   D. 查询异常 → empty 两路径新键 0 值放行（拦截写法 <N，0 恒放行）
 *   E. 源码口径：PreBuyCheckService context / FactorBuilder / empty 两路径含新键
 *   F. gampsito 黑名单与分类路由（classifyTweetType frequent-issuers 命中 angle_seeking；
 *      语言门零残留防回流）
 *
 * 用法：node scripts/_test_early_per_wallet_factors.cjs
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
        if (counters) counters.tickQueries = (counters.tickQueries || 0) + 1;
        return chainStub({ data: ticks, error: null });
      }
      return chainStub({ data: [], error: null });
    },
  };
}

const TOKEN = '0x7603c74b6c0236e3284ca3a37c82799498d877777';

/** _mapTickRow 后形状的买/卖交易（_calculateBasicStats 直接消费） */
function mk(wallet, type) {
  return { wallet_address: wallet, from_address: wallet, trade_type: type, from_usd: 5, to_usd: 5 };
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

  // ════════ A. _calculateBasicStats 每钱包聚合矩阵 ════════
  console.log('\nA. 每钱包聚合矩阵');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const w1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const w2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const w3 = '0xcccccccccccccccccccccccccccccccccccccccc';
    // 3 钱包 10 笔（w1×6 / w2×3 / w3×1，买卖混合都计）→ tpw=3.33 max=6
    const trades = [];
    for (let i = 0; i < 6; i++) trades.push(mk(w1, 'buy'));
    for (let i = 0; i < 3; i++) trades.push(mk(w2, 'buy'));
    trades.push(mk(w3, 'sell'));
    const stats = svc._calculateBasicStats(trades);
    check('A1 tpw 3 钱包 10 笔=3.33', stats.tradesPerWallet, 3.33);
    check('A2 maxWalletTrades=6', stats.maxWalletTrades, 6);
    check('A3 买卖混合照计（tradeCount 口径同源）', stats.totalCount, 10);

    // 大小写归一：同地址大小写两种写法 → 同一钱包计数
    const stats2 = svc._calculateBasicStats([mk(w1.toUpperCase(), 'buy'), mk(w1, 'buy')]);
    check('A4 大小写归一 1 钱包 2 笔', [stats2.uniqueWallets, stats2.tradesPerWallet, stats2.maxWalletTrades], [1, 2, 2]);

    // 空窗 0 值
    const stats3 = svc._calculateBasicStats([]);
    check('A5 空窗 0 值', [stats3.tradesPerWallet, stats3.maxWalletTrades], [0, 0]);
  }

  // ════════ B. 猪五花事故现场反证 ════════
  console.log('\nB. 猪五花事故现场反证（2026-10-15 首窗形状简化复刻）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const trades = [];
    // 14 作业钱包各 12 笔（分仓高频对倒）+ 1 热钱包 6 笔 + 9 散户各 1 笔 = 183 笔/24 钱包
    for (let w = 0; w < 14; w++) {
      const addr = '0x' + (w + 1).toString(16).padStart(40, 'd');
      for (let i = 0; i < 12; i++) trades.push(mk(addr, 'buy'));
    }
    const hot = '0x' + 'e'.repeat(40);
    for (let i = 0; i < 6; i++) trades.push(mk(hot, 'buy'));
    for (let w = 0; w < 9; w++) {
      const addr = '0x' + (w + 100).toString(16).padStart(40, 'f');
      trades.push(mk(addr, 'buy'));
    }
    const stats = svc._calculateBasicStats(trades);
    check('B1 tpw = 7.63（183/24，实案口径）', stats.tradesPerWallet, 7.63);
    check('B2 maxWalletTrades = 12', stats.maxWalletTrades, 12);
    // 事故反证：tpw>=4 门会拦下本案（散户 1~2 恒放行）
    check('B3 事故反证：tpw 门 4 阈值命中', stats.tradesPerWallet >= 4, true);
    check('B4 事故反证：max 门 8 阈值命中', stats.maxWalletTrades >= 8, true);
  }

  // ════════ C. performCheck 集成 ════════
  console.log('\nC. performCheck 集成');
  {
    const w1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', w2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const LAUNCH = 1000, CHECK = 1080;
    const ticks = [];
    for (let i = 0; i < 8; i++) ticks.push(tick(w1, 'buy', 0.1, 1000 + i));   // w1×8
    for (let i = 0; i < 2; i++) ticks.push(tick(w2, 'buy', 0.1, 1080 - i));   // w2×2
    const counters = { tickQueries: 0 };
    const svc = new EarlyParticipantCheckService(logger, {}, makeSupabase({ ticks, counters }));
    const res = await svc.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);
    check('C1 earlyTradesPerWallet=5', res.earlyTradesPerWallet, 5);
    check('C2 earlyTradesMaxWalletTrades=8', res.earlyTradesMaxWalletTrades, 8);
    check('C3 同一 ticks 查询零新增', counters.tickQueries, 1);
    check('C4 既有因子并存无回归', res.earlyTradesTop1BuySharePct !== undefined, true);
    // FactorBuilder 透传（回测兼容）
    const fb = buildPreBuyCheckFactorValues(res);
    check('C5 FactorBuilder 透传', [fb.earlyTradesPerWallet, fb.earlyTradesMaxWalletTrades], [5, 8]);
  }

  // ════════ D. 查询异常 / 空窗 → 0 值放行 ════════
  console.log('\nD. 查询异常与空窗路径');
  {
    const errSupabase = { from: () => chainStub({ data: null, error: { message: 'db down' } }) };
    const svc = new EarlyParticipantCheckService(logger, {}, errSupabase);
    const res = await svc.performCheck(TOKEN, null, 'bsc', 1000, 1080, 0);
    check('D1 异常 0 值放行', [res.earlyTradesPerWallet, res.earlyTradesMaxWalletTrades], [0, 0]);
    const fb = buildPreBuyCheckFactorValues(res);
    check('D2 异常 FactorBuilder 0', [fb.earlyTradesPerWallet, fb.earlyTradesMaxWalletTrades], [0, 0]);
    // 空窗（查到 0 行）→ 真实零统计路径
    const empty = new EarlyParticipantCheckService(logger, {}, makeSupabase({ ticks: [] }));
    const res2 = await empty.performCheck(TOKEN, null, 'bsc', 1000, 1080, 0);
    check('D3 空窗 0 值', [res2.earlyTradesPerWallet, res2.earlyTradesMaxWalletTrades], [0, 0]);
    // getEmptyFactorValues（回测缺数据键集）
    check('D4 getEmptyFactorValues 两键 0（null 会让 <N 恒 false 误拦）',
      [empty.getEmptyFactorValues().earlyTradesPerWallet, empty.getEmptyFactorValues().earlyTradesMaxWalletTrades], [0, 0]);
  }

  // ════════ E. 源码口径（context / 元数据表 / empty 两路径） ════════
  console.log('\nE. 源码口径');
  {
    const preBuySrc = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'PreBuyCheckService.js'), 'utf8');
    check('E1 PreBuyCheckService context 注入', preBuySrc.includes('earlyTradesPerWallet: earlyParticipantCheck.earlyTradesPerWallet ?? 0')
      && preBuySrc.includes('earlyTradesMaxWalletTrades: earlyParticipantCheck.earlyTradesMaxWalletTrades ?? 0'), true);
    check('E2 因子元数据表注册', preBuySrc.includes('earlyTradesPerWallet:') && preBuySrc.includes('earlyTradesMaxWalletTrades:'), true);
    const epSrc = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'EarlyParticipantCheckService.js'), 'utf8');
    // result 组装 + _getEmptyResult + getEmptyFactorValues 三处必须都在（漏任一处=该路径 undefined/null 误拦）
    check('E3 empty 三路径覆盖（result 组装+_getEmptyResult+getEmptyFactorValues）', (epSrc.match(/earlyTradesPerWallet: /g) || []).length, 3);
    check('E4 basicStats return 用短键名', epSrc.includes('tradesPerWallet: uniqueWallets.size > 0'), true);
    const fbSrc = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    check('E5 FactorBuilder 映射含两键', fbSrc.includes('earlyTradesPerWallet:') && fbSrc.includes('earlyTradesMaxWalletTrades:'), true);
  }

  // ════════ F. gampsito 黑名单与分类路由（2026-10-15 用户终裁：不加语言门，
  // 中文门代码已撤——本段只锁黑名单与 frequent-issuers 分类路由） ════════
  console.log('\nF. gampsito 黑名单与分类路由');
  {
    const { classifyTweetType } = await import(
      path.join(__dirname, '..', 'src', 'narrative', 'analyzer', 'services', 'tweet-type-classifier.mjs')
    );
    // gampsito 形态：frequent-issuers 命中（分类盲区修复：4642 粉中间地带不再 unknown）
    const g = {
      type: 'tweet', text: 'Imma redeploy it 猪五花 PorkBelly on BSC',
      author_screen_name: 'gampsito', author_followers_count: 4642,
      metrics: { favorite_count: 2, retweet_count: 0 },
    };
    check('F1 gampsito 形态 → angle_seeking（frequent-issuers）', classifyTweetType(g).type, 'angle_seeking');
    // 中文找角度推：非名单账号 → unknown（无门状态，C68 时效门照常消费载体）
    const zh = { ...g, author_screen_name: 'someone_cn', text: '兄弟们 猪五花 这个梗太好了 我要发一个币' };
    check('F2 中文推不再被语言门消费（unknown 分类）', classifyTweetType(zh).type === 'angle_seeking', false);
    // 大号英文推：direct_tweet
    const big = { ...g, author_screen_name: 'binance', author_followers_count: 10000000, metrics: { favorite_count: 5000, retweet_count: 1000 }, text: 'Exciting launch today!' };
    check('F3 大号英文 direct_tweet', classifyTweetType(big).type, 'direct_tweet');

    // 语言门零残留源码口径（防回流：用户终裁撤销该门）
    const pcSrc = readFileSync(path.join(__dirname, '..', 'src', 'narrative', 'analyzer', 'services', 'pre-check-service.mjs'), 'utf8');
    check('F4 语言门规则键零残留', pcSrc.includes('angle_tweet_not_chinese') || pcSrc.includes('_cjkRatio') || pcSrc.includes('angleTweetCjkGate'), false);
    const cfg = JSON.parse(readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
    check('F5 config 语言门段零残留', 'angleTweetCjkGate' in cfg.narrative, false);
    check('F6 gampsito 在黑名单', cfg.narrative.twitterBlacklist.includes('gampsito'), true);
    // frequent-issuers 源码口径
    const fiSrc = readFileSync(path.join(__dirname, '..', 'src', 'narrative', 'analyzer', 'services', 'frequent-issuers.mjs'), 'utf8');
    check('F7 frequent-issuers 含 gampsito', /'gampsito'/.test(fiSrc), true);
  }

  console.log(`\n═══════ _test_early_per_wallet_factors: ${pass} passed, ${fail} failed ═══════`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
