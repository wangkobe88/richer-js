// btv109 第三批复审 6 条反馈取证（182 跑，只读）：
// ① T037/T042/T047 大户在场（买时目测无大户）② T041 burst 期 8 钱包同块捆绑购买
// ③ T045/T054 burst 触发波买卖结构（卖出力量占比）④ T045 大户老鼠仓撤退
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const RUN = 'scripts/buy-point/data/bp-run-2026-11-12T23-22-53-137Z.json';

const TARGETS = {
  'T037 踏步小猫':  '0x953e5808e324ebce4ea282c212ef1da4f1ec7777',
  'T041 CryptoWinter': '0xa3efddca9d8a138ace3548b8f70118a1c4767777',
  'T042 大白':      '0x4fa2388538cc0508b9174c508c3d68258d2f7777',
  'T045 魔渊':      '0x9295363666be41791f9ac20ad5cba59a69e07777',
  'T047 不服猫':    '0x7554069bfc4318537be0b20508a9f5a25ff97777',
  'T054 网上南宁':  '0x5026a06af5a92525474538fade0da3106f1b7777',
};
const WHALES = new Set(['T037 踏步小猫', 'T042 大白', 'T047 不服猫']);
const BUNDLE = new Set(['T041 CryptoWinter']);
const BURST = new Set(['T045 魔渊', 'T054 网上南宁']);
const RAT = new Set(['T045 魔渊']);

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const anchorOf = new Map(set.points.map(p => [p.tokenAddress, p.anchorTimeIso]));
const run = JSON.parse(fs.readFileSync(RUN, 'utf8'));
const runByPoint = new Map(run.results.map(r => [r.pointId, r]));

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

// ── 钱包聚合（全锚前窗）──
function walletAgg(pre) {
  const agg = new Map();
  for (const r of pre) {
    const w = wallet(r);
    if (!agg.has(w)) agg.set(w, { buy: 0, sell: 0, last: r.block_time, maxBuy: 0, firstBuy: null, firstSell: null, lastSell: null, sellN: 0 });
    const o = agg.get(w);
    if (r.trade_type === 'buy') { o.buy += r.bnb_amount; o.maxBuy = Math.max(o.maxBuy, r.bnb_amount); o.firstBuy ??= r.block_time; }
    else { o.sell += r.bnb_amount; o.firstSell ??= r.block_time; o.lastSell = r.block_time; o.sellN++; }
    o.last = r.block_time;
  }
  return agg;
}

// ── burst 波买卖结构（静默段出口后 60s 最密 5s 窗，买卖双计）──
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
    // 出口后 60s 整窗买卖
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

  // ── A. 大户在场三分（反馈 1/2/3）──
  if (WHALES.has(name)) {
    const agg = walletAgg(pre);
    const bigBuyers = new Set(pre.filter(r => r.trade_type === 'buy' && r.bnb_amount >= 0.19).map(wallet));
    console.log(`\n[大户在场]（单笔≥0.19 买过的钱包 ${bigBuyers.size} 个，锚时刻三分）：`);
    let any = false;
    for (const w of bigBuyers) {
      const o = agg.get(w); if (!o) continue; any = true;
      const net = o.buy - o.sell;
      const secSince = Math.round(aTs - ts(o.last));
      const cls = net > 0.005 ? (secSince <= 120 ? '★活跃在场' : '挂账在场(>120s)') : '已清仓';
      console.log(`  ${w.slice(0, 10)} 首买${(o.firstBuy || '').slice(11, 19)} 买${fmtN(o.buy)} 卖${fmtN(o.sell)}(${o.sellN}笔) 净${fmtN(net, 3)} max单笔${fmtN(o.maxBuy)} 末动${secSince}s前 → ${cls}`);
    }
    if (!any) console.log('  （无单笔≥0.19 买入钱包）');
    const blocks = new Map();
    for (const r of pre) if (r.trade_type === 'buy') {
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, []);
      blocks.get(r.block_number).push(r);
    }
    const bundled = [...blocks.entries()].map(([blk, rs]) => ({ blk, bnb: rs.reduce((a, r) => a + r.bnb_amount, 0), n: rs.length, w: new Set(rs.map(wallet)).size, ts2: rs[0].block_time }))
      .sort((x, y) => y.w - x.w)[0];
    if (bundled) console.log(`  同块捆绑最大块(按户数): b${bundled.blk} ${bundled.ts2.slice(11, 19)} ${fmtN(bundled.bnb)}BNB/${bundled.n}笔/${bundled.w}钱包`);
    const top5 = [...agg.entries()].map(([w, o]) => ({ w, buy: o.buy, max: o.maxBuy, sell: o.sell })).sort((x, y) => y.buy - x.buy).slice(0, 5);
    console.log(`  买入额 top5: ` + top5.map(t => `${t.w.slice(0, 8)}(买${fmtN(t.buy)}/max${fmtN(t.max)}/卖${fmtN(t.sell)})`).join(' '));
  }

  // ── B. T041 burst 期捆绑买入（反馈 4）──
  if (BUNDLE.has(name)) {
    console.log(`\n[同块捆绑买入取证]（锚=${anchor.slice(11, 19)}，逐 block 全窗）`);
    const blocks = new Map();
    for (const r of rows) {
      const t = ts(r.block_time);
      if (t > aTs + 120) continue;
      if (!blocks.has(r.block_number)) blocks.set(r.block_number, { blk: r.block_number, ts2: r.block_time, buy: 0, nb: 0, buyers: new Set(), buyRows: [], sell: 0, ns: 0 });
      const b = blocks.get(r.block_number);
      if (r.trade_type === 'buy') { b.buy += r.bnb_amount; b.nb++; b.buyers.add(wallet(r)); b.buyRows.push(r); } else { b.sell += r.bnb_amount; b.ns++; }
    }
    const arr = [...blocks.values()].sort((x, y) => x.blk - y.blk);
    for (const b of arr) {
      const flag = b.buyers.size >= 4 ? ` ⚠️${b.buyers.size}户捆绑` : '';
      const rel = ts(b.ts2) <= aTs ? '锚前' : `+${Math.round(ts(b.ts2) - aTs)}s`;
      console.log(`  ${b.ts2.slice(11, 19)} b${b.blk} 买${fmtN(b.buy)}(${b.nb}笔/${b.buyers.size}户) 卖${fmtN(b.sell)}(${b.ns}笔) ${rel}${flag}`);
    }
    const maxW = arr.reduce((m, b) => b.buyers.size > (m?.buyers.size || 0) ? b : m, null);
    if (maxW && maxW.buyers.size >= 4) {
      console.log(`  最大捆绑块 b${maxW.blk} 明细（${maxW.buyers.size} 户逐笔）：`);
      for (const r of maxW.buyRows) console.log(`    ${r.block_time.slice(11, 19)} ${wallet(r).slice(0, 10)} ${fmtN(r.bnb_amount, 4)}BNB`);
    }
    // 等额检查
    if (maxW && maxW.buyRows.length >= 2) {
      const amts = maxW.buyRows.map(r => r.bnb_amount).sort((a, b) => a - b);
      const eqBand = maxW.buyRows.filter(r => Math.abs(r.bnb_amount - amts[Math.floor(amts.length / 2)]) / amts[Math.floor(amts.length / 2)] < 0.05).length;
      console.log(`  等额带(±5%中位)命中 ${eqBand}/${maxW.buyRows.length} 笔`);
    }
    if (sig) {
      const lv = sig.metadata?.cheatCheck?.levels || {};
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const keys = o => Object.entries(o).filter(([k]) => /equal|burst|spike|bundle/i.test(k));
      console.log(`  生产 cheat levels(捆绑/burst 键): ${keys(lv).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
      console.log(`  生产 cheat anchors(捆绑/burst 键): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
  }

  // ── C. burst 波买卖结构（反馈 5）──
  if (BURST.has(name)) {
    console.log(`\n[burst 波买卖结构]（静默段 gap≥50s 出口后 60s）`);
    const segs = burstShapes2(rows, aTs);
    if (!segs.length) console.log('  （无 ≥50s 静默段）');
    for (const s of segs) {
      console.log(`  gap=${s.gapSec}s 出口=${s.exitAt.slice(11, 19)} 距锚${Math.round(aTs - s.exitTs)}s`);
      console.log(`    出口60s整窗: 买${s.win60.buy} 卖${s.win60.sell} 卖占比${s.win60.sellPct}%`);
      if (s.byBuy) console.log(`    按买最密5s窗@${s.byBuy.at}: 买${s.byBuy.buy} 卖${s.byBuy.sell} 卖占比${s.byBuy.sellPct}% ${s.byBuy.n}笔/${s.byBuy.wallets}户`);
      if (s.byTot) console.log(`    按总流量最密5s窗@${s.byTot.at}: 买${s.byTot.buy} 卖${s.byTot.sell} 卖占比${s.byTot.sellPct}% ${s.byTot.n}笔/${s.byTot.wallets}户`);
    }
    if (sig) {
      const an = sig.metadata?.cheatCheck?.anchors || {};
      const lv = sig.metadata?.cheatCheck?.levels || {};
      const keys = o => Object.entries(o).filter(([k]) => /burst|spike|sbw|stall/i.test(k));
      console.log(`  生产 cheat levels(burst键): ${keys(lv).map(([k, v]) => k + '=' + v).join(' ') || '无'}`);
      console.log(`  生产 cheat anchors(burst键): ${keys(an).map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
    const pid = 'BP-' + name.split(' ')[0];
    const rr = runByPoint.get(pid);
    const anchors = rr?.anchors || {};
    const bkeys = Object.entries(anchors).filter(([k]) => /burst/i.test(k));
    console.log(`  重析 anchors(burst): ${bkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    // 锚前 60s 买卖对照
    const near = pre.filter(r => aTs - ts(r.block_time) < 60);
    const nb = near.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const ns = near.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  锚前60s: ${near.length}笔 买${fmtN(nb)} 卖${fmtN(ns)} 卖占比${nb + ns > 0 ? ((ns / (nb + ns)) * 100).toFixed(1) : '?'}%`);
  }

  // ── D. T045 大户老鼠仓（反馈 6）──
  if (RAT.has(name)) {
    const agg = walletAgg(pre);
    console.log(`\n[大户老鼠仓取证]（单笔≥0.19 买过的钱包卖出时间线）：`);
    const bigBuyers = new Set(pre.filter(r => r.trade_type === 'buy' && r.bnb_amount >= 0.19).map(wallet));
    for (const w of bigBuyers) {
      const o = agg.get(w); if (!o) continue;
      const net = o.buy - o.sell;
      const secSince = Math.round(aTs - ts(o.last));
      console.log(`  ${w.slice(0, 10)} 首买${(o.firstBuy || '').slice(11, 19)} 首卖${(o.firstSell || '-').slice(11, 19)} 末卖${(o.lastSell || '-').slice(11, 19)} 买${fmtN(o.buy)} 卖${fmtN(o.sell)}(${o.sellN}笔) 净${fmtN(net, 3)} 末动${secSince}s前`);
    }
    if (!bigBuyers.size) console.log('  （无单笔≥0.19 买入钱包）');
    // 零买入纯卖钱包 top5（L_insider 口径）
    const pureSellers = [...agg.entries()].filter(([w, o]) => o.buy === 0 && o.sell > 0).map(([w, o]) => ({ w, sell: o.sell, n: o.sellN, first: o.firstSell, last: o.lastSell })).sort((x, y) => y.sell - x.sell).slice(0, 5);
    const totSell = pre.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    const pureSellSum = [...agg.values()].filter(o => o.buy === 0).reduce((a, o) => a + o.sell, 0);
    console.log(`  零买入纯卖钱包合计 ${fmtN(pureSellSum)}/${fmtN(totSell)} = ${totSell > 0 ? ((pureSellSum / totSell) * 100).toFixed(1) : '?'}%（L_insider 口径）`);
    for (const p of pureSellers) console.log(`    ${p.w.slice(0, 10)} 卖${fmtN(p.sell)}(${p.n}笔) ${p.first.slice(11, 19)}→${p.last.slice(11, 19)}`);
    // 生产 cheat reasons 全 dump
    if (sig) {
      const cc = sig.metadata?.cheatCheck || {};
      console.log(`  生产 cheat: grade=${cc.grade} exempt=${cc.exempt?.code} reasons=${JSON.stringify(cc.reasons)}`);
      const an = cc.anchors || {};
      const insKeys = Object.entries(an).filter(([k]) => /noBuy|insider|sellBack|famous/i.test(k));
      console.log(`  生产 anchors(insider/famous键): ${insKeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    }
  }
}
process.exit(0);
