// T102 回放：rating==1 强势独立买入臂（buy-v2-momentum 候选）阈值定量（182 跑）
//
// 目的：近 7 天 rating==1 票逐 tick 重放候选动量臂条件（buy-v2 v51 评级门换 rating==1
// + 可选 buyWallets>=X 动量门），统计 fire 数、fire→峰倍数分布；对照组=同条件 rating==2|3。
//
// 因子近似口径（与 FA 的已知差异，全部列此）：
// - wallet = sender_address || trader_address（FA 同口径）
// - roster 门（copy/famous/sybil/known-sniper）不评——罕见绑定，回放偏宽松方向
// - holderTrendSlope：10s 时间桶 holder(净>0 钱包数) 序列最近 4 桶末>首 即 >0（FA=blockNumber 桶×8 块最小二乘）
// - crashSpeedPctPerSec：最近 ~10s 价差 /s 代理（FA 实现细节近似）
// - 首可靠价 = 首 tick 价（outlier/尘 tick 语义不模拟）
// - narrativeRating 到达时刻 = narrative_analysis_rounds 首轮 created_at（缺行回落 analyzed_at）；
//   到达前 rating 视 null（条件恒 false，与引擎 FA null 语义一致）
// - 每 token tick 截 5000 行（首 ~10-30 分钟，fire 全部发生在早期；峰截尾已知偏低估）
const { dbManager } = require('../src/services/dbManager.js');
const fs = require('fs');

const FROM = '2026-10-22T00:00:00Z';
const DUST_BNB = 0.015;          // T98 尘门（10-29 追裁定 0.015）
const THRESHOLDS = [0, 30, 40, 60]; // buyWallets>=X 动量门（0=无）
const RATING_NUM = { low: 1, mid: 2, high: 3 };

(async () => {
  const db = dbManager.getClient();
  const onlyAddr = process.argv.includes('--only') && process.argv[process.argv.indexOf('--only') + 1];

  // ── 1) universe：近 7 天有终态评级的叙事行 ─────────────────────────
  const universe = new Map(); // addr → meta
  const fillRow = (r) => {
    const num = RATING_NUM[r.rating];
    if (!num) return; // 未完成/无终态
    universe.set(r.token_address, {
      symbol: r.token_symbol, rating: num, analyzedAt: Date.parse(r.analyzed_at),
      totalSupply: Number(r.totalSupply) || 1e9,
      eventTs: r.eventTs ? Number(r.eventTs) * 1000 : null,
    });
  };
  if (onlyAddr) {
    const { data, error } = await db.from('token_narrative')
      .select('token_address,token_symbol,analyzed_at,final_result->>rating,raw_api_data->>totalSupply,raw_api_data->>eventTs')
      .eq('token_address', onlyAddr);
    if (error) throw error;
    data.forEach(fillRow);
  } else for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('token_narrative')
      .select('token_address,token_symbol,analyzed_at,final_result->>rating,raw_api_data->>totalSupply,raw_api_data->>eventTs')
      .gte('analyzed_at', FROM).order('analyzed_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    data.forEach(fillRow);
    if (data.length < 1000) break;
  }
  console.log(`universe: ${universe.size} 票（low=${[...universe.values()].filter(u=>u.rating===1).length} mid/high=${[...universe.values()].filter(u=>u.rating>1).length}）`);

  // ── 2) rating 到达时刻：rounds 首轮 created_at ─────────────────────
  const arrival = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('narrative_analysis_rounds')
      .select('token_address,created_at').gte('created_at', FROM)
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    for (const r of data) {
      const t = Date.parse(r.created_at);
      if (!arrival.has(r.token_address) || t < arrival.get(r.token_address)) arrival.set(r.token_address, t);
    }
    if (data.length < 1000) break;
  }
  console.log(`arrival map: ${arrival.size} 票`);

  // ── 3) 逐票重放 ─────────────────────────────────────────────────
  const fires = []; // {addr,symbol,platform,group,X,ts,ageSec,price,firstPrice,entryMult,peak5,peak30,ttPeak,factors{}}
  let done = 0, noTicks = 0, errs = 0;
  const t0 = Date.now();

  for (const [addr, meta] of universe) {
    try {
      const { data: tk, error } = await db.from('wss_price_ticks')
        .select('price_bnb,block_time,trade_type,trader_address,sender_address,bnb_amount,token_amount,platform')
        .eq('token_address', addr).order('block_time', { ascending: true }).limit(5000);
      if (error) throw error;
      if (!tk.length) { noTicks++; done++; continue; }

      const ratingAt = arrival.get(addr) ?? meta.analyzedAt;
      const createTs = meta.eventTs ?? Date.parse(tk[0].block_time);
      const supply = meta.totalSupply;

      // 流式状态
      const wallets = new Map(); // w → {net, everBuy}  net=token 净持仓
      let buyBnb = 0, sellBnb = 0, tradeCount = 0, circTokens = 0, posNetSum = 0, holderCount = 0, exDust = 0;
      let firstPrice = Number(tk[0].price_bnb), peakPrice = firstPrice;
      const dustT = firstPrice > 0 ? DUST_BNB / firstPrice : Infinity; // T98 首价冻结尘门(token 域常量)
      const buckets = []; // {t0ms, holders} 10s 桶
      const ring = [];   // 最近 100 笔 {bnb, buy}
      const pricesRecent = []; // {ts, price} 滑窗 12s（crashSpeed 代理）
      let buyWalletsCnt = 0;

      // fire 状态 per 组/档
      const fired = { 1: new Set(), 23: new Set() }; // group rating==1 的 X 档 + 对照组
      const peaks = {}; // key `${group}:${X}` → {until, p5, p30, fireTs}
      const mkKey = (g, x) => `${g}:${x}`;
      const tokenFires = [];

      for (const row of tk) {
        const ts = Date.parse(row.block_time);
        const price = Number(row.price_bnb);
        const isBuy = row.trade_type === 'buy';
        const bnb = Number(row.bnb_amount || 0);
        const tokAmt = Number(row.token_amount || 0);
        const w = ((row.sender_address || row.trader_address) || '').toLowerCase();

        // ── 状态推进 ──
        tradeCount++;
        const prev = wallets.get(w);
        const oldNet = prev ? prev.net : 0;
        const rec = prev || { net: 0, everBuy: false };
        if (isBuy) {
          buyBnb += bnb; circTokens += tokAmt;
          rec.net += tokAmt; rec.everBuy = true;
          if (!prev) buyWalletsCnt++;
        } else {
          sellBnb += bnb; rec.net -= tokAmt;
        }
        if (oldNet > 0) { posNetSum -= oldNet; holderCount--; if (oldNet >= dustT) exDust--; }
        if (rec.net > 0) { posNetSum += rec.net; holderCount++; if (rec.net >= dustT) exDust++; }
        wallets.set(w, rec);
        ring.push({ bnb, buy: isBuy });
        if (ring.length > 100) ring.shift();
        if (price > peakPrice) peakPrice = price;

        // 10s holder 桶
        const bIdx = Math.floor(ts / 10000);
        if (!buckets.length || buckets[buckets.length - 1].b !== bIdx) buckets.push({ b: bIdx, holders: holderCount, ts });
        else buckets[buckets.length - 1].holders = holderCount;
        // 价滑窗 12s
        pricesRecent.push({ ts, price });
        while (pricesRecent.length && pricesRecent[0].ts < ts - 12000) pricesRecent.shift();

        // ── fire 评估（rating 到达后） ──
        const rating = ts >= ratingAt ? meta.rating : null;
        const evalGroups = [];
        if (rating === 1) for (const X of THRESHOLDS) if (!fired[1].has(X)) evalGroups.push(X);
        if (rating !== null && rating > 1 && !fired[23].has(0)) evalGroups.push(-1); // 对照组

        if (evalGroups.length) {
          // 便宜门先行
          const ageSec = (ts - createTs) / 1000;
          const mcap = price * supply;
          let pass =
            (ageSec < 90 || tradeCount >= 25) &&
            mcap > 4.7 && mcap < 27 &&
            buyBnb >= 1.25 && exDust >= 10 &&
            ring.length >= 1 &&
            drawdown(price, peakPrice) > -70 &&
            holderSlope(buckets) > 0 &&
            crashSpeedOf(pricesRecent, ts, price) > -10;
          if (pass) {
            const L = netRatio(ring, 100), S = netRatio(ring, 20);
            pass = L !== null && L >= 0 && S !== null && S >= 40;
            if (pass) {
              const circ = Math.max(circTokens, posNetSum);
              const { top1, top2 } = topNets(wallets);
              pass = circ > 0 && top2 / circ * 100 < 55 && top1 / circ * 100 < 35;
            }
          }
          if (pass) for (const X of evalGroups) {
            if (X > 0 && buyWalletsCnt < X) continue;
            const g = X === -1 ? 23 : 1, xx = X === -1 ? 0 : X;
            fired[g].add(xx);
            const key = mkKey(g, xx);
            peaks[key] = { fireTs: ts, firePrice: price, p5: price, p30: price, tPeak5: 0, tPeak30: 0 };
            tokenFires.push({ group: g, X: xx, ts, ageSec, price, entryMult: price / firstPrice, mcap,
              factors: { buyBnb: +buyBnb.toFixed(2), exDust, buyWallets: buyWalletsCnt, tradeCount, holders: holderCount } });
          }
        }

        // ── 峰追踪（已 fire 的组） ──
        for (const key in peaks) {
          const P = peaks[key];
          if (ts < P.fireTs) continue;
          if (ts <= P.fireTs + 5 * 60000 && price > P.p5) { P.p5 = price; P.tPeak5 = (ts - P.fireTs) / 1000; }
          if (ts <= P.fireTs + 30 * 60000 && price > P.p30) { P.p30 = price; P.tPeak30 = (ts - P.fireTs) / 1000; }
        }
      }

      for (const f of tokenFires) {
        const P = peaks[mkKey(f.group, f.X)];
        fires.push({ addr, symbol: meta.symbol, platform: tk[0].platform, group: f.group, X: f.X,
          ...f, peak5: P.p5, peak30: P.p30, ttPeak: P.tPeak30,
          mult5: +(P.p5 / f.price).toFixed(2), mult30: +(P.p30 / f.price).toFixed(2) });
      }
    } catch (e) {
      errs++; if (errs <= 5) console.log(`ERR ${addr}: ${e.message}`);
    }
    done++;
    if (done % 200 === 0) console.log(`progress ${done}/${universe.size} fires=${fires.length} ${((Date.now()-t0)/60000).toFixed(1)}min`);
  }

  // ── 4) 汇总 ─────────────────────────────────────────────────────
  const summarize = (label, arr) => {
    if (!arr.length) { console.log(`\n### ${label}: 0 fire`); return; }
    const m30 = arr.map(f => f.mult30).sort((a, b) => a - b);
    const med = m30[Math.floor(m30.length / 2)];
    const pct = (fn) => (arr.filter(fn).length / arr.length * 100).toFixed(0) + '%';
    const ttP = arr.map(f => f.ttPeak).sort((a, b) => a - b);
    const ent = arr.map(f => f.entryMult).sort((a, b) => a - b);
    console.log(`\n### ${label}: ${arr.length} fire | 峰30min 中位 ${med}x | ≥3x ${pct(f=>f.mult30>=3)} ≥2x ${pct(f=>f.mult30>=2)} ≥1.5x ${pct(f=>f.mult30>=1.5)} <1.2x ${pct(f=>f.mult30<1.2)}`);
    console.log(`    进场倍率中位 ${ent[Math.floor(ent.length/2)]}x | 到峰时长中位 ${ttP[Math.floor(ttP.length/2)].toFixed(0)}s | fourmeme ${arr.filter(f=>f.platform==='fourmeme').length} flap ${arr.filter(f=>f.platform==='flap').length}`);
    const top = [...arr].sort((a, b) => b.mult30 - a.mult30).slice(0, 12);
    for (const f of top) console.log(`    ${f.mult30}x ${f.symbol||'?'} ${f.addr.slice(0,10)}… ${f.platform} 进场${f.entryMult}x age${Math.round(f.ageSec)}s buyW=${f.factors.buyWallets} 买量${f.factors.buyBnb} 峰5min=${f.mult5}x`);
  };
  for (const X of THRESHOLDS) summarize(`动量臂 rating==1 buyWallets>=${X}`, fires.filter(f => f.group === 1 && f.X === X));
  summarize(`对照组 rating==2|3（主臂形状）`, fires.filter(f => f.group === 23));

  fs.writeFileSync(__dirname + '/tmp-t102-fires.json', JSON.stringify(fires));
  console.log(`\n完成：${done} 票 / 无ticks ${noTicks} / 错误 ${errs} / fire 记录 ${fires.length} → tmp-t102-fires.json`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

// ── 纯函数 ──
function drawdown(price, peak) { return peak > 0 ? (price - peak) / peak * 100 : 0; }
function netRatio(ring, n) {
  const w = ring.slice(-n);
  if (!w.length) return null;
  let b = 0, s = 0;
  for (const r of w) r.buy ? b += r.bnb : s += r.bnb;
  return b + s > 0 ? (b - s) / (b + s) * 100 : null;
}
function holderSlope(buckets) {
  const last = buckets.slice(-4);
  if (last.length < 4) return -1; // <4 点门槛 fail-closed
  return last[last.length - 1].holders - last[0].holders;
}
function topNets(wallets) {
  let t1 = 0, t2 = 0;
  for (const w of wallets.values()) {
    if (w.net > t1) { t2 = t1; t1 = w.net; } else if (w.net > t2) t2 = w.net;
  }
  return { top1: t1, top2: t2 };
}
// crashSpeed 代理：滑窗内最老价（≥10s 前优先）到当前的每秒跌幅 %；<10s 历史=无崩盘证据放行（FA null 语义）
function crashSpeedOf(pricesRecent, ts, price) {
  if (!pricesRecent.length) return 0;
  let ref = pricesRecent[0];
  for (const p of pricesRecent) { if (ts - p.ts >= 10000) ref = p; else break; }
  const dt = (ts - ref.ts) / 1000;
  if (dt < 10 || ref.price <= 0) return 0;
  return (price - ref.price) / ref.price / dt * 100;
}
