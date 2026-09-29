#!/usr/bin/env node
/**
 * sniper 持仓比例因子（虚假流动性防线）——本地零 DB 单测（打桩 supabase）
 *
 * 背景（2026-09-29 用户裁定，显化之歌 0x1684e8f4…17777 案衍生）：
 *   sniper 不打标签（wallets 表方案已否决回滚），运行时条件判断纯函数；
 *   衍生 sniper 持仓比例因子拦截 sniper 聚集票。防线分工：作弊票 TPA /
 *   sniper 聚集票 sniperPct / uniformBuyCluster 已弃用（因子保留计算不引用）。
 *
 * 覆盖：
 *   A. isSniperProfile 判定矩阵（tc 门 / hold 主判 / null+sym 补判 / 排除分支）
 *   B. SniperFlagCache（缓存命中不重查 / miss 缓存为 false / 查询失败不写缓存 /
 *      supabase 未注入放行 / 大小写归一 / 批 100 分批）
 *   C. _calculateSniperHolding 净持仓聚合（买卖混合 / 已清仓与净卖剔除 /
 *      协议地址剔除 / 空窗 / covered 矩阵）
 *   D. performCheck 集成（链式 stub ticks+画像，因子键与数值 / 二次调用画像零重查 /
 *      ticks 查询异常走 _getEmptyResult 0 值放行）
 *   E. 源码口径防回归（empty 两路径 4 键 / PreBuyCheckService context /
 *      FactorBuilder 映射含 4 键）
 *
 * 用法：node scripts/_test_sniper_factor.cjs
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

/** 按表名分发的 supabase 打桩（计数器供缓存断言） */
function makeSupabase({ ticks, profiles, counters }) {
  return {
    from(table) {
      if (table === 'wss_price_ticks') {
        counters.tickQueries++;
        return chainStub({ data: ticks, error: null });
      }
      if (table === 'wallet_offline_profiles') {
        counters.profileQueries++;
        return chainStub({ data: profiles, error: null });
      }
      return chainStub({ data: [], error: null });
    }
  };
}

const PROTOCOL = '0x000006b7be706cdb1e5a43c9fd974c0000000091';
const TOKEN = '0x1684e8f48e3a408d77b02adafddb7acc88b17777';

/** 构造 _mapTickRow 输入形状的 tick 行（block_time ISO） */
function tick(trader, type, tokenAmount, blockTimeSec) {
  return {
    token_address: TOKEN,
    tx_hash: '0x' + Math.random().toString(16).slice(2).padEnd(8, '0'),
    log_index: Math.floor(Math.random() * 1000),
    trade_type: type,
    trader_address: trader,
    price_usd: 0.00001,
    bnb_amount: 0.1,
    token_amount: tokenAmount,
    block_number: 1000,
    block_time: new Date(blockTimeSec * 1000).toISOString(),
  };
}

async function main() {
  const { isSniperProfile, SniperFlagCache, PROTOCOL_ADDRS } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'sniper-detector.js')
  );
  const { EarlyParticipantCheckService } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'EarlyParticipantCheckService.js')
  );
  const { buildPreBuyCheckFactorValues } = require(
    path.join(__dirname, '..', 'src', 'trading-engine', 'core', 'FactorBuilder.js')
  );

  // ════════ A. isSniperProfile 判定矩阵 ════════
  console.log('\nA. isSniperProfile 判定矩阵');
  check('A1 null 画像 → false', isSniperProfile(null), false);
  check('A2 undefined 画像 → false', isSniperProfile(undefined), false);
  check('A3 空对象 → false', isSniperProfile({}), false);
  check('A4 tc<100 短持仓也不判（tc=99, hold=10）', isSniperProfile({ tokenCount: 99, medianHoldSeconds: 10 }), false);
  check('A5 主判命中 hold=48', isSniperProfile({ tokenCount: 500, medianHoldSeconds: 48 }), true);
  check('A6 主判命中 hold=0（极速平仓合法值）', isSniperProfile({ tokenCount: 100, medianHoldSeconds: 0 }), true);
  check('A7 主判命中 hold=299（边界 <300）', isSniperProfile({ tokenCount: 100, medianHoldSeconds: 299 }), true);
  check('A8 hold=300 排除（库存调仓/CEX 热钱包）', isSniperProfile({ tokenCount: 500, medianHoldSeconds: 300 }), false);
  check('A9 hold 大值排除', isSniperProfile({ tokenCount: 5000, medianHoldSeconds: 86400 }), false);
  check('A10 hold 负值排除（脏数据）', isSniperProfile({ tokenCount: 500, medianHoldSeconds: -1 }), false);
  check('A11 补判命中 null hold + sym=0 + 200 笔', isSniperProfile({ tokenCount: 200, medianHoldSeconds: null, buyCount: 100, sellCount: 100 }), true);
  check('A12 补判 sym<0.1 边界（60/55 → 0.0455）', isSniperProfile({ tokenCount: 200, medianHoldSeconds: null, buyCount: 60, sellCount: 55 }), true);
  check('A13 补判 sym>=0.1 拒（60/40 → 0.2）', isSniperProfile({ tokenCount: 200, medianHoldSeconds: null, buyCount: 60, sellCount: 40 }), false);
  check('A14 补判笔数<40 拒（sym=0 但 30 笔）', isSniperProfile({ tokenCount: 200, medianHoldSeconds: null, buyCount: 15, sellCount: 15 }), false);
  check('A15 补判 0 笔拒（除零保护）', isSniperProfile({ tokenCount: 200, medianHoldSeconds: null, buyCount: 0, sellCount: 0 }), false);
  check('A16 补判 tc 门独立（tc=99 对称 200 笔也不判）', isSniperProfile({ tokenCount: 99, medianHoldSeconds: null, buyCount: 100, sellCount: 100 }), false);
  check('A17 tokenCount 非数值脏值拒（NaN 比较恒 false）', isSniperProfile({ tokenCount: 'garbage', medianHoldSeconds: 10 }), false);

  // ════════ B. SniperFlagCache ════════
  console.log('\nB. SniperFlagCache');
  {
    const counters = { profileQueries: 0 };
    const sniperAddr = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const retailAddr = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const cache = new SniperFlagCache(logger);
    const supabase = makeSupabase({
      counters,
      profiles: [
        { address: sniperAddr, profile: { tokenCount: 500, medianHoldSeconds: 48 } },
      ],
    });

    const r1 = await cache.flagsFor(supabase, [sniperAddr, retailAddr]);
    check('B1 首查：sniper 命中', r1.get(sniperAddr), true);
    check('B2 首查：画像 miss = 非 sniper', r1.get(retailAddr), false);
    check('B3 首查发 1 次查询', counters.profileQueries, 1);
    check('B4 首查后缓存 2 条（miss 也缓存）', cache.size, 2);

    const r2 = await cache.flagsFor(supabase, [sniperAddr, retailAddr]);
    check('B5 二次全缓存命中零查询', counters.profileQueries, 1);
    check('B6 二次结果一致 sniper', r2.get(sniperAddr), true);

    const r3 = await cache.flagsFor(supabase, [sniperAddr.toUpperCase()]);
    check('B7 大小写归一命中同缓存', r3.get(sniperAddr), true);
    check('B8 大小写归一零新查询', counters.profileQueries, 1);

    const r4 = await cache.flagsFor(null, [retailAddr]);
    check('B9 supabase 未注入 → false 放行', r4.get(retailAddr), false);
    check('B10 未注入不写缓存（仍 2 条）', cache.size, 2);
  }
  {
    // 查询失败 fail-open：全 false 且不写缓存（瞬时错误不固化为永久 false）
    const counters = { profileQueries: 0 };
    const cache = new SniperFlagCache(logger);
    const errSupabase = {
      from(table) {
        counters.profileQueries++;
        return chainStub({ data: null, error: { message: 'connection reset' } });
      }
    };
    const addr = '0xcccccccccccccccccccccccccccccccccccccccc';
    const r1 = await cache.flagsFor(errSupabase, [addr]);
    check('B11 查询失败 → false 放行', r1.get(addr), false);
    check('B12 查询失败不写缓存', cache.size, 0);
    const r2 = await cache.flagsFor(errSupabase, [addr]);
    check('B13 失败后不缓存 → 下次仍会重试查询', counters.profileQueries, 2);
  }
  {
    // 批 100 分批：120 地址 → 2 次查询
    const counters = { profileQueries: 0 };
    const cache = new SniperFlagCache(logger);
    const addrs = Array.from({ length: 120 }, (_, i) =>
      (0x1000 + i).toString(16).padStart(40, 'd'));
    const supabase = makeSupabase({ counters, profiles: [] });
    await cache.flagsFor(supabase, addrs);
    check('B14 120 地址分 2 批查询', counters.profileQueries, 2);
    check('B15 120 地址全 miss 缓存', cache.size, 120);
  }

  // ════════ C. _calculateSniperHolding 净持仓聚合 ════════
  console.log('\nC. _calculateSniperHolding 净持仓聚合');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const sniper = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const retail = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const washed = '0xdddddddddddddddddddddddddddddddddddddddd'; // 买 100 卖 100 全清
    const netSeller = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'; // 买 10 卖 50 净卖

    // 打桩画像查询（svc.supabase 为 null → flagsFor fail-open 全 false；直接打桩缓存）
    svc._sniperFlagCache = {
      flagsFor: async (supabase, addresses) => {
        const m = new Map();
        for (const a of addresses) m.set(a, a === sniper);
        return m;
      }
    };

    const LAUNCH = 1000, CHECK = 1080; // age 80s ≤ 90s → covered
    const mk = (trader, type, amt) => ({ // _mapTickRow 后的形状（token 买/WBNB 卖）
      wallet_address: trader, from_address: trader,
      to_token: type === 'buy' ? TOKEN : '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
      token_amount: amt, bnb_amount: 0.1,
    });

    const trades = [
      mk(sniper, 'buy', 1000), mk(sniper, 'sell', 200),   // net 800
      mk(retail, 'buy', 400),                              // net 400
      mk(washed, 'buy', 100), mk(washed, 'sell', 100),     // net 0 剔除
      mk(netSeller, 'buy', 10), mk(netSeller, 'sell', 50), // net -40 剔除
      mk(PROTOCOL, 'buy', 999999),                         // 协议地址剔除
    ];
    const r = await svc._calculateSniperHolding(trades, TOKEN, LAUNCH, CHECK);
    check('C1 净持仓聚合 pct=800/1200', r.pct, 66.67);
    check('C2 sniperWallets=1', r.wallets, 1);
    check('C3 holders=2（全清/净卖/协议不计）', r.holders, 2);
    check('C4 covered=1', r.covered, 1);

    check('C5 空窗 covered=1 pct=0', (await svc._calculateSniperHolding([], TOKEN, LAUNCH, CHECK)),
      { pct: 0, wallets: 0, holders: 0, covered: 1 });

    check('C6 launchAt=null → covered=0 0 值放行',
      await svc._calculateSniperHolding(trades, TOKEN, null, CHECK),
      { pct: 0, wallets: 0, holders: 0, covered: 0 });
    check('C7 launchAt=0 → covered=0', (await svc._calculateSniperHolding(trades, TOKEN, 0, CHECK)).covered, 0);
    check('C8 age>90s → covered=0', (await svc._calculateSniperHolding(trades, TOKEN, LAUNCH, CHECK + 91)).covered, 0);
    check('C9 age=90s 边界 covered=1', (await svc._calculateSniperHolding(trades, TOKEN, LAUNCH, CHECK + 10)).covered, 1);

    // 全员净卖/清仓 → posTotal<=0 → pct 0 covered 1
    const allOut = [mk(retail, 'buy', 50), mk(retail, 'sell', 50)];
    check('C10 posTotal<=0 → 0 值 covered=1', await svc._calculateSniperHolding(allOut, TOKEN, LAUNCH, CHECK),
      { pct: 0, wallets: 0, holders: 0, covered: 1 });
  }

  // ════════ D. performCheck 集成 ════════
  console.log('\nD. performCheck 集成（链式 stub ticks+画像）');
  {
    const sniper = '0x1de460f3bd66c67d29e5f90bd0dbb1c8d094e1c2';   // 对倒主力（tc=8729 hold=48）
    const retail = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const LAUNCH = 1000, CHECK = 1080;
    const ticks = [
      tick(sniper, 'buy', 1000, 1005),
      tick(sniper, 'sell', 200, 1010),
      tick(retail, 'buy', 400, 1015),
      tick(PROTOCOL, 'buy', 5000, 1020),
    ];
    const counters = { tickQueries: 0, profileQueries: 0 };
    const supabase = makeSupabase({
      counters,
      ticks,
      profiles: [
        { address: sniper, profile: { tokenCount: 8729, medianHoldSeconds: 48 } },
      ],
    });
    const svc = new EarlyParticipantCheckService(logger, {}, supabase);
    const result = await svc.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);

    check('D1 因子键存在且 pct=800/1200', result.earlyTradesSniperHoldingPct, 66.67);
    check('D2 sniperWallets', result.earlyTradesSniperWallets, 1);
    check('D3 holders', result.earlyTradesSniperHolders, 2);
    check('D4 covered', result.earlyTradesSniperCovered, 1);
    check('D5 ticks 查询 1 次', counters.tickQueries, 1);
    check('D6 画像查询 1 次', counters.profileQueries, 1);

    // 二次调用：画像缓存命中（ticks 仍查，画像零重查）
    const result2 = await svc.performCheck(TOKEN, null, 'bsc', LAUNCH, CHECK, 0);
    check('D7 二次调用画像零重查', counters.profileQueries, 1);
    check('D8 二次调用因子一致', result2.earlyTradesSniperHoldingPct, 66.67);
  }
  {
    // ticks 查询异常 → _getEmptyResult 0 值放行
    const errSupabase = {
      from() { return chainStub({ data: null, error: { message: 'db down' } }); }
    };
    const svc = new EarlyParticipantCheckService(logger, {}, errSupabase);
    const result = await svc.performCheck(TOKEN, null, 'bsc', 1000, 1080, 0);
    check('D9 查询异常 → pct 0 放行', result.earlyTradesSniperHoldingPct, 0);
    check('D10 查询异常 → covered 0', result.earlyTradesSniperCovered, 0);
    check('D11 查询异常 → NoInnerData 标记', result.earlyTradesNoInnerData, 1);
  }

  // ════════ E. 源码口径防回归 ════════
  console.log('\nE. 源码口径防回归');
  {
    const svc = new EarlyParticipantCheckService(logger, {}, null);
    const emptyKeys = svc.getEmptyFactorValues();
    check('E1 getEmptyFactorValues 含 4 键且为 0（null 会让 <50 恒 false 误拦）', [
      emptyKeys.earlyTradesSniperHoldingPct, emptyKeys.earlyTradesSniperWallets,
      emptyKeys.earlyTradesSniperHolders, emptyKeys.earlyTradesSniperCovered,
    ], [0, 0, 0, 0]);

    const er = svc._getEmptyResult();
    check('E2 _getEmptyResult 含 4 键且为 0', [
      er.earlyTradesSniperHoldingPct, er.earlyTradesSniperWallets,
      er.earlyTradesSniperHolders, er.earlyTradesSniperCovered,
    ], [0, 0, 0, 0]);

    const preBuy = path.join(__dirname, '..', 'src', 'trading-engine', 'pre-check', 'PreBuyCheckService.js');
    const pbs = readFileSync(preBuy, 'utf8');
    check('E3 PreBuyCheckService context 含 4 键', [
      pbs.includes('earlyTradesSniperHoldingPct: earlyParticipantCheck.earlyTradesSniperHoldingPct ?? 0'),
      pbs.includes('earlyTradesSniperWallets: earlyParticipantCheck.earlyTradesSniperWallets ?? 0'),
      pbs.includes('earlyTradesSniperHolders: earlyParticipantCheck.earlyTradesSniperHolders ?? 0'),
      pbs.includes('earlyTradesSniperCovered: earlyParticipantCheck.earlyTradesSniperCovered ?? 0'),
    ], [true, true, true, true]);

    const fv = buildPreBuyCheckFactorValues({ earlyTradesSniperHoldingPct: 42.5, earlyTradesSniperWallets: 2, earlyTradesSniperHolders: 9, earlyTradesSniperCovered: 1 });
    check('E4 FactorBuilder 映射透传', [fv.earlyTradesSniperHoldingPct, fv.earlyTradesSniperWallets, fv.earlyTradesSniperHolders, fv.earlyTradesSniperCovered], [42.5, 2, 9, 1]);
    const fvEmpty = buildPreBuyCheckFactorValues({});
    check('E5 FactorBuilder 缺省 0（不落 null）', [
      fvEmpty.earlyTradesSniperHoldingPct, fvEmpty.earlyTradesSniperWallets,
      fvEmpty.earlyTradesSniperHolders, fvEmpty.earlyTradesSniperCovered,
    ], [0, 0, 0, 0]);

    check('E6 PROTOCOL_ADDRS 含 four.meme 内盘官方', PROTOCOL_ADDRS.has(PROTOCOL), true);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
