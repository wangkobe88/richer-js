#!/usr/bin/env node
// 「形象化IP」(token_category='event:A') 叙事通过即买 假设回放
// 口径：rating∈{mid,high} 且 analyzed_at 距链上创建 ≤10min（实时分析形状）
// 假想买价 = analyzed_at 后首个非尘 tick 价；对照 live 实际买入行为
// 重查询：只在 182 跑
const { dbManager } = require('../src/services/dbManager.js');

const SINCE = '2026-10-15T00:00:00Z';
const MAX_ANALYZE_LAG_SEC = 600;   // 实时分析形状过滤
const FWD_WINDOW_MS = 2 * 3600 * 1000; // 前向 2h 轨迹
const MIN_TICK_BNB = 0.001;        // 尘 tick 剔除（对齐 FA 口径）

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const pct = (x) => x == null ? null : +(x * 100).toFixed(1);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * q, lo = Math.floor(idx), hi = Math.ceil(idx);
  return +(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)).toFixed(3);
}
function summarize(list) {
  if (!list.length) return { n: 0 };
  const s = [...list].sort((a, b) => a - b);
  return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1),
    p25: quantile(s, .25), median: quantile(s, .5), p75: quantile(s, .75),
    min: s[0], max: s[s.length - 1], winRate: pct(s.filter(x => x > 0).length / s.length) };
}

(async () => {
  const db = dbManager.getClient();

  // ── 1. 分页拉 event:A 全部叙事行 ──
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await db.from('token_narrative')
      .select('token_address,analyzed_at,final_result')
      .eq('token_category', 'event:A')
      .gte('analyzed_at', SINCE)
      .order('analyzed_at', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
    await sleep(200);
  }
  const ratingCnt = {};
  for (const r of rows) {
    const k = r.final_result?.rating ?? '(null)';
    ratingCnt[k] = (ratingCnt[k] || 0) + 1;
  }
  console.log(`event:A 叙事行(>=${SINCE.slice(0, 10)}): ${rows.length}`, JSON.stringify(ratingCnt));

  const pool = rows.filter(r => ['mid', 'high'].includes(r.final_result?.rating));
  const addrs = pool.map(r => r.token_address);
  console.log(`rating∈{mid,high}: ${addrs.length} 票`);

  // ── 2. 批量拉链上创建锚（wss_events token_create）──
  const createByAddr = {};
  for (let i = 0; i < addrs.length; i += 50) {
    const batch = addrs.slice(i, i + 50);
    const { data, error } = await db.from('wss_events')
      .select('token_address,block_time,payload')
      .eq('kind', 'token_create')
      .gte('block_time', '2026-10-08T00:00:00Z')
      .in('token_address', batch);
    if (error) throw error;
    for (const e of data) {
      const prev = createByAddr[e.token_address];
      if (!prev || e.block_time < prev.block_time) createByAddr[e.token_address] = e;
    }
    await sleep(150);
  }
  console.log(`创建锚命中: ${Object.keys(createByAddr).length}/${addrs.length}`);

  // ── 3. 实时形状过滤 + 逐票轨迹 ──
  const cohort = [];
  let lagFiltered = 0, noAnchor = 0;
  for (const r of pool) {
    const anchor = createByAddr[r.token_address];
    if (!anchor) { noAnchor++; continue; }
    const lagSec = (Date.parse(r.analyzed_at) - Date.parse(anchor.block_time)) / 1000;
    if (lagSec < 0 || lagSec > MAX_ANALYZE_LAG_SEC) { lagFiltered++; continue; }
    cohort.push({ addr: r.token_address, rating: r.final_result.rating,
      analyzedMs: Date.parse(r.analyzed_at), createMs: Date.parse(anchor.block_time),
      platform: anchor.payload?.platform || anchor.payload?.meta?.platform || null, lagSec: Math.round(lagSec) });
  }
  console.log(`实时形状 cohort: ${cohort.length}（滤超窗 ${lagFiltered} / 无锚 ${noAnchor}）`);

  // ── 4. 逐票 ticks（并发 4）：[analyzed-60s, analyzed+2h] ──
  await mapLimit(cohort, 4, async (c) => {
    const fromIso = new Date(c.analyzedMs - 60_000).toISOString();
    const toIso = new Date(c.analyzedMs + FWD_WINDOW_MS).toISOString();
    const { data, error } = await db.from('wss_price_ticks')
      .select('block_number,log_index,block_time,trade_type,bnb_amount,price_bnb')
      .eq('token_address', c.addr)
      .gte('block_time', fromIso).lte('block_time', toIso)
      .order('block_number', { ascending: true }).order('log_index', { ascending: true })
      .limit(3000);
    if (error) { c.tickErr = error.message; return; }
    data.sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index);
    const ticks = data.filter(t => Number(t.bnb_amount) >= MIN_TICK_BNB && Number(t.price_bnb) > 0);
    c.tickCount = ticks.length;
    const entry = ticks.find(t => Date.parse(t.block_time) >= c.analyzedMs);
    if (!entry) { c.deadAtEntry = true; return; }   // rating 后 2h 内无有效 tick
    const entryPx = Number(entry.price_bnb), entryMs = Date.parse(entry.block_time);
    c.entryDelaySec = Math.round((entryMs - c.analyzedMs) / 1000);
    c.entryPx = entryPx;

    // 创建锚后首价（追高程度参照）：仅用窗口内最早 tick 近似（窗起点=analyzed-60s）
    const firstPx = Number(ticks[0].price_bnb);
    c.pumpAtEntry = firstPx > 0 ? +(entryPx / firstPx).toFixed(2) : null;

    // 轨迹统计
    let peak = entryPx, peakT = 0, m60 = null, m120 = null;
    const sim = { sl15tp50: null, sl30tp100: null };
    for (const t of ticks) {
      const ms = Date.parse(t.block_time); if (ms < entryMs) continue;
      const px = Number(t.price_bnb), rel = (ms - entryMs) / 1000, ret = px / entryPx - 1;
      if (px > peak) { peak = px; peakT = rel; }
      if (m60 == null && rel >= 3600) m60 = px;
      if (m120 == null && rel >= 7200) m120 = px;
      if (sim.sl15tp50 == null && (ret <= -0.15 || ret >= 0.5)) sim.sl15tp50 = ret <= -0.15 ? -15 : 50;
      if (sim.sl30tp100 == null && (ret <= -0.30 || ret >= 1.0)) sim.sl30tp100 = ret <= -0.30 ? -30 : 100;
    }
    const lastPx = Number(ticks[ticks.length - 1].price_bnb);
    const lastRel = (Date.parse(ticks[ticks.length - 1].block_time) - entryMs) / 1000;
    c.rets = {
      m60: pct(m60 != null ? m60 / entryPx - 1 : (lastRel >= 3500 ? lastPx / entryPx - 1 : null)),
      m120: pct(m120 != null ? m120 / entryPx - 1 : (lastRel >= 7100 ? lastPx / entryPx - 1 : null)),
      sl15tp50: sim.sl15tp50 ?? pct(lastPx / entryPx - 1),
      sl30tp100: sim.sl30tp100 ?? pct(lastPx / entryPx - 1),
      peak: pct(peak / entryPx - 1), last: pct(lastPx / entryPx - 1),
      lastRelMin: Math.round(lastRel / 60),
    };
    c.peakAtSec = Math.round(peakT);
  });

  // ── 5. live 实际买入对照（近两周 buy 行）──
  const liveBuys = [];
  for (let i = 0; i < addrs.length; i += 50) {
    const batch = addrs.slice(i, i + 50);
    const { data, error } = await db.from('trades')
      .select('experiment_id,token_address,created_at,unit_price,input_amount,output_amount,token_symbol')
      .eq('trade_direction', 'buy').eq('success', true).eq('is_virtual_trade', false)
      .gte('created_at', SINCE)
      .in('token_address', batch);
    if (error) throw error;
    liveBuys.push(...data);
    await sleep(150);
  }
  const firstBuyByAddr = {};
  for (const b of liveBuys) {
    const prev = firstBuyByAddr[b.token_address];
    if (!prev || b.created_at < prev.created_at) firstBuyByAddr[b.token_address] = b;
  }
  // live 配对卖出（同实验同 token 全部 sell 成功行）
  const liveAddrs = Object.keys(firstBuyByAddr);
  for (let i = 0; i < liveAddrs.length; i += 50) {
    const batch = liveAddrs.slice(i, i + 50);
    const { data, error } = await db.from('trades')
      .select('token_address,experiment_id,input_amount,output_amount,trade_direction')
      .eq('trade_direction', 'sell').eq('success', true).eq('is_virtual_trade', false)
      .gte('created_at', SINCE)
      .in('token_address', batch);
    if (error) throw error;
    for (const s of data) {
      const fb = firstBuyByAddr[s.token_address];
      if (fb && s.experiment_id === fb.experiment_id) {
        fb.sellBnb = (fb.sellBnb || 0) + Number(s.output_amount || 0);
        fb.sellCnt = (fb.sellCnt || 0) + 1;
      }
    }
    await sleep(150);
  }

  // ── 6. 汇总 ──
  const live2 = Object.values(firstBuyByAddr);
  const liveJoined = live2.map(b => {
    const c = cohort.find(x => x.addr === b.token_address);
    return { b, c };
  });
  console.log(`\n=========== 假设回放汇总（cohort=${cohort.length}）===========`);
  const dead = cohort.filter(c => c.deadAtEntry);
  const alive = cohort.filter(c => c.rets);
  console.log(`rating 后 2h 无有效 tick（死票）: ${dead.length}`);
  for (const key of ['m60', 'm120', 'sl15tp50', 'sl30tp100', 'peak', 'last']) {
    console.log(`  ${key.padEnd(10)}`, JSON.stringify(summarize(alive.filter(c => c.rets[key] != null).map(c => c.rets[key]))));
  }
  for (const rt of ['mid', 'high']) {
    const sub = alive.filter(c => c.rating === rt);
    console.log(`  [${rt}] n=${sub.length} sl15tp50:`, JSON.stringify(summarize(sub.map(c => c.rets.sl15tp50).filter(x => x != null))),
      'm60:', JSON.stringify(summarize(sub.map(c => c.rets.m60).filter(x => x != null))));
  }
  const pump = alive.map(c => c.pumpAtEntry).filter(x => x != null && isFinite(x));
  console.log('  追高程度 entry/窗首价:', JSON.stringify(summarize(pump)));
  console.log('  entry 相对 rating 延迟(s):', JSON.stringify(summarize(alive.map(c => c.entryDelaySec))));
  console.log('  rating 相对创建滞后(s):', JSON.stringify(summarize(cohort.map(c => c.lagSec))));

  console.log(`\n=========== live 实际买入对照（${live2.length} 票）===========`);
  for (const { b, c } of liveJoined) {
    const delay = c ? Math.round((Date.parse(b.created_at) - c.analyzedMs) / 1000) : null;
    const realized = b.sellBnb != null ? pct(Number(b.sellBnb) / Number(b.input_amount) - 1) : null;
    console.log(`  ${b.token_symbol || ''} ${b.token_address.slice(0, 10)}…${b.token_address.slice(-4)}` +
      ` rating=${c?.rating ?? '?'} rating→buy=${delay != null ? delay + 's' : '无cohort'}` +
      ` 现行买价=${Number(b.unit_price).toExponential(3)} 即买价=${c?.entryPx ? c.entryPx.toExponential(3) : '-'}` +
      ` 即买/现行=${c?.entryPx && b.unit_price ? (c.entryPx / Number(b.unit_price)).toFixed(2) : '-'}` +
      ` 已实现=${realized ?? '未全清'} (卖${b.sellCnt || 0}笔)`);
  }

  // 明细落盘（182 本地 /tmp）
  require('fs').writeFileSync('/tmp/imgip-result.json', JSON.stringify({ cohort, liveJoined: liveJoined.map(({ b, c }) => ({ buy: b, sim: c ? { rating: c.rating, entryPx: c.entryPx, rets: c.rets, pump: c.pumpAtEntry } : null })) }, null, 1));
  console.log('\n明细已存 /tmp/imgip-result.json');

  // 排行：峰值 top8 / 最差 bottom8（按 m60）
  const byM60 = alive.filter(c => c.rets.m60 != null).sort((a, b) => b.rets.m60 - a.rets.m60);
  console.log('\n=== m60 top8 ===');
  for (const c of byM60.slice(0, 8)) console.log(`  ${c.addr.slice(0, 14)}…7777 ${c.rating} m60=${c.rets.m60}% peak=${c.rets.peak}%@${c.peakAtSec}s`);
  console.log('=== m60 bottom8 ===');
  for (const c of byM60.slice(-8).reverse()) console.log(`  ${c.addr.slice(0, 14)}…7777 ${c.rating} m60=${c.rets.m60}% peak=${c.rets.peak}%@${c.peakAtSec}s`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
