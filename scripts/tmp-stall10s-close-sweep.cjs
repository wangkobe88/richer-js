/**
 * 「N 秒无交易 → 全部清仓」阈值扫描（10/15/20/30/45/60s）
 * 数据与口径同 tmp-stall10s-close-analysis.cjs，tick 只拉一次、多阈值复用。
 * 输出：触发率 / Δ 拆分（改善 sum+ vs 代价 sum-）/ 大票错过面（峰值>=100% round 的利润捕获）
 */
const { dbManager } = require('../src/services/dbManager.js');

const DAYS = 8;
const TAIL_MS = 30 * 60 * 1000;
const MAX_TICK_ROWS = 60000;
const BNB_LIKE = new Set(['BNB', 'WBNB', 'WNB']);
const THRESHOLDS = [10000, 15000, 20000, 30000, 45000, 60000];

const num = (v) => (v === null || v === undefined ? null : Number(v));
const ts = (s) => new Date(s).getTime();

(async () => {
  const db = await dbManager.getClient();
  const cutoff = new Date(Date.now() - DAYS * 86400e3).toISOString();

  const exps = await db.from('experiments').select('id,config,created_at').gte('created_at', cutoff);
  if (exps.error) throw new Error(exps.error.message);
  const expName = new Map(exps.data.map(e => {
    let n = ''; try { n = (typeof e.config === 'string' ? JSON.parse(e.config) : e.config)?.name || ''; } catch (_) {}
    return [e.id, n];
  }));

  const tradesRes = await db.from('trades')
    .select('experiment_id,token_address,token_symbol,trade_direction,input_currency,output_currency,input_amount,output_amount,created_at,is_virtual_trade')
    .gte('created_at', cutoff).eq('success', true).order('created_at');
  if (tradesRes.error) throw new Error(tradesRes.error.message);
  const trades = tradesRes.data || [];

  const groups = new Map();
  for (const t of trades) {
    const key = t.experiment_id + '|' + t.token_address;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const rounds = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => ts(a.created_at) - ts(b.created_at));
    let cur = null;
    for (const t of list) {
      const buy = t.trade_direction === 'buy';
      const bnbSide = buy ? t.input_currency : t.output_currency;
      const tokSide = buy ? t.output_currency : t.input_currency;
      if (!BNB_LIKE.has(bnbSide) || BNB_LIKE.has(tokSide)) continue;
      const bnb = num(buy ? t.input_amount : t.output_amount);
      const tok = num(buy ? t.output_amount : t.input_amount);
      if (bnb === null || tok === null || !(bnb > 0) || !(tok > 0)) continue;
      const tms = ts(t.created_at);
      if (buy) {
        if (!cur || cur.qty <= 1e-12) { if (cur) rounds.push(cur); cur = null; }
        if (!cur) cur = { exp: t.experiment_id, token: t.token_address, symbol: t.token_symbol, qty: 0, cost: 0, proceeds: 0, events: [] };
        cur.qty += tok; cur.cost += bnb;
        cur.events.push({ t: tms, dir: 'buy', bnb, tok });
      } else {
        if (!cur || cur.qty <= 1e-12) continue;
        const sellTok = Math.min(tok, cur.qty);
        cur.qty -= sellTok; cur.proceeds += bnb;
        cur.events.push({ t: tms, dir: 'sell', bnb, tok: sellTok });
      }
    }
    if (cur) rounds.push(cur);
  }
  console.error(`rounds: ${rounds.length}`);

  // 每 round 拉 ticks 一次
  const enriched = [];
  for (const r of rounds) {
    const t0 = r.events[0].t;
    const lastEvent = r.events[r.events.length - 1];
    const winEnd = lastEvent.t + TAIL_MS;
    const ticks = [];
    let cursorId = 0;
    for (;;) {
      const res = await db.from('wss_price_ticks')
        .select('id,block_time,price_bnb,price_outlier')
        .eq('token_address', r.token).gt('id', cursorId)
        .gte('block_time', new Date(t0 - 120e3).toISOString())
        .lte('block_time', new Date(winEnd).toISOString())
        .order('id', { ascending: true }).range(0, 999);
      if (res.error) throw new Error('ticks: ' + res.error.message);
      for (const row of res.data || []) ticks.push({ t: ts(row.block_time), p: num(row.price_bnb), out: !!row.price_outlier, id: row.id });
      if (!res.data || res.data.length < 1000) break;
      cursorId = res.data[res.data.length - 1].id;
      if (ticks.length >= MAX_TICK_ROWS) break;
    }
    ticks.sort((a, b) => a.t - b.t || a.id - b.id);
    const priced = ticks.filter(x => x.p != null && x.p > 0 && !x.out);
    if (priced.length < 2) continue;
    let prevIdx = -1;
    for (let i = 0; i < ticks.length; i++) { if (ticks[i].t <= t0) prevIdx = i; else break; }
    if (prevIdx === -1) continue;
    const totalTok = r.cost / (r.cost / 1) // placeholder
    const boughtTok = r.events.filter(e => e.dir === 'buy').reduce((s, e) => s + e.tok, 0);
    const entryPrice = r.cost / boughtTok;
    const flat = r.qty <= 1e-12;
    const lastPr = flat ? lastEvent.t : lastEvent.t;
    const lastP = priced[priced.length - 1].p;
    const actualProfitBnb = r.proceeds + (flat ? 0 : r.qty * lastP) - r.cost;
    let pathPeak = 0;
    for (const q of priced) if (q.t >= t0 - 2000 && q.t <= lastPr + TAIL_MS) pathPeak = Math.max(pathPeak, q.p);
    enriched.push({ ...r, ticks, priced, prevIdx, t0, lastPr, entryPrice, boughtTok, flat, actualProfitBnb, actualPct: actualProfitBnb / r.cost * 100, pathPeakPct: pathPeak > 0 ? (pathPeak / entryPrice - 1) * 100 : null, expN: expName.get(r.exp) || r.exp.slice(0, 8) });
  }

  // ---- 多阈值评估 ----
  function evalThreshold(ms) {
    let trig = 0, better = 0, worse = 0;
    let sumPos = 0, sumNeg = 0;
    let cfTotal = 0;
    const rows = [];
    for (const r of enriched) {
      let trigger = null;
      if (r.t0 - r.ticks[r.prevIdx].t >= ms) {
        trigger = { at: r.t0, price: r.entryPrice, immediate: true };
      } else {
        for (let i = r.prevIdx + 1; i < r.ticks.length; i++) {
          if (r.ticks[i].t - r.ticks[i - 1].t > ms) {
            const at = r.ticks[i - 1].t + ms;
            if (at <= r.lastPr) {
              let px = null;
              for (let j = i - 1; j >= 0; j--) { const q = r.ticks[j]; if (q.p != null && q.p > 0 && !q.out) { px = q.p; break; } }
              trigger = { at, price: px, immediate: false };
            }
            break;
          }
        }
      }
      let cfProfit = r.actualProfitBnb;
      if (trigger && trigger.price != null) {
        let soldBnb = 0, soldTok = 0;
        for (const e of r.events) if (e.dir === 'sell' && e.t <= trigger.at) { soldBnb += e.bnb; soldTok += e.tok; }
        const remainTok = Math.max(0, r.boughtTok - soldTok);
        cfProfit = soldBnb + remainTok * trigger.price - r.cost;
        trig++;
        const d = cfProfit - r.actualProfitBnb;
        if (d > 0) { better++; sumPos += d; } else if (d < 0) { worse++; sumNeg += d; }
        rows.push({ r, trigger, cfProfit, cfPct: cfProfit / r.cost * 100 });
      }
      cfTotal += cfProfit;
    }
    return { ms, trig, better, worse, sumPos, sumNeg, cfTotal, rows };
  }

  console.log('\n===== 阈值扫描（199 rounds 近 8 天 live） =====');
  console.log('实际总盈亏: ' + enriched.reduce((s, r) => s + r.actualProfitBnb, 0).toFixed(4) + ' BNB');
  console.log('阈值 | 触发 | 改善/代价 round | Σ改善 | Σ代价 | 净Δ | 模拟总盈亏');
  const results = THRESHOLDS.map(evalThreshold);
  for (const x of results) {
    console.log(`${(x.ms / 1000 + 's').padStart(4)} | ${String(x.trig).padStart(3)} (${(x.trig / enriched.length * 100).toFixed(0)}%) | +${x.better}/-${x.worse} | +${x.sumPos.toFixed(4)} | ${x.sumNeg.toFixed(4)} | ${(x.sumPos + x.sumNeg).toFixed(4)} | ${x.cfTotal.toFixed(4)}`);
  }

  // ---- 大票错过面 per 阈值 ----
  console.log('\n===== 大票（round 峰值>=100%，n=' + enriched.filter(r => r.pathPeakPct >= 100).length + '）各阈值捕获 =====');
  const bigs = enriched.filter(r => r.pathPeakPct != null && r.pathPeakPct >= 100);
  const bigActual = bigs.reduce((s, r) => s + r.actualProfitBnb, 0);
  console.log(`大票实际合计: ${bigActual.toFixed(4)} BNB`);
  for (const x of results) {
    const hit = x.rows.filter(w => bigs.includes(w.r));
    const cfBig = bigs.reduce((s, r) => {
      const w = hit.find(h => h.r === r);
      return s + (w ? w.cfProfit : r.actualProfitBnb);
    }, 0);
    const hurt = hit.filter(w => w.cfProfit < w.r.actualProfitBnb);
    console.log(`${(x.ms / 1000 + 's').padStart(4)} | 大票被截 ${hit.length}/${bigs.length} | 模拟大票合计 ${cfBig.toFixed(4)}（实际 ${bigActual.toFixed(4)}，差 ${((cfBig - bigActual) * 1).toFixed(4)}）| 利润被砍 round ${hurt.length}`);
  }

  // ---- 10s 档大票明细（回答"错过多少"） ----
  const x10 = results[0];
  console.log('\n===== 10s 档：大票被截明细（模拟利润 < 实际） =====');
  for (const w of x10.rows.filter(w => bigs.includes(w.r) && w.cfProfit < w.r.actualProfitBnb).sort((a, b) => (a.cfProfit - a.r.actualProfitBnb) - (b.cfProfit - b.r.actualProfitBnb))) {
    console.log(`${w.r.symbol} [${w.r.expN}] 峰值+${w.r.pathPeakPct.toFixed(0)}% 实际 ${w.r.actualPct.toFixed(1)}% → 模拟 ${w.cfPct.toFixed(1)}%（少赚 ${(w.r.actualPct - w.cfPct).toFixed(1)}pct / ${(w.r.actualProfitBnb - w.cfProfit).toFixed(5)} BNB；触发@+${((w.trigger.at - w.r.t0) / 1000).toFixed(0)}s）`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
