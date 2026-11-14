// KOL 高位入场抑制卖出思路探索 v2（182 跑）：反事实全用价格比率（量纲无关）
// ppF=famous买价/我们买点tick价-1；延迟卖估值=原得×P(t_next)/P(t_i)
import { dbManager } from '../../src/services/dbManager.js';
import { createGunzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

const V107 = '6b016c53-0c20-4a50-94c3-c2de2f205b79';
const SRC = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const rosterRaw = JSON.parse(readFileSync('/home/ubuntu/richer-js/config/rosters/famous-copy-wallets.json', 'utf8'));
const roster = new Set(rosterRaw.wallets.map(w => w.toLowerCase()));

const c = await dbManager.getClient();
async function pullAll() {
  const trades = []; let from = 0;
  while (true) {
    const { data, error } = await c.from('trades').select('token_address,trade_direction,input_amount,output_amount,created_at,signal_id')
      .eq('experiment_id', V107).order('id', { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    trades.push(...data); if (data.length < 1000) break; from += 1000;
  }
  return trades;
}
const trades = await pullAll();
const byTok = new Map();
for (const t of trades) {
  if (!byTok.has(t.token_address)) byTok.set(t.token_address, []);
  byTok.get(t.token_address).push(t);
}
for (const list of byTok.values()) list.sort((a, b) => a.created_at < b.created_at ? -1 : 1);

const CACHE = `/home/ubuntu/richer-js/data/tick-cache/backtest/${SRC}`;
const tokSet = new Set(byTok.keys());
const priceSeries = new Map();
const famousBuys = new Map();
const famousSells = new Map();
for (const plat of ['fourmeme', 'flap']) {
  const rl = createInterface({ input: createReadStream(`${CACHE}/${plat}.jsonl.gz`).pipe(createGunzip()) });
  for await (const line of rl) {
    if (!line) continue;
    const row = JSON.parse(line);
    if (!tokSet.has(row.token_address)) continue;
    const ts = new Date(row.block_time).getTime();
    const p = Number(row.price_bnb);
    if (p > 0 && !row.price_outlier) {
      if (!priceSeries.has(row.token_address)) priceSeries.set(row.token_address, []);
      priceSeries.get(row.token_address).push({ ts, p });
    }
    if (Number(row.bnb_amount) > 0) {
      const w = (row.sender_address || row.trader_address || '').toLowerCase();
      if (roster.has(w)) {
        const bucket = row.trade_type === 'buy' ? famousBuys : famousSells;
        if (!bucket.has(row.token_address)) bucket.set(row.token_address, []);
        bucket.get(row.token_address).push({ ts, bnb: Number(row.bnb_amount), p, w });
      }
    }
  }
}
for (const arr of famousSells.values()) arr.sort((a, b) => a.ts - b.ts);
for (const arr of priceSeries.values()) arr.sort((a, b) => a.ts - b.ts);
for (const arr of famousBuys.values()) arr.sort((a, b) => a.ts - b.ts);

function priceAt(addr, tsMs) {
  const s = priceSeries.get(addr); if (!s) return null;
  let lo = 0, hi = s.length - 1, r = null;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].ts <= tsMs) { r = s[m].p; lo = m + 1; } else hi = m - 1; }
  return r;
}

const rowsOut = [];
for (const a of byTok.keys()) {
  const fb = famousBuys.get(a); if (!fb || !fb.length) continue;
  const seq = byTok.get(a);
  const firstBuy = seq.find(t => t.trade_direction === 'buy');
  const lastSell = [...seq].reverse().find(t => t.trade_direction === 'sell');
  if (!firstBuy || !lastSell) continue;
  const bT = new Date(firstBuy.created_at).getTime(), eT = new Date(lastSell.created_at).getTime();
  const inHold = fb.filter(f => f.ts > bT && f.ts <= eT);
  if (!inHold.length) continue;
  const buyP = priceAt(a, bT);
  const bands = { 'pre/low<=0': 0, '0-50': 0, '50-200': 0, '>200': 0 };
  const hiBuys = []; // 高位（ppF>50）买入明细
  for (const f of inHold) {
    const ppF = buyP > 0 ? (f.p / buyP - 1) * 100 : NaN;
    if (!(ppF > 0)) bands['pre/low<=0']++; else if (ppF <= 50) bands['0-50']++;
    else if (ppF <= 200) { bands['50-200']++; hiBuys.push({ ...f, ppF }); }
    else { bands['>200']++; hiBuys.push({ ...f, ppF }); }
  }
  const net = seq.reduce((s, t) => t.trade_direction === 'buy' ? s - Number(t.input_amount) : s + Number(t.output_amount), 0);
  rowsOut.push({ a, fb, seq, buyP, bT, eT, inHold, bands, net, hiBuys });
}
console.log(`持仓期有 famous 买入的票 ${rowsOut.length}/${byTok.size} 张`);
console.log(`\n=== ppF 分层（famous 买价 vs 我们买点 tick 价）===`);
for (const r of rowsOut.sort((x, y) => (y.hiBuys.length) - (x.hiBuys.length))) {
  console.log(`${r.a.slice(0, 10)} net=${r.net.toFixed(4)} 分层=${JSON.stringify(r.bands)}` +
    (r.hiBuys.length ? ` 高位笔：${r.hiBuys.map(h => `${new Date(h.ts).toISOString().slice(11, 19)} ${h.bnb.toFixed(2)}B@+${h.ppF.toFixed(0)}%`).join(' | ')}` : ''));
}

// ===== 反事实（价格比率口径）=====
// 抑制条件=近窗 famous 买额 ≥ 阈值（famous 买价不限）；变体：只计「高位」famous 买（ppF>0 即我们买上方）
function sim(winMs, thresh, onlyAbove) {
  let totalDelta = 0; const detail = []; let nSup = 0;
  for (const r of rowsOut) {
    const seq = r.seq;
    let suppressedAny = false;
    for (let i = 0; i < seq.length; i++) {
      const t = seq[i];
      if (t.trade_direction !== 'sell') continue;
      const tMs = new Date(t.created_at).getTime();
      const pNow = priceAt(r.a, tMs); if (!(pNow > 0)) continue;
      const cand = r.fb.filter(f => f.ts > tMs - winMs && f.ts <= tMs);
      const eff = onlyAbove ? cand.filter(f => r.buyP > 0 && f.p > r.buyP) : cand;
      const inWin = eff.reduce((s, f) => s + f.bnb, 0);
      if (inWin < thresh) continue;
      nSup++; suppressedAny = true;
      const out0 = Number(t.output_amount);
      // 找下一个未被抑制的卖（本模拟内逐票顺序处理：直接找下一笔卖，若它也被抑制则继续）
      let j = i + 1, target = null, tag = '';
      while (j < seq.length) {
        if (seq[j].trade_direction === 'sell') {
          const jMs = new Date(seq[j].created_at).getTime();
          const jWin = (onlyAbove ? r.fb.filter(f => f.ts > jMs - winMs && f.ts <= jMs && r.buyP > 0 && f.p > r.buyP) : r.fb.filter(f => f.ts > jMs - winMs && f.ts <= jMs)).reduce((s, f) => s + f.bnb, 0);
          if (jWin >= thresh) { j++; continue; } // 这笔也被抑制，继续延
          target = { ms: jMs, tag: '下一卖' }; break;
        }
        j++;
      }
      if (!target) { const ms2 = r.eT + 300000; target = { ms: ms2, tag: '末价+5m' }; }
      const pTgt = priceAt(r.a, target.ms);
      if (!(pTgt > 0)) continue;
      const cf = out0 * (pTgt / pNow);
      const d = cf - out0;
      totalDelta += d;
      detail.push(`${r.a.slice(0, 10)} ${new Date(tMs).toISOString().slice(11, 19)} 抑制(在场${inWin.toFixed(2)}B ppNow=${((pNow / r.buyP - 1) * 100).toFixed(0)}%) 原${out0.toFixed(3)} →${tag} ${cf.toFixed(3)} Δ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
    }
  }
  return { totalDelta, nSup, detail };
}
for (const [name, win, th, hi] of [
  ['A 近60s≥0.3（全部famous买）', 60000, 0.3, false],
  ['A 近60s≥0.3（仅买价>我们买价）', 60000, 0.3, true],
  ['A 近120s≥0.5（仅高位）', 120000, 0.5, true],
]) {
  const r = sim(win, th, hi);
  console.log(`\n=== 反事实 ${name}：抑制 ${r.nSup} 笔，ΣΔ=${r.totalDelta >= 0 ? '+' : ''}${r.totalDelta.toFixed(4)} BNB ===`);
  for (const d of r.detail) console.log(`  ${d}`);
}
// ===== 净额口径抑制反事实：窗内 famous 净买（Σ买-Σ卖）≥ 阈值才抑制 =====
// 假设：ba5e 的对倒（买卖交织）净额低 → 不再误抑制；28ad 净买高 → 保住正贡献
function simNet(winMs, thresh) {
  let totalDelta = 0; const detail = []; let nSup = 0;
  for (const r of rowsOut) {
    const seq = r.seq;
    const fSells = famousSells.get(r.a) || [];
    const netAt = (tMs) =>
      r.fb.filter(f => f.ts > tMs - winMs && f.ts <= tMs).reduce((s, f) => s + f.bnb, 0)
      - fSells.filter(f => f.ts > tMs - winMs && f.ts <= tMs).reduce((s, f) => s + f.bnb, 0);
    for (let i = 0; i < seq.length; i++) {
      const t = seq[i];
      if (t.trade_direction !== 'sell') continue;
      const tMs = new Date(t.created_at).getTime();
      const pNow = priceAt(r.a, tMs); if (!(pNow > 0)) continue;
      const net = netAt(tMs);
      if (net < thresh) continue;
      nSup++;
      const out0 = Number(t.output_amount);
      let j = i + 1, target = null, tag = '';
      while (j < seq.length) {
        if (seq[j].trade_direction === 'sell') {
          const jMs = new Date(seq[j].created_at).getTime();
          if (netAt(jMs) >= thresh) { j++; continue; }
          target = { ms: jMs, tag: '下一卖' }; break;
        }
        j++;
      }
      if (!target) { target = { ms: r.eT + 300000, tag: '末价+5m' }; }
      const pTgt = priceAt(r.a, target.ms);
      if (!(pTgt > 0)) continue;
      const cf = out0 * (pTgt / pNow);
      const d = cf - out0;
      totalDelta += d;
      detail.push(`${r.a.slice(0, 10)} ${new Date(tMs).toISOString().slice(11, 19)} 净额抑制(净买${net.toFixed(2)}B ppNow=${((pNow / r.buyP - 1) * 100).toFixed(0)}%) 原${out0.toFixed(3)} →${tag} ${cf.toFixed(3)} Δ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
    }
  }
  return { totalDelta, nSup, detail };
}
for (const [name, win, th] of [
  ['D 近60s 净买≥0.3', 60000, 0.3],
  ['D 近120s 净买≥0.5', 120000, 0.5],
]) {
  const r = simNet(win, th);
  console.log(`\n=== 反事实 ${name}：抑制 ${r.nSup} 笔，ΣΔ=${r.totalDelta >= 0 ? '+' : ''}${r.totalDelta.toFixed(4)} BNB ===`);
  for (const d of r.detail) console.log(`  ${d}`);
}
// ===== famous 卖出轨迹：持仓期内+持仓期后 5min，对照我们卖点与之后价格 =====
console.log(`\n=== famous 卖出轨迹（含持仓期后 5min 窗，看是否领先崩盘）===`);
for (const r of rowsOut) {
  const fs2 = (famousSells.get(r.a) || []).filter(f => f.ts > r.bT && f.ts <= r.eT + 300000);
  if (!fs2.length) { console.log(`${r.a.slice(0, 10)}：famous 零卖出`); continue; }
  const lines = fs2.map(f => {
    const pNow = priceAt(r.a, f.ts);
    const ppNow = r.buyP > 0 && pNow ? ((pNow / r.buyP - 1) * 100).toFixed(0) + '%' : '?';
    const after60 = (() => { const p = priceAt(r.a, f.ts + 60000); return p && pNow ? ((p / pNow - 1) * 100).toFixed(0) + '%' : '?'; })();
    const after300 = (() => { const p = priceAt(r.a, f.ts + 300000); return p && pNow ? ((p / pNow - 1) * 100).toFixed(0) + '%' : '?'; })();
    return `    ${new Date(f.ts).toISOString().slice(11, 19)} 卖${f.bnb.toFixed(3)}B pp=${ppNow} →60s ${after60} →5m ${after300}`;
  });
  console.log(`${r.a.slice(0, 10)} famous 卖 ${fs2.length} 笔/${fs2.reduce((s, f) => s + f.bnb, 0).toFixed(2)}B（末卖=${new Date(r.eT).toISOString().slice(11, 19)}）`);
  for (const l of lines) console.log(l);
}
// ===== 独立大样本：全量票 famous 卖出事件（≥0.2B）后价格分布 =====
// 与我们是否成交无关——纯票本体属性，验证「famous 大额卖=出货信号」
{
  const events = [];
  for (const [addr, list] of famousSells) {
    const s = priceSeries.get(addr); if (!s) continue;
    const sorted = list.slice().sort((a, b) => a.ts - b.ts);
    let i = 0;
    while (i < sorted.length) {
      if (sorted[i].bnb < 0.2) { i++; continue; }
      // 事件=单笔≥0.2B；60s 内的后续卖出并窗（避免同一出货潮重复计）
      const t0 = sorted[i].ts;
      let j = i, sum = sorted[i].bnb;
      while (j + 1 < sorted.length && sorted[j + 1].ts - t0 <= 60000) { j++; sum += sorted[j].bnb; }
      const p0 = priceAt(addr, t0);
      if (p0 > 0) {
        const q = (sec) => { const p = priceAt(addr, t0 + sec * 1000); return p ? (p / p0 - 1) * 100 : null; };
        events.push({ addr, t: t0, sum, p0, f1: q(60), f3: q(180), f5: q(300) });
      }
      i = j + 1;
    }
  }
  events.sort((a, b) => a.t - b.t);
  console.log(`\n=== 全量 famous 卖出事件（单笔≥0.2B，60s 并窗）${events.length} 起 ===`);
  const med = a => a.length ? (a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]).toFixed(1) + '%' : '—';
  const avg = a => a.length ? (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) + '%' : '—';
  const pos = a => a.length ? (a.filter(x => x > 0).length / a.length * 100).toFixed(0) + '%' : '—';
  for (const [name, evs] of [['全部', events], ['事件额≥0.5B', events.filter(e => e.sum >= 0.5)], ['事件额≥1B', events.filter(e => e.sum >= 1)]]) {
    console.log(`  ${name} n=${evs.length} | 1m 中位=${med(evs.map(e => e.f1).filter(x => x != null))} 正率=${pos(evs.map(e => e.f1).filter(x => x != null))} | 3m 中位=${med(evs.map(e => e.f3).filter(x => x != null))} 正率=${pos(evs.map(e => e.f3).filter(x => x != null))} | 5m 中位=${med(evs.map(e => e.f5).filter(x => x != null))} 正率=${pos(evs.map(e => e.f5).filter(x => x != null))}`);
  }
  console.log(`  明细（前 30 起，按时间）：`);
  for (const e of events.slice(0, 30)) {
    const f = (x) => x == null ? '?' : (x >= 0 ? '+' : '') + x.toFixed(0) + '%';
    console.log(`    ${new Date(e.t).toISOString().slice(5, 19)} ${e.addr.slice(0, 10)} 卖${e.sum.toFixed(2)}B →1m ${f(e.f1)} →3m ${f(e.f3)} →5m ${f(e.f5)}`);
  }
  // 净额分桶：事件窗卖额 sum 对照 [t0-60s, t0+60s] famous 买额 → 纯出货 vs 对倒出货
  for (const e of events) {
    e.net = e.sum - (famousBuys.get(e.addr) || []).filter(f => f.ts > e.t - 60000 && f.ts <= e.t + 60000).reduce((s, f) => s + f.bnb, 0);
  }
  console.log(`  净额分桶（事件额 − 同窗±60s famous 买额）：`);
  for (const [name, evs] of [
    ['净卖≥0.5（纯出货）', events.filter(e => e.net >= 0.5)],
    ['净卖 0~0.5', events.filter(e => e.net >= 0 && e.net < 0.5)],
    ['净买>0（对倒：同窗买>卖）', events.filter(e => e.net < 0)],
  ]) {
    console.log(`    ${name} n=${evs.length} | 1m 中位=${med(evs.map(e => e.f1).filter(x => x != null))} 正率=${pos(evs.map(e => e.f1).filter(x => x != null))} | 3m 中位=${med(evs.map(e => e.f3).filter(x => x != null))} 正率=${pos(evs.map(e => e.f3).filter(x => x != null))} | 5m 中位=${med(evs.map(e => e.f5).filter(x => x != null))} 正率=${pos(evs.map(e => e.f5).filter(x => x != null))}`);
  }
}
// ===== C：全窗口 famous 大额买入停止事件（两遍流式扫全量票，回应「什么时候纯买入停止」）=====
{
  const rosterToks = new Set();
  const fbAll = new Map(), fsAll = new Map();
  for (const plat of ['fourmeme', 'flap']) {
    const rl = createInterface({ input: createReadStream(`${CACHE}/${plat}.jsonl.gz`).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (!(Number(row.bnb_amount) > 0)) continue;
      const w = (row.sender_address || row.trader_address || '').toLowerCase();
      if (!roster.has(w)) continue;
      rosterToks.add(row.token_address);
      const bucket = row.trade_type === 'buy' ? fbAll : fsAll;
      if (!bucket.has(row.token_address)) bucket.set(row.token_address, []);
      bucket.get(row.token_address).push({ ts: new Date(row.block_time).getTime(), bnb: Number(row.bnb_amount) });
    }
  }
  for (const a of byTok.keys()) rosterToks.add(a); // 成交票并入（供价格序列覆盖）
  console.log(`\n[全量扫] 有 famous 行为的 token ${rosterToks.size} 张（famous 买 ${[...fbAll.values()].reduce((s, a) => s + a.length, 0)} 笔 / 卖 ${[...fsAll.values()].reduce((s, a) => s + a.length, 0)} 笔）`);
  const psAll = new Map();
  for (const plat of ['fourmeme', 'flap']) {
    const rl = createInterface({ input: createReadStream(`${CACHE}/${plat}.jsonl.gz`).pipe(createGunzip()) });
    for await (const line of rl) {
      if (!line) continue;
      const row = JSON.parse(line);
      if (!rosterToks.has(row.token_address)) continue;
      const p = Number(row.price_bnb);
      if (p > 0 && !row.price_outlier) {
        if (!psAll.has(row.token_address)) psAll.set(row.token_address, []);
        psAll.get(row.token_address).push({ ts: new Date(row.block_time).getTime(), p });
      }
    }
  }
  for (const a of psAll.keys()) psAll.get(a).sort((x, y) => x.ts - y.ts);
  const pAt = (addr, tsMs) => {
    const s = psAll.get(addr); if (!s) return null;
    let lo = 0, hi = s.length - 1, r = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (s[m].ts <= tsMs) { r = s[m].p; lo = m + 1; } else hi = m - 1; }
    return r;
  };
  // 停止事件=最后一笔 ≥0.1B famous 买入；dose=停止前 5min famous 累计买额
  const stops = [];
  for (const [addr, list] of fbAll) {
    list.sort((a, b) => a.ts - b.ts);
    const big = list.filter(f => f.bnb >= 0.1);
    if (!big.length) continue;
    const tL = big[big.length - 1].ts;
    const dose = list.filter(f => f.ts > tL - 300000 && f.ts <= tL).reduce((s, f) => s + f.bnb, 0);
    const p0 = pAt(addr, tL); if (!(p0 > 0)) continue;
    const q = (sec) => { const p = pAt(addr, tL + sec * 1000); return p ? (p / p0 - 1) * 100 : null; };
    stops.push({ addr, t: tL, dose, nBig: big.length, f1: q(60), f3: q(180), f5: q(300), f15: q(900) });
  }
  stops.sort((a, b) => a.t - b.t);
  const med2 = a => a.length ? (a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)]).toFixed(1) + '%' : '—';
  const pos2 = a => a.length ? (a.filter(x => x > 0).length / a.length * 100).toFixed(0) + '%' : '—';
  console.log(`\n=== 全窗口 famous 大额买入停止事件（最后一笔 ≥0.1B 起算）${stops.length} 起 ===`);
  for (const [name, evs] of [
    ['停止前5min累计买 ≥1B（持续大额后停）', stops.filter(e => e.dose >= 1)],
    ['0.3~1B', stops.filter(e => e.dose >= 0.3 && e.dose < 1)],
    ['<0.3B（零星后停）', stops.filter(e => e.dose < 0.3)],
  ]) {
    console.log(`  ${name} n=${evs.length} | 1m 中位=${med2(evs.map(e => e.f1).filter(x => x != null))} 正率=${pos2(evs.map(e => e.f1).filter(x => x != null))} | 3m 中位=${med2(evs.map(e => e.f3).filter(x => x != null))} 正率=${pos2(evs.map(e => e.f3).filter(x => x != null))} | 5m 中位=${med2(evs.map(e => e.f5).filter(x => x != null))} 正率=${pos2(evs.map(e => e.f5).filter(x => x != null))} | 15m 中位=${med2(evs.map(e => e.f15).filter(x => x != null))} 正率=${pos2(evs.map(e => e.f15).filter(x => x != null))}`);
  }
  console.log(`  明细（前 25 起）：`);
  for (const e of stops.slice(0, 25)) {
    const f = (x) => x == null ? '?' : (x >= 0 ? '+' : '') + x.toFixed(0) + '%';
    console.log(`    ${new Date(e.t).toISOString().slice(5, 19)} ${e.addr.slice(0, 10)} 前5min买${e.dose.toFixed(2)}B/${e.nBig}笔大 →1m ${f(e.f1)} →3m ${f(e.f3)} →5m ${f(e.f5)} →15m ${f(e.f15)}`);
  }
  console.log(`  28ad/ba5e 专项：`);
  for (const e of stops.filter(e => e.addr.startsWith('0x28ad2c7d') || e.addr.startsWith('0xba5ed45b'))) {
    const f = (x) => x == null ? '?' : (x >= 0 ? '+' : '') + x.toFixed(0) + '%';
    console.log(`    ${e.addr.slice(0, 10)} 停止于 ${new Date(e.t).toISOString().slice(5, 19)} 前5min买${e.dose.toFixed(2)}B →1m ${f(e.f1)} →3m ${f(e.f3)} →5m ${f(e.f5)} →15m ${f(e.f15)}`);
  }
  // ===== D：大票专项（用户裁定「只看大票，吃足大金狗涨幅」）=====
  // 大票=V107 成交 ∧（famous 窗口总买 ≥1B ∨ ATH≥+200% vs 我们买点）
  // 对齐四条线：ATH 时刻 / famous 买入停止(+60s 确认) / famous 首笔 ≥0.2B 卖 / 我们实际逐卡卖
  // 反事实（tick 价格比率口径，忽略冲击成本）：全部卡改在信号点卖 = Σ(out_i × P(T_sig)/P(t_i))
  {
    const rows = [];
    for (const a of byTok.keys()) {
      const fb = fbAll.get(a) || [];
      const seq = byTok.get(a);
      const firstBuy = seq.find(t => t.trade_direction === 'buy');
      const lastSell = [...seq].reverse().find(t => t.trade_direction === 'sell');
      if (!firstBuy || !lastSell) continue;
      const bT = new Date(firstBuy.created_at).getTime();
      const eT = new Date(lastSell.created_at).getTime();
      const buyP = pAt(a, bT); if (!(buyP > 0)) continue;
      const s = psAll.get(a); if (!s) continue;
      let ath = 0, athT = 0;
      for (const pt of s) { if (pt.ts < bT) continue; if (pt.ts > eT + 900000) break; if (pt.p > ath) { ath = pt.p; athT = pt.ts; } }
      if (!(ath > 0)) continue;
      const athPp = (ath / buyP - 1) * 100;
      const famousTot = fb.reduce((s2, f) => s2 + f.bnb, 0);
      if (!(famousTot >= 1 || athPp >= 200)) continue;
      const sells = seq.filter(t => t.trade_direction === 'sell');
      const R_real = sells.reduce((s2, t) => s2 + Number(t.output_amount), 0);
      const lastSellPp = (() => { const p = pAt(a, eT); return p ? ((p / buyP - 1) * 100).toFixed(0) + '%' : '?'; })();
      // 加权执行均价 pp（按所得 BNB 加权，用各卡时刻 tick 价近似）
      const wAvgPp = sells.reduce((s2, t) => { const p = pAt(a, new Date(t.created_at).getTime()); return s2 + (p ? (p / buyP - 1) * 100 * Number(t.output_amount) : 0); }, 0) / Math.max(R_real, 1e-9);
      // 候选卖点（限持仓期内激活）
      const big = fb.filter(f => f.bnb >= 0.1).sort((x, y) => x.ts - y.ts);
      const tStop = big.length && big[big.length - 1].ts > bT ? big[big.length - 1].ts + 60000 : null;
      const fs2 = (fsAll.get(a) || []).filter(f => f.bnb >= 0.2 && f.ts > bT).sort((x, y) => x.ts - y.ts);
      const tSell = fs2.length ? fs2[0].ts : null;
      const rAt = (tSig) => sells.reduce((s2, t) => {
        const tMs = new Date(t.created_at).getTime();
        const pE = pAt(a, tMs), pS = pAt(a, tSig);
        return s2 + (pE > 0 && pS > 0 ? Number(t.output_amount) * pS / pE : Number(t.output_amount));
      }, 0);
      rows.push({ a, famousTot, athPp, athT, wAvgPp, lastSellPp, eT, tStop, tSell, R_real, R_stop: tStop ? rAt(tStop) : null, R_sell0: tSell ? rAt(tSell) : null, nSell: sells.length });
    }
    rows.sort((x, y) => y.R_real - x.R_real);
    console.log(`\n=== 大票专项（V107 成交 ∧ famous总买≥1B ∨ ATH≥+200%）${rows.length} 张 ===`);
    console.log(`格式：票 | famous总买 | ATH pp@时刻 | 实际回收(卡数,加权pp,末卡pp@时刻) | 停止信号回收(+60s确认@时刻) | 首大卖回收(@时刻)`);
    let SR = 0, SS = 0, SL = 0, nS = 0, nL = 0;
    for (const r of rows) {
      const hh = t => t ? new Date(t).toISOString().slice(11, 19) : '—';
      const d = (v) => v == null ? '—' : (v >= r.R_real ? '+' : '') + (v - r.R_real).toFixed(3);
      console.log(`  ${r.a.slice(0, 10)} | 买${r.famousTot.toFixed(2)}B | ATH +${r.athPp.toFixed(0)}%@${hh(r.athT)} | 实${r.R_real.toFixed(3)}(${r.nSell}卡,均${r.wAvgPp.toFixed(0)}%,末${r.lastSellPp}@${hh(r.eT)}) | 停止${d(r.R_stop)}@${hh(r.tStop)} | 首卖${d(r.R_sell0)}@${hh(r.tSell)}`);
      SR += r.R_real;
      if (r.R_stop != null) { SS += r.R_stop; nS++; }
      if (r.R_sell0 != null) { SL += r.R_sell0; nL++; }
    }
    console.log(`  合计：实际 Σ=${SR.toFixed(3)} | 停止信号 Σ=${SS.toFixed(3)}（Δ${(SS - SR).toFixed(3)}, ${nS}/${rows.length} 张有信号）| 首大卖 Σ=${SL.toFixed(3)}（Δ${(SL - SR).toFixed(3)}, ${nL}/${rows.length} 张有信号）`);
    console.log(`  ⚠ 反事实=全卡在信号点按 tick 价无冲击全清，实际大额清仓有冲击成本，正 Δ 会高估`);
    // ===== E：用户精确口径反事实——卡浮盈 pp≥100 ∧ famous 仍在入场 → 该卡延到 release 时点卖 =====
    // release 三变体：R1=停止确认（末笔 ≥0.1B 买+60s）；R2=首笔 ≥0.2B famous 卖；R3=两者先到
    // 触发两变体：V1=60s 净买（Σ买-Σ卖）≥0.3；V2=120s 内有 ≥0.1B 买入
    {
      const rels = [
        ['R1 停止确认', r => r.tStop],
        ['R2 首大卖', r => r.tSell],
        ['R3 先到', r => { const c = [r.tStop, r.tSell].filter(x => x != null); return c.length ? Math.min(...c) : null; }],
      ];
      const trigs = [
        ['V1 60s净买≥0.3', (fb, fs, tMs) =>
          fb.filter(f => f.ts > tMs - 60000 && f.ts <= tMs).reduce((s, f) => s + f.bnb, 0)
          - fs.filter(f => f.ts > tMs - 60000 && f.ts <= tMs).reduce((s, f) => s + f.bnb, 0) >= 0.3],
        ['V2 120s内有≥0.1B买', (fb, fs, tMs) => fb.some(f => f.bnb >= 0.1 && f.ts > tMs - 120000 && f.ts <= tMs)],
      ];
      console.log(`\n=== 精确口径：pp≥100 ∧ famous 在场 → 该卡延到 release（只动满足条件的卡，其余照常）===`);
      for (const [tn, trig] of trigs) {
        for (const [rn, rel] of rels) {
          let dTot = 0; const det = [];
          for (const r of rows) {
            const fb = fbAll.get(r.a) || [];
            const fs = fsAll.get(r.a) || [];
            const tR = rel(r);
            const seq = byTok.get(r.a).filter(t => t.trade_direction === 'sell');
            const firstBuy = byTok.get(r.a).find(t => t.trade_direction === 'buy');
            const bT = new Date(firstBuy.created_at).getTime();
            const buyP = pAt(r.a, bT); if (!(buyP > 0)) continue;
            for (const t of seq) {
              const tMs = new Date(t.created_at).getTime();
              const pNow = pAt(r.a, tMs); if (!(pNow > 0)) continue;
              const pp = (pNow / buyP - 1) * 100;
              if (pp < 100) continue;
              if (!trig(fb, fs, tMs)) continue;
              if (tR == null) continue;
              const pR = pAt(r.a, tR); if (!(pR > 0)) continue;
              const out0 = Number(t.output_amount);
              const d = out0 * (pR / pNow) - out0;
              dTot += d;
              det.push(`${r.a.slice(0, 10)} 卡@${new Date(tMs).toISOString().slice(11, 19)} pp=${pp.toFixed(0)}% →${rn.slice(0, 2)} ${new Date(tR).toISOString().slice(11, 19)} Δ${d >= 0 ? '+' : ''}${d.toFixed(3)}`);
            }
          }
          console.log(`  ${tn} × ${rn}：动 ${det.length} 卡，ΣΔ=${dTot >= 0 ? '+' : ''}${dTot.toFixed(4)} BNB`);
          for (const d of det) console.log(`    ${d}`);
        }
      }
    }
  }
}
process.exit(0);
