// btv109 第五批复审 5 条反馈取证（182 跑，只读）：
// ① T073 「活跃度低」——活跃度数值族简化重算（全窗/尾10s/尾5s/逐10s桶）
// ② T078 「Famous 收割盘」——famous roster v3 26 址名单钱包行为时间线（BP61 收割三分判定）
// ③ T086 「burst太小」——burst 波量级（生产全窗锚 vs 静默段出口波真实量级）
// ④ T087 卖出轨迹取证（删 low-zone-stall-exit 卖臂动机）——trades 全成交+卖后价格轨迹
// ⑤ T089 「burst先买后卖的作弊快速收割形态」——逐 block 买卖分界+买入钱包快进快出时序
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const RUN = 'scripts/buy-point/data/bp-run-2026-11-12T23-22-53-137Z.json';
const ROSTER = 'config/rosters/famous-copy-wallets.json';

const TARGETS = {
  'T073 羊股':        '0xba42eef7e0f887f88fe6da79be59f75d59307777',
  'T078 Callcat':     '0x2692bcbc97dbf496ce4115b8191adb8347b27777',
  'T086 GIGACALL':    '0x3594916b199a97b6a0529cfcad1f177aa3687777',
  'T087 不对劲':      '0xb84e7e0e29513923272cbfb7ab1cc8e7de307777',
  'T089 AGENT领头羊': '0x77871da3a1819a6ba978e2f3954e64f8a9187777',
};
const ACT = new Set(['T073 羊股']);
const FAM = new Set(['T078 Callcat']);
const BURST = new Set(['T086 GIGACALL']);
const SELL = new Set(['T087 不对劲']);
const FLOW = new Set(['T089 AGENT领头羊']);

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const anchorOf = new Map(set.points.map(p => [p.tokenAddress, p.anchorTimeIso]));
const run = JSON.parse(fs.readFileSync(RUN, 'utf8'));
const runByPoint = new Map(run.results.map(r => [r.pointId, r]));
const roster = new Set(JSON.parse(fs.readFileSync(ROSTER, 'utf8')).wallets.map(w => w.toLowerCase()));

const c = await dbManager.getClient();
const sigs = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  sigs.push(...data); if (data.length < 1000) break; from += 1000;
}
const byTok = new Map();
for (const s of sigs) {
  if (!byTok.has(s.token_address)) byTok.set(s.token_address, []);
  byTok.get(s.token_address).push(s);
}

const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const ts = (iso) => Date.parse(iso) / 1000;
const fmtN = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

function walletAgg(pre) {
  const agg = new Map();
  for (const r of pre) {
    const w = wallet(r);
    if (!agg.has(w)) agg.set(w, { buy: 0, sell: 0, last: r.block_time, maxBuy: 0, firstBuy: null, firstSell: null, lastSell: null, lastBuy: null, sellN: 0, buyN: 0 });
    const o = agg.get(w);
    if (r.trade_type === 'buy') { o.buy += r.bnb_amount; o.maxBuy = Math.max(o.maxBuy, r.bnb_amount); o.firstBuy ??= r.block_time; o.lastBuy = r.block_time; o.buyN++; }
    else { o.sell += r.bnb_amount; o.firstSell ??= r.block_time; o.lastSell = r.block_time; o.sellN++; }
    o.last = r.block_time;
  }
  return agg;
}

function burstShapes2(rows, aTs) {
  const pre = rows.filter(r => ts(r.block_time) <= aTs);
  const segs = [];
  for (let i = 1; i < pre.length; i++) {
    const gap = ts(pre[i].block_time) - ts(pre[i - 1].block_time);
    if (gap >= 50) segs.push({ gapSec: Math.round(gap), exitAt: pre[i].block_time, exitTs: ts(pre[i].block_time) });
  }
  for (const seg of segs) {
    const win = pre.filter(r => ts(r.block_time) >= seg.exitTs && ts(r.block_time) <= seg.exitTs + 60);
    let byBuy = { key: 0 }, byTot = { key: 0 };
    for (let s0 = seg.exitTs; s0 < seg.exitTs + 55; s0 += 1) {
      const w = win.filter(r => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5);
      if (!w.length) continue;
      const b = w.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      const s = w.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
      const mk = (bnb) => ({ bnb, buy: b, sell: s, n: w.length, wallets: new Set(w.map(wallet)).size, t0: s0 });
      if (b > byBuy.key) byBuy = mk(b), byBuy.key = b;
      if (b + s > byTot.key) byTot = mk(b + s), byTot.key = b + s;
    }
    const fmt = (o) => o.t0 == null ? null : { at: new Date(o.t0 * 1000).toISOString().slice(11, 19), buy: +o.buy.toFixed(3), sell: +o.sell.toFixed(3), sellPct: o.buy + o.sell > 0 ? +((o.sell / (o.buy + o.sell)) * 100).toFixed(1) : null, n: o.n, wallets: o.wallets };
    seg.byBuy = fmt(byBuy); seg.byTot = fmt(byTot);
    const wb = win.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const ws = win.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    seg.win60 = { buy: +wb.toFixed(3), sell: +ws.toFixed(3), sellPct: wb + ws > 0 ? +((ws / (wb + ws)) * 100).toFixed(1) : null };
  }
  return segs;
}

for (const [name, addr] of Object.entries(TARGETS)) {
  const j = JSON.parse(fs.readFileSync(`${TICKS}/${addr}.json`, 'utf8'));
  const rows = j.rows;
  const anchor = anchorOf.get(addr) || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter(r => ts(r.block_time) <= aTs);
  console.log(`\n══════ ${name} ${addr} ════`);
  console.log(`ticks=${rows.length}（锚前 ${pre.length}）窗 ${rows[0].block_time.slice(11, 19)}→${rows[rows.length - 1].block_time.slice(11, 19)} 锚=${anchor.slice(11, 19)} age=${Math.round(aTs - ts(rows[0].block_time))}s`);

  const buys = (byTok.get(addr) || []).filter(s => s.action === 'buy');
  const sig = buys.find(s => s.executed) || buys[0];
  console.log(`BUY 信号 ${buys.length} 条，成交=${sig ? sig.created_at.slice(11, 19) : '无'}`);
  if (sig) {
    const cc = sig.metadata?.cheatCheck || {};
    console.log(`生产 cheat: grade=${cc.grade} exempt=${cc.exempt?.code} act=${cc.levels?.activityLevel} sbw=${cc.levels?.stallBurstWave}`);
    console.log(`  reasons=${JSON.stringify(cc.reasons || [])}`);
  }

  // ── ① T073 活跃度数值族 ──
  if (ACT.has(name)) {
    const span = Math.max(1, Math.round(aTs - ts(pre[0].block_time)));
    const buy = pre.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const sell = pre.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    let maxGap = 0;
    for (let i = 1; i < pre.length; i++) maxGap = Math.max(maxGap, ts(pre[i].block_time) - ts(pre[i - 1].block_time));
    const t0 = ts(pre[0].block_time);
    const nB = Math.ceil(span / 10);
    const nonEmpty = new Set(pre.map(r => Math.floor((ts(r.block_time) - t0) / 10)));
    console.log(`\n[活跃度数值族·简化重算]`);
    console.log(`  全窗: span=${span}s ticks=${pre.length} ${fmtN(pre.length / span * 60, 1)}/min Σ买=${fmtN(buy)} Σ卖=${fmtN(sell)} maxGap=${Math.round(maxGap)}s idlePct=${fmtN((1 - nonEmpty.size / nB) * 100, 1)}%`);
    const tail10 = pre.filter(r => aTs - ts(r.block_time) < 10);
    const t10b = tail10.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const t10s = tail10.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  尾10s: ${tail10.length}笔 买${fmtN(t10b)} 卖${fmtN(t10s)} 独立卖家${new Set(tail10.filter(r => r.trade_type === 'sell').map(wallet)).size}`);
    const tail5 = pre.filter(r => aTs - ts(r.block_time) < 5);
    const t5b = tail5.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  尾5s: ${tail5.length}笔 买${t5b.toFixed(3)}(${tail5.filter(r => r.trade_type === 'buy').length}笔)`);
    console.log(`  逐10s桶（买额/卖额/笔数/户数）:`);
    for (let b = 0; b < nB; b++) {
      const w = pre.filter(r => Math.floor((ts(r.block_time) - t0) / 10) === b);
      const at = new Date((t0 + b * 10) * 1000).toISOString().slice(11, 19);
      if (!w.length) { console.log(`    ${at} —（空桶）`); continue; }
      const bB = w.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      const bS = w.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
      console.log(`    ${at} b${fmtN(bB)} s${fmtN(bS)} ${w.length}笔 ${new Set(w.map(wallet)).size}户`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const lv = sig.metadata?.cheatCheck?.levels || {};
      const keys = o => Object.entries(o).filter(([k]) => /act|idle|tick|trade|span|near/i.test(k));
      console.log(`  生产 levels(act键): ${keys(lv).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
      console.log(`  生产 anchors(act键): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
    const pid = 'BP-' + name.split(' ')[0];
    const rr = runByPoint.get(pid);
    console.log(`  重析对照: act=${rr?.answers?.activity_level ?? rr?.digest?.activity_level}(${rr?.actProb}) an=${['spanSec','tickCount','ticksPerMin','avgTradeBnb','maxGapSec','idlePct'].map(k => k + '=' + (rr?.anchors?.[k] ?? rr?.digest?.[k])).join(' ')}`);
  }

  // ── ② T078 famous 收割取证 ──
  if (FAM.has(name)) {
    const agg = walletAgg(pre);
    const totalBuy = pre.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const totalSell = pre.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    const famAgg = new Map();
    for (const [w, o] of agg) if (roster.has(w)) famAgg.set(w, o);
    console.log(`\n[famous roster v3 名单钱包]（锚前窗命中 ${famAgg.size} 个 / 26 址名单）`);
    let famBuy = 0, famSell = 0, holding = 0;
    for (const [w, o] of famAgg) {
      const net = o.buy - o.sell;
      famBuy += o.buy; famSell += o.sell; if (net > 0.005) holding++;
      const sellPct = o.buy > 0 ? (o.sell / o.buy * 100).toFixed(0) : '-';
      const cls = net > 0.005 ? '◆在场持有' : (o.buy > 0 && o.sell / o.buy >= 0.95 ? '◇收割完(卖≥95%)' : (o.buy > 0 ? '部分卖出' : '纯卖(零买入)'));
      console.log(`  ${w} 买${fmtN(o.buy)}(${o.buyN}笔 ${(o.firstBuy || '').slice(11, 19)}→${(o.lastBuy || '').slice(11, 19)}) 卖${fmtN(o.sell)}(${o.sellN}笔 ${(o.firstSell || '-').slice(11, 19)}→${(o.lastSell || '-').slice(11, 19)}) 净${fmtN(net, 3)} 卖/买=${sellPct}% → ${cls}`);
    }
    if (!famAgg.size) console.log('  （锚前窗无名单钱包行）');
    console.log(`  合计: famous买${fmtN(famBuy)}/${fmtN(totalBuy)}=${fmtN(totalBuy > 0 ? famBuy / totalBuy * 100 : 0, 1)}%  famous卖${fmtN(famSell)}/${fmtN(totalSell)}=${fmtN(totalSell > 0 ? famSell / totalSell * 100 : 0, 1)}%  Σ净=${fmtN(famBuy - famSell, 3)}  在场持有钱包数=${holding}`);
    console.log(`  BP61 收割臂判据核对: 净>0 在场=${holding} 个 / Σ净≈0或负=${famBuy - famSell <= 0.005 ? '是' : '否'} / 占买≥一成=${famBuy / (totalBuy || 1) >= 0.1 ? '是' : '否'}`);
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /famous|insider|noBuy/i.test(k));
      console.log(`  生产 anchors(famous/insider键): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
    const pid = 'BP-' + name.split(' ')[0];
    const rr = runByPoint.get(pid);
    const fa = rr?.anchors || rr?.digest || {};
    const fkeys = Object.entries(fa).filter(([k]) => /famous/i.test(k));
    console.log(`  重析 anchors(famous键): ${fkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v)).join(' ') || '无'}`);
    console.log(`  重析 mp=${rr?.answers?.market_pattern ?? rr?.digest?.market_pattern}(${rr?.mpProb})`);
  }

  // ── ③ T086 burst 波量级 ──
  if (BURST.has(name)) {
    console.log(`\n[burst 波买卖结构]（静默段 gap≥50s 出口后 60s）`);
    const segs = burstShapes2(rows, aTs);
    if (!segs.length) console.log('  （无 ≥50s 静默段）');
    for (const s of segs) {
      console.log(`  gap=${s.gapSec}s 出口=${s.exitAt.slice(11, 19)} 距锚${Math.round(aTs - s.exitTs)}s`);
      console.log(`    出口60s整窗: 买${s.win60.buy} 卖${s.win60.sell} 卖占比${s.win60.sellPct}%`);
      if (s.byBuy) console.log(`    按买最密5s窗@${s.byBuy.at}: 买${s.byBuy.buy} 卖${s.byBuy.sell} ${s.byBuy.n}笔/${s.byBuy.wallets}户`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const lv = sig.metadata?.cheatCheck?.levels || {};
      const keys = o => Object.entries(o).filter(([k]) => /burst|spike|sbw|stall/i.test(k));
      console.log(`  生产 levels(burst键): ${keys(lv).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
      console.log(`  生产 anchors(burst键): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
    const pid = 'BP-' + name.split(' ')[0];
    const rr = runByPoint.get(pid);
    const anchors = rr?.anchors || {};
    const bkeys = Object.entries(anchors).filter(([k]) => /burst|act/i.test(k));
    console.log(`  重析 anchors(burst/act): ${bkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    let best = { key: 0 };
    for (let s0 = ts(rows[0].block_time); s0 < aTs; s0 += 1) {
      const w = pre.filter(r => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5);
      if (!w.length) continue;
      const b = w.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      if (b > best.key) best = { key: b, at: new Date(s0 * 1000).toISOString().slice(11, 19), b, n: w.length, wallets: new Set(w.map(wallet)).size };
    }
    if (best.at) console.log(`  全窗买最密5s窗: @${best.at} 买${fmtN(best.b)} ${best.n}笔/${best.wallets}户`);
  }

  // ── ④ T087 卖出轨迹（删 low-zone-stall-exit 动机）──
  if (SELL.has(name)) {
    const { data: tr, error } = await c.from('trades').select('*')
      .eq('experiment_id', EXP).eq('token_address', addr).order('id', { ascending: true });
    if (error) throw new Error('trades: ' + error.message);
    console.log(`\n[trades 全成交]（${tr.length} 行）`);
    for (const t of tr) {
      const md = t.metadata || {};
      console.log(`  ${String(t.created_at).slice(11, 19)} ${t.side} price=${t.price} bnb=${t.bnb_amount} strategy=${md.strategyId ?? md.strategyName ?? '-'} why=${md.why ?? '-'}${md.cardTrade ? ' card=' + JSON.stringify(md.cardTrade) : ''}`);
      const extra = Object.entries(md).filter(([k]) => !['strategyId', 'strategyName', 'why', 'cardTrade'].includes(k));
      if (extra.length) console.log(`    md: ${extra.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v).slice(0, 100))).join(' ')}`);
    }
    // 价格轨迹（price_bnb，越大越贵）
    const rel = rows.filter(r => r.price_bnb > 0);
    const buyRow = tr.find(t => t.side === 'buy');
    const sellRows = tr.filter(t => t.side === 'sell');
    const pAt = (t) => { const iso = t.created_at; const tt = ts(iso); let best = null; for (const r of rel) { if (ts(r.block_time) <= tt) best = r; } return best; };
    if (buyRow) { const r = pAt(buyRow); console.log(`  买入时刻价=${r ? r.price_bnb.toExponential(4) : '?'}（@${buyRow.created_at.slice(11, 19)}）`); }
    for (const s of sellRows) {
      const r = pAt(s);
      const st = ts(s.created_at);
      const after = rel.filter(x => ts(x.block_time) > st);
      const maxP = after.length ? Math.max(...after.map(x => x.price_bnb)) : null;
      const lastP = after.length ? after[after.length - 1].price_bnb : null;
      const sp = r ? r.price_bnb : null;
      console.log(`  卖出时刻价=${sp ? sp.toExponential(4) : '?'}（@${s.created_at.slice(11, 19)} strategy=${(s.metadata || {}).strategyId ?? (s.metadata || {}).why ?? '-'}）`);
      if (maxP && sp) console.log(`    卖后最高价=${maxP.toExponential(4)}（+${((maxP / sp - 1) * 100).toFixed(1)}%） 末价=${lastP.toExponential(4)}（${((lastP / sp - 1) * 100).toFixed(1)}%）`);
    }
    // 全窗高低点
    const hi = Math.max(...rel.map(x => x.price_bnb)), lo = Math.min(...rel.map(x => x.price_bnb));
    const hiAt = rel.find(x => x.price_bnb === hi).block_time.slice(11, 19);
    console.log(`  全窗价格: 低${lo.toExponential(4)}→高${hi.toExponential(4)}@${hiAt} 振幅${(hi / lo * 100).toFixed(0)}%`);
  }

  // ── ⑤ T089 burst 先买后卖收割形态 ──
  if (FLOW.has(name)) {
    console.log(`\n[burst 结构]（静默段 gap≥50s 出口后 60s）`);
    const segs = burstShapes2(rows, aTs);
    if (!segs.length) console.log('  （无 ≥50s 静默段——开盘即拉形状）');
    for (const s of segs) {
      console.log(`  gap=${s.gapSec}s 出口=${s.exitAt.slice(11, 19)} 距锚${Math.round(aTs - s.exitTs)}s`);
      console.log(`    出口60s整窗: 买${s.win60.buy} 卖${s.win60.sell} 卖占比${s.win60.sellPct}%`);
      if (s.byBuy) console.log(`    按买最密5s窗@${s.byBuy.at}: 买${s.byBuy.buy} 卖${s.byBuy.sell} ${s.byBuy.n}笔/${s.byBuy.wallets}户`);
      if (s.byTot) console.log(`    按总流量最密5s窗@${s.byTot.at}: 买${s.byTot.buy} 卖${s.byTot.sell} 卖占比${s.byTot.sellPct}% ${s.byTot.n}笔/${s.byTot.wallets}户`);
    }
    // 逐 block 买卖（锚前全部 + 锚后 120s）
    console.log(`\n[逐 block 买卖结构]（锚=${anchor.slice(11, 19)}，至锚后 120s）`);
    const blocks = new Map();
    for (const r of rows) {
      const t = ts(r.block_time);
      if (t > aTs + 120) continue;
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, { blk: r.block_number, ts2: r.block_time, buy: 0, nb: 0, buyers: new Set(), sell: 0, ns: 0, sellers: new Set() });
      const b = blocks.get(r.block_number);
      if (r.trade_type === 'buy') { b.buy += r.bnb_amount; b.nb++; b.buyers.add(wallet(r)); } else { b.sell += r.bnb_amount; b.ns++; b.sellers.add(wallet(r)); }
    }
    for (const b of [...blocks.values()].sort((x, y) => x.blk - y.blk)) {
      const rel = ts(b.ts2) <= aTs ? '锚前' : `+${Math.round(ts(b.ts2) - aTs)}s`;
      const flag = b.sellers.size >= 4 ? ` ⚠️${b.sellers.size}户卖` : (b.buyers.size >= 4 ? ` ⚠️${b.buyers.size}户买` : '');
      console.log(`  ${b.ts2.slice(11, 19)} b${b.blk} 买${fmtN(b.buy)}(${b.nb}笔/${b.buyers.size}户) 卖${fmtN(b.sell)}(${b.ns}笔/${b.sellers.size}户) ${rel}${flag}`);
    }
    // 买入钱包快进快出（含锚后 300s 卖出）
    console.log(`\n[买入钱包快进快出时序]（锚前买入 top10 按买额，卖出含锚后 300s）`);
    const aggAll = walletAgg(rows.filter(r => ts(r.block_time) <= aTs + 300));
    const preAgg = walletAgg(pre);
    const top10 = [...preAgg.entries()].filter(([, o]) => o.buy > 0).sort((x, y) => y[1].buy - x[1].buy).slice(0, 10);
    let fastFlip = 0;
    for (const [w, o0] of top10) {
      const o = aggAll.get(w) || o0;
      const holdSec = o.firstSell && o.lastBuy ? Math.round(ts(o.firstSell) - ts(o.lastBuy)) : (o.firstSell && o.firstBuy ? Math.round(ts(o.firstSell) - ts(o.firstBuy)) : null);
      const net = o.buy - o.sell;
      const isFamous = roster.has(w) ? '★famous' : '';
      if (holdSec != null && holdSec <= 60 && o.sell / o.buy >= 0.9) fastFlip++;
      console.log(`  ${w.slice(0, 10)}${isFamous} 买${fmtN(o.buy)}(${o0.buyN}笔@${(o0.firstBuy || '').slice(11, 19)}) 首卖${(o.firstSell || '-').slice(11, 19)} 末买→首卖=${holdSec == null ? '-' : holdSec + 's'} 卖${fmtN(o.sell)} 净${fmtN(net, 3)}${holdSec != null && holdSec <= 60 && o.sell / o.buy >= 0.9 ? ' ⚡快进快出(≤60s卖≥90%)' : ''}`);
    }
    console.log(`  快进快出（≤60s 且卖≥90%）: ${fastFlip}/${top10.length}`);
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /burst|spike|wash|sameBlock|equal|router|pump/i.test(k));
      console.log(`  生产 anchors(burst/组织键): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
  }
}
process.exit(0);
