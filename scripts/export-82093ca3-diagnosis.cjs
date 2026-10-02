#!/usr/bin/env node
/**
 * 82093ca3 全票诊断包导出（LLM 逐票归因用）
 * 每票：叙事详情(token_narrative) + 买点因子(首买信号) + 卖点序列(卖信号快照+成交)
 *      + 买后价格路径(wss_price_ticks 聚合：max/min/offset/卖后max/前5分钟)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const fs = require('fs');

const EXP_ID = '82093ca3-ea73-4f26-9aef-cb9a1acee842';

(async () => {
  const c = dbManager.getClient();
  const detail = JSON.parse(fs.readFileSync(require('path').join(__dirname, '../data/analysis-82093ca3-per-token.json'), 'utf8'));
  console.log('per-token 明细:', detail.length);

  // 1. trades（买卖成交全量）
  const { data: trades } = await c.from('trades').select('token_address,trade_direction,input_amount,output_amount,unit_price,sold_cards,created_at,signal_id').eq('experiment_id', EXP_ID).limit(5000);

  // 2. 卖信号快照（metadata 含 trendFactors 价格上下文）
  const sellSigs = [];
  {
    let cursor = null;
    for (let page = 0; page < 30; page++) {
      let q = c.from('strategy_signals').select('id,token_address,metadata,created_at').eq('experiment_id', EXP_ID).eq('action', 'sell').order('id', { ascending: true }).limit(1000);
      if (cursor) q = q.gt('id', cursor);
      const { data: chunk } = await q;
      if (!chunk || !chunk.length) break;
      sellSigs.push(...chunk);
      cursor = chunk[chunk.length - 1].id;
      if (chunk.length < 1000) break;
    }
  }
  console.log('sell signals:', sellSigs.length);

  // 3. token_narrative（批查，is_valid 优先）
  const addrs = detail.map(t => t.addr);
  const narr = new Map();
  for (let i = 0; i < addrs.length; i += 80) {
    const { data } = await c.from('token_narrative').select('token_address,is_valid,analyzed_at,token_category,analysis_stage,prompt_version,stage_final_result,prestage_result').in('token_address', addrs.slice(i, i + 80));
    (data || []).forEach(r => {
      const prev = narr.get(r.token_address);
      if (!prev || (r.is_valid && !prev.is_valid) || (r.is_valid === prev.is_valid && r.analyzed_at > prev.analyzed_at)) narr.set(r.token_address, r);
    });
  }
  console.log('narrative rows:', narr.size);

  // 4. ticks per token（首买-5min → 末卖+120min，cap 24h）
  const byTokenTrades = new Map();
  trades.forEach(t => {
    if (!byTokenTrades.has(t.token_address)) byTokenTrades.set(t.token_address, []);
    byTokenTrades.get(t.token_address).push(t);
  });
  const sellSigByToken = new Map();
  sellSigs.forEach(s => {
    if (!sellSigByToken.has(s.token_address)) sellSigByToken.set(s.token_address, []);
    sellSigByToken.get(s.token_address).push(s);
  });

  const out = [];
  let n = 0;
  for (const t of detail) {
    n++;
    if (n % 40 === 0) console.log(`  token ${n}/${detail.length}`);
    const trs = (byTokenTrades.get(t.addr) || []).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    const buys = trs.filter(x => x.trade_direction === 'buy');
    const sells = trs.filter(x => x.trade_direction === 'sell');
    if (!buys.length) continue;
    const firstBuyAt = new Date(buys[0].created_at).getTime();
    const lastSellAt = sells.length ? new Date(sells[sells.length - 1].created_at).getTime() : null;
    const buyPrice = Number(buys[0].unit_price);

    // ticks
    const winStart = new Date(firstBuyAt - 5 * 60000).toISOString();
    const winEnd = new Date(Math.min((lastSellAt || firstBuyAt) + 120 * 60000, firstBuyAt + 24 * 3600 * 1000)).toISOString();
    const { data: ticks, error: tickErr } = await c.from('wss_price_ticks').select('price_bnb,block_time').eq('token_address', t.addr)
      .gte('block_time', winStart).lte('block_time', winEnd).order('block_time', { ascending: true }).limit(20000);
    if (tickErr) throw new Error(`ticks 查询失败 ${t.addr}: ${tickErr.message}`);
    if (!ticks || !ticks.length) console.log(`  ⚠️ token ${t.symbol} ${t.addr} 窗口内 0 ticks（${winStart} ~ ${winEnd}）`);
    const tk = (ticks || []).map(x => ({ p: Number(x.price_bnb), ts: new Date(x.block_time).getTime() }));

    // 路径聚合——⚠️ 基准用首买后首笔 tick（tick 间同 price_bnb 量纲）；
    // trades.unit_price 是 USD 量纲，与 tick.price_bnb 比价 ≈1/777（flap 量纲坑），绝不做基准
    const pre = tk.filter(x => x.ts < firstBuyAt);
    const post = tk.filter(x => x.ts >= firstBuyAt);
    const baseTick = post.length ? post[0].p : null; // 首买后首 tick
    const pctOf = p => baseTick != null && baseTick > 0 ? (p / baseTick - 1) * 100 : null;
    let maxPct = null, maxAtMin = null, minPct = null, minAtMin = null;
    post.forEach(x => {
      const v = pctOf(x.p);
      if (v == null) return;
      if (maxPct == null || v > maxPct) { maxPct = v; maxAtMin = (x.ts - firstBuyAt) / 60000; }
      if (minPct == null || v < minPct) { minPct = v; minAtMin = (x.ts - firstBuyAt) / 60000; }
    });
    // 买后 2 分钟 / 5 分钟末价
    const atMin = m => { const arr = post.filter(x => x.ts <= firstBuyAt + m * 60000); return arr.length ? pctOf(arr[arr.length - 1].p) : null; };
    // 卖后 max（末卖后 10s 起）
    let afterSellMax = null;
    if (lastSellAt) {
      const after = tk.filter(x => x.ts > lastSellAt + 10000);
      after.forEach(x => { const v = pctOf(x.p); if (v != null && (afterSellMax == null || v > afterSellMax)) afterSellMax = v; });
    }
    // 买前 3 笔趋势（最后 3 tick 均价 vs 再前 10 tick 均价）
    let preTrend = null;
    if (pre.length >= 5) {
      const last3 = pre.slice(-3).reduce((s, x) => s + x.p, 0) / 3;
      const before = pre.slice(-13, -3);
      const avgB = before.length ? before.reduce((s, x) => s + x.p, 0) / before.length : last3;
      preTrend = avgB > 0 ? (last3 / avgB - 1) * 100 : null;
    }

    // 卖点序列（卖信号快照 + 成交）
    const sellsOut = sells.map(s => {
      const sig = s.signal_id ? sellSigs.find(x => x.id === s.signal_id) : null;
      const tf = (sig && sig.metadata && sig.metadata.trendFactors) || {};
      const atMin = (new Date(s.created_at).getTime() - firstBuyAt) / 60000;
      return {
        atMin: +atMin.toFixed(1), leg: (sig && sig.metadata && sig.metadata.strategyName) || '?',
        sellPct: buyPrice > 0 ? +((Number(s.unit_price) / buyPrice - 1) * 100).toFixed(1) : null,
        ddFromHigh: tf.drawdownFromHighest != null ? +tf.drawdownFromHighest.toFixed(1) : null,
        profitAtFire: tf.profitPercent != null ? +tf.profitPercent.toFixed(1) : null,
        cycle: tf.tokenCycle ?? null, cards: s.sold_cards ?? null,
        gotBnb: +(Number(s.output_amount) || 0).toFixed(3),
      };
    });

    const nr = narr.get(t.addr);
    const sfr = (nr && nr.stage_final_result) || {};
    const det = sfr.details || {};
    const tf = t.tf || {}, pbc = t.pbc || {}, tpa = t.tpa || {};

    out.push({
      symbol: t.symbol, addr: t.addr, platform: t.platform,
      netBnb: +t.netBnb.toFixed(3), outcome: t.outcome,
      buyAtMin0: buys[0].created_at, holdMin: lastSellAt ? +((lastSellAt - firstBuyAt) / 60000).toFixed(1) : null,
      ratingAtBuy: t.rating,
      narrative: nr ? { valid: nr.is_valid, category: nr.token_category, stage: nr.analysis_stage, rating: sfr.rating, score: sfr.score, eventScore: det.eventScore, blockReason: det.blockReason || sfr.reason || null } : null,
      buy: {
        ageSec: tf.tokenAgeSec != null ? +tf.tokenAgeSec.toFixed(0) : null,
        earlyReturn: tf.earlyReturn != null ? +tf.earlyReturn.toFixed(0) : null,
        buyVolumeBnb: tf.buyVolumeBnb != null ? +tf.buyVolumeBnb.toFixed(1) : null,
        holders: tf.holders, uw: pbc.earlyTradesUniqueWallets, top1Share: pbc.earlyTradesTop1BuySharePct != null ? +pbc.earlyTradesTop1BuySharePct.toFixed(1) : null,
        routerPct: pbc.earlyTradesRouterPct, netBuyRatio: pbc.earlyTradesNetBuyRatio != null ? +pbc.earlyTradesNetBuyRatio.toFixed(0) : null,
        tpaScore: tpa.TPAPre_tokenScore, holderTrendCV: tf.holderTrendCV != null ? +tf.holderTrendCV.toFixed(3) : null,
        holderTrendGrowth: tf.holderTrendGrowthRatio != null ? +tf.holderTrendGrowthRatio.toFixed(0) : null,
        riseSpeed: tf.riseSpeed != null ? +tf.riseSpeed.toFixed(0) : null,
        crashSpeed: tf.crashSpeedPctPerSec != null ? +tf.crashSpeedPctPerSec.toFixed(1) : null,
        ddAtBuy: tf.drawdownFromHighest != null ? +tf.drawdownFromHighest.toFixed(1) : null,
        trendTotalReturn: tf.trendTotalReturn != null ? +tf.trendTotalReturn.toFixed(0) : null,
        cycle: tf.tokenCycle, tps30s: tf.cycleTps30s != null ? +tf.cycleTps30s.toFixed(1) : null,
        rsi: tf.rsi14Sec != null ? +tf.rsi14Sec.toFixed(0) : null,
        firstBlockBuyShare: tf.firstBlockBuyShare != null ? +tf.firstBlockBuyShare.toFixed(2) : null,
        counterpartyOverlap: tf.counterpartyOverlapRate != null ? +tf.counterpartyOverlapRate.toFixed(2) : null,
        preTrend3v10: preTrend != null ? +preTrend.toFixed(1) : null,
      },
      path: {
        ticksPre: pre.length, ticksPost: post.length,
        maxPctAfterBuy: maxPct != null ? +maxPct.toFixed(1) : null, maxAtMin: maxAtMin != null ? +maxAtMin.toFixed(1) : null,
        minPctAfterBuy: minPct != null ? +minPct.toFixed(1) : null, minAtMin: minAtMin != null ? +minAtMin.toFixed(1) : null,
        at2Min: atMin(2) != null ? +atMin(2).toFixed(1) : null,
        at5Min: atMin(5) != null ? +atMin(5).toFixed(1) : null,
        afterLastSellMaxPct: afterSellMax != null ? +afterSellMax.toFixed(1) : null,
      },
      sells: sellsOut,
    });
  }

  fs.writeFileSync(require('path').join(__dirname, '../data/analysis-82093ca3-diagnosis.json'), JSON.stringify(out));
  const wins = out.filter(x => x.outcome === 'win').length, losses = out.filter(x => x.outcome === 'loss').length;
  console.log(`\n导出 ${out.length} 票（win ${wins} / loss ${losses} / flat ${out.length - wins - losses}）→ data/analysis-82093ca3-diagnosis.json`);
  console.log('size:', (fs.statSync(require('path').join(__dirname, '../data/analysis-82093ca3-diagnosis.json')).size / 1024).toFixed(0), 'KB');
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
