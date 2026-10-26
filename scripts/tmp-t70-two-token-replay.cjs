#!/usr/bin/env node
// T70/T71 反事实重放：智子/币安1986 两票按 buy-v2 v39 新条件逐 tick 重放（跑在 182）
//   新条件 = tradesNetBuyRatio>=40 + tradesRouterPct>=30（全史实时）+ 无 perWallet 臂 + 无 600s 帽
//   GMGN 第二层（bundler65/issuer 分档）不可历史重放——无 API 快照，按缺数据 fail-open 语义注明
require('/home/ubuntu/richer-js/node_modules/dotenv').config({ path: '/home/ubuntu/richer-js/config/.env' });
const { dbManager } = require('/home/ubuntu/richer-js/src/services/dbManager');
const Mod = require('/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator');
const FA = Mod.default || Mod;

const EXP = '71f87b50-fe47-442a-8933-f22ea5d78d3d';
const TOKENS = [
  { addr: '0x4451f373e343fb95c5121863d048597cec5b7777', tag: '智子', rating: 2, readyMs: Date.parse('2026-10-26T04:53:30.478Z') },
  { addr: '0xd6c7e7c95c11524c43e5d13506843fb18aed7777', tag: '币安1986', rating: 3, readyMs: Date.parse('2026-10-26T04:18:47.362Z') },
];
const DUST = 0.001;
const FLAP_TOTAL_SUPPLY = 1e9;

// v39 新条件逐门镜像（null 语义对齐 ConditionEvaluator：< 门 ?? 99 fail、0 语义键 ?? 0）
const gates = f => ({
  time: (f.tokenAgeSec != null && f.tokenAgeSec < 90) || (f.tradeCount >= 25),
  mcapLo: f.marketCap > 3500,
  mcapHi: f.marketCap < 20000,
  rating: f.narrativeRating === 2 || f.narrativeRating === 3,
  slope: f.holderTrendSlope != null && f.holderTrendSlope > 0,
  b1: (f.bundleClusterHoldCircPct ?? 99) < 35,
  b2: (f.top2BundleClusterHoldCircPct ?? 99) < 55,
  b3: (f.top3BundleClusterHoldCircPct ?? 99) < 75,
  top1: (f.top1HolderCircPct ?? 99) < 35,
  copy: (f.maxCopyWalletHolderCircPct ?? 99) < 20,
  router: f.platform !== 'flap' || (f.tradesRouterPct ?? 0) >= 30,
  famous: (f.famousCopyWalletCircPct ?? 0) < 15,
  pop: (f.buyVolumeBnbExSybil ?? 0) >= 1.25 || (f.holdersExSybil ?? 0) >= 10,
  netBuy: (f.tradesNetBuyRatio ?? -1) >= 40,
  sybil: (f.sybilClusterHolderCircPct ?? 0) < 35,
  dd: (f.drawdownFromHighest ?? -100) > -70,
  crash: (f.crashSpeedPctPerSec ?? -100) > -10,
});
const GNAMES = Object.keys(gates({ tradeCount: 0, marketCap: 0, platform: 'x', tokenAgeSec: 0, narrativeRating: null, tradesRouterPct: 0, tradesNetBuyRatio: 0, buyVolumeBnbExSybil: 0, holdersExSybil: 0, famousCopyWalletCircPct: 0, sybilClusterHolderCircPct: 0, drawdownFromHighest: 0, crashSpeedPctPerSec: 0, holderTrendSlope: 0, bundleClusterHoldCircPct: 0, top2BundleClusterHoldCircPct: 0, top3BundleClusterHoldCircPct: 0, top1HolderCircPct: 0, maxCopyWalletHolderCircPct: 0 }));

(async () => {
  const c = dbManager.getClient();
  await Promise.all([FA.loadSybilClusters(), FA.loadCopyWalletRoster(), FA.loadFamousCopyWallets()]);
  const chain = a => a.sort((x, y) => (x.block_number - y.block_number) || (x.log_index - y.log_index));

  for (const T of TOKENS) {
    const mr = await c.from('wss_events').select('payload,platform').eq('kind', 'token_create').eq('token_address', T.addr).order('block_time').limit(1);
    const meta = (mr.data && mr.data[0] && mr.data[0].payload) || null;
    const anchorMs = meta && meta.blockTimeMs ? Number(meta.blockTimeMs) : null;
    if (!anchorMs) { console.log(`[${T.tag}] 无 token_create 锚，跳过`); continue; }
    const supply = meta && Number(meta.totalSupply) > 0 ? Number(meta.totalSupply) : FLAP_TOTAL_SUPPLY;
    const platform = (mr.data[0].platform) || 'fourmeme';
    const winS = new Date(anchorMs - 60 * 1000).toISOString(), winE = new Date(anchorMs + 30 * 60 * 1000).toISOString();
    const r = await c.from('wss_price_ticks').select('id,block_number,log_index,block_time,trader_address,sender_address,trade_type,token_amount,bnb_amount,price_bnb,price_usd,platform')
      .eq('token_address', T.addr).gte('block_time', winS).lte('block_time', winE).order('id').limit(20000);
    if (r.error) { console.log(`[${T.tag}] ticks 查询失败`, JSON.stringify(r.error).slice(0, 120)); continue; }
    const ticks = chain((r.data || []).filter(t => Number(t.bnb_amount) >= DUST));
    console.log(`\n═══ [${T.tag}] ${T.addr} platform=${platform} ticks=${ticks.length}${r.data.length >= 20000 ? '（截断!）' : ''} rating=${T.rating} ready=+${((T.readyMs - anchorMs) / 1000).toFixed(1)}s`);

    const fa = new FA({});
    fa.registerToken(T.addr, { createdAtMs: anchorMs, totalSupply: supply, symbol: T.tag, platform });
    let firstFire = null, firstPassCount = 0;
    const firstPass = {}, lastVal = {};
    const timeline = [];
    let lastSnapSec = -1;
    for (const t of ticks) {
      const ts = Date.parse(t.block_time);
      fa.processTick({ token_address: T.addr, platform, timestamp: ts, block_number: t.block_number, log_index: t.log_index,
        trader_address: t.trader_address, sender_address: t.sender_address, trade_type: t.trade_type,
        token_amount: Number(t.token_amount), bnb_amount: Number(t.bnb_amount || 0),
        price_bnb: Number(t.price_bnb || 0), price_usd: Number(t.price_usd || 0) }, { emitFactors: false });
      const f = fa.buildFactorMap(T.addr, ts) || {};
      f.narrativeRating = ts >= T.readyMs ? T.rating : null;
      const g = gates(f), age = (ts - anchorMs) / 1000;
      let np = 0; for (const k of GNAMES) { if (g[k]) { np++; if (!firstPass[k]) firstPass[k] = age; } else if (!('lastFail' + k)) {} }
      firstPassCount = Math.max(firstPassCount, np);
      for (const k of GNAMES) if (!g[k]) lastVal[k] = age; // 每门最后失败时刻
      if (!firstFire && GNAMES.every(k => g[k])) firstFire = { age, ts, price: f.currentPriceBnb, f: { ...f } };
      // 前 5min 每 15s 采样
      const snapSec = Math.floor(age / 15) * 15;
      if (age > 0 && age <= 300 && snapSec !== lastSnapSec) {
        lastSnapSec = snapSec;
        timeline.push(`${snapSec}s nB=${f.tradesNetBuyRatio ?? '?'} rt=${f.tradesRouterPct ?? '?'} tc=${f.tradeCount} mc=${f.marketCap != null ? Math.round(f.marketCap) : '?'} vol=${(f.buyVolumeBnbExSybil ?? 0).toFixed(2)} hd=${f.holdersExSybil ?? '?'} pass=${np}/${GNAMES.length}${GNAMES.filter(k => !g[k]).length ? ' 缺:' + GNAMES.filter(k => !g[k]).join(',') : ' ✓ALL'}`);
      }
    }
    if (firstFire) {
      const f = firstFire.f;
      console.log(`>>> 会买入：fire=+${firstFire.age.toFixed(1)}s 价格=${firstFire.price} 净买=${f.tradesNetBuyRatio} 路由=${f.tradesRouterPct} tradeCount=${f.tradeCount} mcap=${Math.round(f.marketCap)} vol=${(f.buyVolumeBnbExSybil ?? 0).toFixed(2)} holders=${f.holdersExSybil} b1=${f.bundleClusterHoldCircPct} top2=${f.top2BundleClusterHoldCircPct} top3=${f.top3BundleClusterHoldCircPct} syb=${f.sybilClusterHolderCircPct} dd=${f.drawdownFromHighest}`);
    } else {
      console.log(`>>> 不会买入（30min 窗内未全过）。最高同时过门=${firstPassCount}/${GNAMES.length}`);
      console.log('    各门首次通过时刻: ' + GNAMES.map(k => `${k}=${firstPass[k] != null ? '+' + firstPass[k].toFixed(0) + 's' : '从未'}`).join(' '));
      console.log('    各门最后失败时刻: ' + GNAMES.map(k => `${k}=${lastVal[k] != null ? '+' + lastVal[k].toFixed(0) + 's' : '-'}`).join(' '));
    }
    for (const l of timeline) console.log('  ' + l);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
