// btv109 第六批复审 5 条反馈取证（182 跑，只读）：
// ① T092 幼仔「famous 盘」——roster v3 名单钱包行为时间线（BP61 收割三分）
// ② T097 FOGO「单块九个交易的作弊盘」——9 笔 block 逐笔构成+等额/塞单锚
// ③ T098 我画地为牢「Burst 无大户」——burst 波结构+大户在场三分（BP79 口径）
// ④ T100 原谅「先买后卖分拆盘」——逐 block 买卖分界（候选 A 第 3 票）
// ⑤ T101 BSI「单区块密集砸盘作弊盘」——砸盘 block 逐笔+零买入纯卖（候选 B 第 3 票）
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const RUN = 'scripts/buy-point/data/bp-run-2026-11-12T23-22-53-137Z.json';
const ROSTER = 'config/rosters/famous-copy-wallets.json';

const TARGETS = {
  'T092 幼仔':     '0x3b32c66b84ef8e79db289aa05f367cb816047777',
  'T097 FOGO':     '0x3109e995e85491449d26616242ca185c71dd7777',
  'T098 我画地为牢': '0x0f4bc185b880cfeaeb3d505f16c4b71408307777',
  'T100 原谅':     '0xbc08b9cd366633ccaa9dba8026ba34a673027777',
  'T101 BSI':      '0xbb44bdd4b79b03d634bde6a2cc9814ea28f37777',
};
const FAM = new Set(['T092 幼仔']);
const NINE = new Set(['T097 FOGO']);
const BURST = new Set(['T098 我画地为牢']);
const SPLIT = new Set(['T100 原谅']);
const DUMP = new Set(['T101 BSI']);

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

// 锚前 block 序列（含每 block 买卖构成）
function blockSeries(rows, aTs, afterSec = 120) {
  const blocks = new Map();
  for (const r of rows) {
    const t = ts(r.block_time);
    if (t > aTs + afterSec) continue;
    if (!blocks.has(r.block_number)) blocks.set(r.block_number, { blk: r.block_number, ts2: r.block_time, buy: 0, nb: 0, buyers: new Set(), sell: 0, ns: 0, sellers: new Set(), rows: [] });
    const b = blocks.get(r.block_number);
    b.rows.push(r);
    if (r.trade_type === 'buy') { b.buy += r.bnb_amount; b.nb++; b.buyers.add(wallet(r)); } else { b.sell += r.bnb_amount; b.ns++; b.sellers.add(wallet(r)); }
  }
  return [...blocks.values()].sort((x, y) => x.blk - y.blk);
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
  if (sig) {
    const cc = sig.metadata?.cheatCheck || {};
    console.log(`生产 cheat: grade=${cc.grade} exempt=${cc.exempt?.code}(orig=${cc.exempt?.originalGrade}) act=${cc.levels?.activityLevel} sbw=${cc.levels?.stallBurstWave}`);
    console.log(`  reasons=${JSON.stringify(cc.reasons || [])}`);
  }
  const pid = 'BP-' + name.split(' ')[0];
  const rr = runByPoint.get(pid);

  // ── 共通：逐 block 买卖结构（锚后 120s）──
  console.log(`\n[逐 block 买卖结构]（锚=${anchor.slice(11, 19)}，至锚后 120s）`);
  const blocks = blockSeries(rows, aTs);
  for (const b of blocks) {
    const rel = ts(b.ts2) <= aTs ? '锚前' : `+${Math.round(ts(b.ts2) - aTs)}s`;
    const flag = b.sellers.size >= 4 ? ` ⚠️${b.sellers.size}户卖` : (b.buyers.size >= 4 ? ` ⚠️${b.buyers.size}户买` : '');
    console.log(`  ${b.ts2.slice(11, 19)} b${b.blk} 买${fmtN(b.buy)}(${b.nb}笔/${b.buyers.size}户) 卖${fmtN(b.sell)}(${b.ns}笔/${b.sellers.size}户) ${rel}${flag}`);
  }

  // ── ① T092 famous 盘 ──
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
    console.log(`  BP61 收割臂判据核对: 净>0 在场=${holding} / Σ净≈0或负=${famBuy - famSell <= 0.005 ? '是' : '否'} / 占买≥一成=${famBuy / (totalBuy || 1) >= 0.1 ? '是' : '否'}`);
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /famous|insider|noBuy/i.test(k));
      console.log(`  生产 anchors(famous/insider): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : v)).join(' ') || '无'}`);
    }
    const fa = rr?.anchors || rr?.digest || {};
    const fkeys = Object.entries(fa).filter(([k]) => /famous/i.test(k));
    console.log(`  重析 anchors(famous): ${fkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v)).join(' ') || '无'}`);
    console.log(`  重析 mp=${rr?.answers?.market_pattern ?? rr?.digest?.market_pattern}(${rr?.mpProb}) holder=${rr?.answers?.holder_concentration}(${rr?.holderProb})`);
  }

  // ── ② T097 单块九交易 ──
  if (NINE.has(name)) {
    const target = blocks.filter(b => b.rows.length >= 8);
    console.log(`\n[≥8 笔 block 逐笔明细]`);
    for (const b of target) {
      const rel = ts(b.ts2) <= aTs ? '锚前' : `+${Math.round(ts(b.ts2) - aTs)}s`;
      console.log(`  ▼ ${b.ts2.slice(11, 19)} b${b.blk} ${b.rows.length}笔 ${rel}：`);
      for (const r of b.rows) {
        console.log(`    ${r.trade_type.padEnd(4)} ${fmtN(r.bnb_amount, 4)} ${wallet(r).slice(0, 12)}${roster.has(wallet(r)) ? '★famous' : ''}`);
      }
      const amts = b.rows.filter(r => r.trade_type === 'buy').map(r => r.bnb_amount.toFixed(4));
      const eq = amts.length && amts.every(a => a === amts[0]);
      console.log(`    → 买额列表 [${amts.join(', ')}] 等额=${eq ? '是' : '否'}`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /equal|sameBlock|pulse|exact|insider|noBuy|dump/i.test(k));
      console.log(`  生产 anchors(等额/同块/insider/dump): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 260) : v)).join(' ') || '无'}`);
    }
    const anchors = rr?.anchors || {};
    const nkeys = Object.entries(anchors).filter(([k]) => /equal|sameBlock|pulse|exact|dump|insider|noBuy/i.test(k));
    console.log(`  重析 anchors(等额/同块/dump/insider): ${nkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v)).join(' ') || '无'}`);
    console.log(`  重析 mp=${rr?.answers?.market_pattern}(${rr?.mpProb}) entry=${rr?.answers?.entry_shape}(${rr?.entryProb})`);
  }

  // ── ③ T098 Burst 无大户 ──
  if (BURST.has(name)) {
    console.log(`\n[burst 波结构]（静默段 gap≥50s 出口后 60s）`);
    const segs = burstShapes2(rows, aTs);
    if (!segs.length) console.log('  （无 ≥50s 静默段）');
    for (const s of segs) {
      console.log(`  gap=${s.gapSec}s 出口=${s.exitAt.slice(11, 19)} 距锚${Math.round(aTs - s.exitTs)}s`);
      console.log(`    出口60s整窗: 买${s.win60.buy} 卖${s.win60.sell} 卖占比${s.win60.sellPct}%`);
      if (s.byBuy) console.log(`    按买最密5s窗@${s.byBuy.at}: 买${s.byBuy.buy} 卖${s.byBuy.sell} ${s.byBuy.n}笔/${s.byBuy.wallets}户`);
    }
    // 大户在场三分（BP79 口径：单笔 ≥0.19 买入的钱包）
    const agg = walletAgg(pre);
    const whales = [...agg.entries()].filter(([, o]) => o.maxBuy >= 0.19);
    console.log(`\n[大户在场三分]（锚前单笔买 ≥0.19 钱包 = ${whales.length} 个）`);
    for (const [w, o] of whales) {
      const net = o.buy - o.sell;
      const lastTs = ts(o.last);
      const since = Math.round(aTs - lastTs);
      const cls = net <= 0.005 ? '●清仓离场(净≤0.005)' : (since <= 120 ? '◆活跃在场' : '○挂账在场(>' + since + 's 沉默)');
      console.log(`  ${w.slice(0, 12)}${roster.has(w) ? '★famous' : ''} 最大单笔${fmtN(o.maxBuy, 3)} 买${fmtN(o.buy)}(${o.buyN}笔) 卖${fmtN(o.sell)} 净${fmtN(net, 3)} 末动距锚=${since}s → ${cls}`);
    }
    if (!whales.length) {
      const top = [...agg.entries()].filter(([, o]) => o.buy > 0).sort((x, y) => y[1].maxBuy - x[1].maxBuy).slice(0, 5);
      console.log('  （无 ≥0.19 单笔钱包——买入 top5 单笔规模：）');
      for (const [w, o] of top) console.log(`    ${w.slice(0, 12)} 最大单笔${fmtN(o.maxBuy, 4)} 买${fmtN(o.buy)}(${o.buyN}笔) 净${fmtN(o.buy - o.sell, 3)}`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const lv = sig.metadata?.cheatCheck?.levels || {};
      const keys = o => Object.entries(o).filter(([k]) => /burst|spike/i.test(k));
      console.log(`  生产 levels(burst/spike): ${keys(lv).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
      console.log(`  生产 anchors(burst/spike): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 260) : v)).join(' ') || '无'}`);
    }
    const anchors = rr?.anchors || {};
    const bkeys = Object.entries(anchors).filter(([k]) => /burst/i.test(k));
    console.log(`  重析 anchors(burst): ${bkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v)).join(' ') || '无'}`);
    console.log(`  重析 act=${rr?.answers?.activity_level}(${rr?.actProb}) rule=${rr?.rule ?? rr?.bucket}`);
  }

  // ── ④ T100 先买后卖分拆 ──
  if (SPLIT.has(name)) {
    // 自动分界检测：锚前 block 按序，找「前段纯买/后段纯卖」的最佳分界
    const preBlk = blocks.filter(b => ts(b.ts2) <= aTs);
    console.log(`\n[先买后卖分界检测]（锚前 ${preBlk.length} 个 block）`);
    let best = null;
    for (let i = 0; i <= preBlk.length; i++) {
      const head = preBlk.slice(0, i), tail = preBlk.slice(i);
      if (!head.length || !tail.length) continue;
      const hB = head.reduce((a, b) => a + b.buy, 0), hS = head.reduce((a, b) => a + b.sell, 0);
      const tB = tail.reduce((a, b) => a + b.buy, 0), tS = tail.reduce((a, b) => a + b.sell, 0);
      // 分界质量：前段买占比 × 后段卖占比
      const q = (hB / (hB + hS || 1)) * (tS / (tB + tS || 1)) * (head.length + tail.length) / preBlk.length;
      if (!best || q > best.q) best = { q, i, at: tail[0].ts2, hB, hS, tB, tS, hN: head.length, tN: tail.length };
    }
    if (best) {
      console.log(`  最佳分界 @${best.at.slice(11, 19)}（b${preBlk[best.i]?.blk}）：`);
      console.log(`    前段 ${best.hN}块: 买${fmtN(best.hB)} 卖${fmtN(best.hS)}（买占比${fmtN(best.hB / (best.hB + best.hS || 1) * 100, 1)}%）`);
      console.log(`    后段 ${best.tN}块: 买${fmtN(best.tB)} 卖${fmtN(best.tS)}（卖占比${fmtN(best.tS / (best.tB + best.tS || 1) * 100, 1)}%）`);
    }
    // burst 对照（sbw 判 burst 用的波）
    const segs = burstShapes2(rows, aTs);
    for (const s of segs) {
      console.log(`  burst 段: gap=${s.gapSec}s 出口=${s.exitAt.slice(11, 19)} 距锚${Math.round(aTs - s.exitTs)}s 出口60s 买${s.win60.buy} 卖${s.win60.sell}（卖占比${s.win60.sellPct}%）`);
      if (s.byBuy) console.log(`    按买最密5s窗@${s.byBuy.at}: 买${s.byBuy.buy} ${s.byBuy.n}笔/${s.byBuy.wallets}户`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /burst|pump|spike/i.test(k));
      console.log(`  生产 anchors(burst/pump/spike): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 260) : v)).join(' ') || '无'}`);
    }
    const anchors = rr?.anchors || {};
    const pkeys = Object.entries(anchors).filter(([k]) => /phaseSplit|phase|dump|burst/i.test(k));
    console.log(`  重析 anchors(phase/dump/burst): ${pkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v)).join(' ') || '无'}`);
    console.log(`  重析 mp=${rr?.answers?.market_pattern}(${rr?.mpProb}) entry=${rr?.answers?.entry_shape}(${rr?.entryProb})`);
  }

  // ── ⑤ T101 单区块密集砸盘 ──
  if (DUMP.has(name)) {
    // 锚窗内卖侧最大 block 逐笔
    const sellBlk = blocks.filter(b => b.ns >= 3 || b.sell >= 0.2).sort((x, y) => y.sell - x.sell);
    console.log(`\n[砸盘 block 逐笔明细]（卖笔 ≥3 或卖额 ≥0.2 的 block，按卖额降序）`);
    for (const b of sellBlk.slice(0, 3)) {
      const rel = ts(b.ts2) <= aTs ? '锚前' : `+${Math.round(ts(b.ts2) - aTs)}s`;
      console.log(`  ▼ ${b.ts2.slice(11, 19)} b${b.blk} 卖${fmtN(b.sell)}(${b.ns}笔/${b.sellers.size}户) 买${fmtN(b.buy)}(${b.nb}笔) ${rel}：`);
      for (const r of b.rows.filter(r => r.trade_type === 'sell')) {
        console.log(`    sell ${fmtN(r.bnb_amount, 4)} ${wallet(r).slice(0, 12)}${roster.has(wallet(r)) ? '★famous' : ''}`);
      }
    }
    if (!sellBlk.length) console.log('  （无卖笔 ≥3 block）');
    // 零买入纯卖钱包（L_insider 口径）
    const agg = walletAgg(pre);
    const totalSell = pre.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    const noBuy = [...agg.values()].filter(o => o.buy <= 0.0001 && o.sell > 0.01);
    const noBuySell = noBuy.reduce((a, o) => a + o.sell, 0);
    console.log(`\n[零买入纯卖钱包]（L_insider 口径）: ${noBuy.length} 个 合计卖${fmtN(noBuySell)}/${fmtN(totalSell)}=${fmtN(totalSell > 0 ? noBuySell / totalSell * 100 : 0, 1)}%`);
    for (const o of noBuy.slice(0, 6)) console.log(`    卖${fmtN(o.sell)}(${o.sellN}笔 ${(o.firstSell || '').slice(11, 19)}→${(o.lastSell || '-').slice(11, 19)})`);
    // 块内跌幅（砸盘 block 前后价）
    const rel = rows.filter(r => r.price_bnb > 0);
    for (const b of sellBlk.slice(0, 2)) {
      const before = rel.filter(r => ts(r.block_time) < ts(b.ts2)).slice(-1)[0];
      const after = rel.filter(r => ts(r.block_time) > ts(b.ts2)).slice(0, 3);
      const minAfter = after.length ? Math.min(...after.map(r => r.price_bnb)) : null;
      if (before && minAfter) console.log(`  b${b.blk} 块内跌幅: 前${before.price_bnb.toExponential(3)} → 块后最低${minAfter.toExponential(3)} = ${((minAfter / before.price_bnb - 1) * 100).toFixed(1)}%`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /insider|noBuy|dump|sameBlock|equal/i.test(k));
      console.log(`  生产 anchors(insider/noBuy/同块): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 260) : v)).join(' ') || '无'}`);
    }
    const anchors = rr?.anchors || {};
    const dkeys = Object.entries(anchors).filter(([k]) => /dump|insider|noBuy|nearTail/i.test(k));
    console.log(`  重析 anchors(dump/insider/nearTail): ${dkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : v)).join(' ') || '无'}`);
    console.log(`  重析 mp=${rr?.answers?.market_pattern}(${rr?.mpProb}) entry=${rr?.answers?.entry_shape}(${rr?.entryProb})`);
  }
}
process.exit(0);
