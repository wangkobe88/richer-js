#!/usr/bin/env node
/**
 * 每钱包笔数因子（对倒高频作业拦截）+ 找角度语言门——本地零 DB 零网络单测
 *
 * 背景（猪五花案 2026-10-15，0x7603c74b…7777）：14 钱包 t+6s 同刻起跑等额分仓，
 * 90s 183 笔/24 钱包=7.6 笔/钱包（散户 1~2）。门被绕过根因之一是「笔数/钱包」
 * 维度缺失——top1/bundler/sniper 全被分仓摊薄，routerPct 反超门上限。
 * 同案衍生：找角度语言门（用户裁定：找角度发币是常见方式，策略性收窄只玩
 * 中文盘；gampsito 英文找角度推「Imma redeploy it（猪五花）」）。
 *
 * 覆盖：
 *   A. _calculateBasicStats 每钱包聚合矩阵（多钱包多笔 / 单钱包 / 大小写归一 / 空窗 0）
 *   B. 猪五花事故现场反证（183 笔/24 钱包简化复刻 → tpw 7.6+ / max 15）
 *   C. performCheck 集成（复用同一 ticks 查询零新增 / 因子键与数值）
 *   D. 查询异常 → empty 两路径新键 0 值放行（拦截写法 <N，0 恒放行）
 *   E. 源码口径：PreBuyCheckService context / FactorBuilder / 因子元数据表含新键
 *   F. 语言门矩阵（classifyTweetType gampsito 形态 → angle_seeking；
 *      _cjkRatio 源码提取 eval：猪五花 3 汉字英文推 ≈0.097；规则键源码口径）
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

const TOKEN = '0x7603c74b6c0236e3284ca3a37c82799498d877777';

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
    // 3 钱包 10 笔（w1×6 / w2×3 / w3×1）→ tpw=3.33 max=6
    const trades = [];
    for (let i = 0; i < 6; i++) trades.push(tick(w1, 'buy', 0.1, 1000 + i));
    for (let i = 0; i < 3; i++) trades.push(tick(w2, 'buy', 0.1, 1000 + i));
    trades.push(tick(w3, 'sell', 0.1, 1000));
    const mapped = trades.map(t => svc._mapTickRow ? svc._mapTickRow(t) : t);
    const stats = svc._calculateBasicStats(mapped);
    check('tpw 3 钱包 10 笔', stats.tradesPerWallet, 3.33);
    check('maxWalletTrades', stats.maxWalletTrades, 6);

    // 大小写归一：同地址大小写两种写法 → 同一钱包计数
    const trades2 = [tick(w1.toUpperCase(), 'buy', 0.1, 1000), tick(w1, 'buy', 0.1, 1001)];
    const stats2 = svc._calculateBasicStats(trades2.map(t => t));
    check('大小写归一 1 钱包 2 笔', [stats2.uniqueWallets, stats2.tradesPerWallet, stats2.maxWalletTrades], [1, 2, 2]);

    // 空窗
    const stats3 = svc._calculateBasicStats([]);
    check('空窗 0 值', [stats3.tradesPerWallet, stats3.maxWalletTrades], [0, 0]);
  }

  // ════════ B. 猪五花事故现场反证 ════════
  console.log('\nB. 猪五花事故现场反证（2026-10-15 首窗形状简化复刻）');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const trades = [];
    // 14 作业钱包各 12 笔（分仓高频对倒）+ 1 钱包 15 笔 + 9 散户各 1 笔 ≈ 183 笔/24 钱包
    for (let w = 0; w < 14; w++) {
      const addr = '0x' + (w + 1).toString(16).padStart(40, 'd');
      for (let i = 0; i < 12; i++) trades.push(tick(addr, 'buy', [0.594, 0.414, 0.298][i % 3], 1000 + i));
    }
    const hot = '0x' + 'e'.repeat(40);
    for (let i = 0; i < 15; i++) trades.push(tick(hot, 'buy', 0.05, 1000 + i));
    for (let w = 0; w < 9; w++) {
      const addr = '0x' + (w + 100).toString(16).padStart(40, 'f');
      trades.push(tick(addr, 'buy', 0.01, 1010));
    }
    const stats = svc._calculateBasicStats(trades);
    check('tpw = 7.6（183/24）', stats.tradesPerWallet, 7.63);
    check('maxWalletTrades = 15', stats.maxWalletTrades, 15);
    // 事故反证：tpw>=4 门会拦下本案（散户 1~2 恒放行）
    check('事故反证：tpw 门 4 阈值命中', stats.tradesPerWallet >= 4, true);
  }

  // ════════ C. performCheck 集成 ════════
  console.log('\nC. performCheck 集成');
  {
    let tickQueries = 0;
    const supabase = {
      from(table) {
        if (table === 'wss_price_ticks') {
          tickQueries++;
          const w1 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', w2 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
          const data = [];
          for (let i = 0; i < 8; i++) data.push(tick(w1, 'buy', 0.1, 1000 + i));
          for (let i = 0; i < 2; i++) data.push(tick(w2, 'buy', 0.1, 1000 + i));
          return chainStub({ data, error: null });
        }
        return chainStub({ data: [], error: null });
      },
    };
    const svc = new EarlyParticipantCheckService(logger, {}, supabase);
    const res = await svc.performCheck(TOKEN, 1000000, 1000000 + 60);
    check('earlyTradesPerWallet', res.earlyTradesPerWallet, 5);
    check('earlyTradesMaxWalletTrades', res.earlyTradesMaxWalletTrades, 8);
    check('同一 ticks 查询零新增', tickQueries, 1);
    // FactorBuilder 透传（回测兼容）
    const fb = buildPreBuyCheckFactorValues(res);
    check('FactorBuilder 透传', [fb.earlyTradesPerWallet, fb.earlyTradesMaxWalletTrades], [5, 8]);
  }

  // ════════ D. 查询异常 → 0 值放行 ════════
  console.log('\nD. 查询异常路径');
  {
    const supabaseErr = { from: () => chainStub({ data: null, error: new Error('db down') }) };
    const svc = new EarlyParticipantCheckService(logger, {}, supabaseErr);
    const res = await svc.performCheck(TOKEN, 1000000, 1000000 + 60);
    check('异常 0 值放行', [res.earlyTradesPerWallet, res.earlyTradesMaxWalletTrades], [0, 0]);
    const fb = buildPreBuyCheckFactorValues(res);
    check('异常 FactorBuilder 0', [fb.earlyTradesPerWallet, fb.earlyTradesMaxWalletTrades], [0, 0]);
  }

  // ════════ E. 源码口径（context / 元数据表 / empty 两路径） ════════
  console.log('\nE. 源码口径');
  {
    const preBuySrc = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'PreBuyCheckService.js'), 'utf8');
    check('PreBuyCheckService context 注入', preBuySrc.includes('earlyTradesPerWallet: earlyParticipantCheck.earlyTradesPerWallet ?? 0')
      && preBuySrc.includes('earlyTradesMaxWalletTrades: earlyParticipantCheck.earlyTradesMaxWalletTrades ?? 0'), true);
    check('因子元数据表注册', preBuySrc.includes('earlyTradesPerWallet:') && preBuySrc.includes('earlyTradesMaxWalletTrades:'), true);
    const epSrc = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'EarlyParticipantCheckService.js'), 'utf8');
    const occurrences = (epSrc.match(/earlyTradesPerWallet:/g) || []).length;
    check('empty 两路径覆盖（result 组装+空值+basicStats return）', occurrences >= 3, true);
    const fbSrc = readFileSync(path.join(__dirname, '..', 'src', 'trading-engine', 'core', 'FactorBuilder.js'), 'utf8');
    check('FactorBuilder 映射含两键', fbSrc.includes('earlyTradesPerWallet:') && fbSrc.includes('earlyTradesMaxWalletTrades:'), true);
  }

  // ════════ F. 语言门矩阵（ESM：classifyTweetType + _cjkRatio 源码提取） ════════
  console.log('\nF. 找角度语言门矩阵');
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
    check('gampsito 形态 → angle_seeking（frequent-issuers）', classifyTweetType(g).type, 'angle_seeking');
    // 中文找角度推：分类 unknown（非名单账号中间地带）→ 门罩不住=放行（fail-open）
    const zh = { ...g, author_screen_name: 'someone_cn', text: '兄弟们 猪五花 这个梗太好了 我要发一个币' };
    check('中文推不拦（unknown 放行）', classifyTweetType(zh).type === 'angle_seeking', false);
    // 大号英文推：direct_tweet → 门不触发
    const big = { ...g, author_screen_name: 'binance', author_followers_count: 10000000, metrics: { favorite_count: 5000, retweet_count: 1000 }, text: 'Exciting launch today!' };
    check('大号英文不拦（direct_tweet）', classifyTweetType(big).type, 'direct_tweet');

    // _cjkRatio：从 pre-check-service.mjs 源码提取函数体 eval（源码口径对拍，防实现漂移）
    const pcSrc = readFileSync(path.join(__dirname, '..', 'src', 'narrative', 'analyzer', 'services', 'pre-check-service.mjs'), 'utf8');
    const fnMatch = pcSrc.match(/function _cjkRatio\(text\) \{[\s\S]*?\n\}/);
    check('_cjkRatio 函数存在于源码', Boolean(fnMatch), true);
    if (fnMatch) {
      const _cjkRatio = eval('(' + fnMatch[0].replace(/^function _cjkRatio/, 'function') + ')');
      check('猪五花 3 汉字英文推 cjk≈0.097 <0.2 拦', +( _cjkRatio('Imma redeploy it 猪五花 PorkBelly on BSC').toFixed(3)), 0.097);
      check('中文推 cjk=1', _cjkRatio('兄弟们猪五花'), 1);
      check('纯符号 null 放行', _cjkRatio('!!! 123 😂'), null);
    }
    // 规则挂点与默认值源码口径
    check('规则键 angle_tweet_not_chinese', pcSrc.includes("'angle_tweet_not_chinese'"), true);
    check('门默认开（enabled !== false）', pcSrc.includes('cjkGate?.enabled !== false'), true);
    check('默认阈值 0.2', pcSrc.includes("? cjkGate.minCjkRatio : 0.2"), true);
    check('fail-open 分类异常放行', pcSrc.includes('找角度语言门分类失败（放行）'), true);
    // 配置文件显式声明
    const cfg = JSON.parse(readFileSync(path.join(__dirname, '..', 'config', 'default.json'), 'utf8'));
    check('config 门配置', cfg.narrative.angleTweetCjkGate, { enabled: true, minCjkRatio: 0.2 });
    check('gampsito 在黑名单', cfg.narrative.twitterBlacklist.includes('gampsito'), true);
    // frequent-issuers 源码口径
    const fiSrc = readFileSync(path.join(__dirname, '..', 'src', 'narrative', 'analyzer', 'services', 'frequent-issuers.mjs'), 'utf8');
    check("frequent-issuers 含 gampsito", /'gampsito'/.test(fiSrc), true);
  }

  console.log(`\n═══════ _test_early_per_wallet_factors: ${pass} passed, ${fail} failed ══════`);
  if (fail > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
