// btv109 第四批复审反馈取证（182 跑，只读）：
// ① T056/T059/T061 「没大户」——大户在场三分（单笔≥0.19 买入钱包，锚时刻活跃在场/挂账/已清仓）
// ② T072 「burst太小」——burst 波量级取证（静默段+出口波买卖结构）
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const RUN = 'scripts/buy-point/data/bp-run-2026-11-12T23-22-53-137Z.json';

const TARGETS = {
  'T056 CT PACKS': '0x35b19bdf25074ab8ae073eb13321d8cf62867777',
  'T059 차르':      '0xd95d44b888d34d8261eb5f4613f4e19b0a197777',
  'T061 biner':     '0x1ac062679ebfc9716db31acd79099f8a5c647777',
  'T072 AI泡沫':    '0x73d2aee55732ff14c80bb4a8fdec2a4abac97777',
};
const WHALES = new Set(['T056 CT PACKS', 'T059 차르', 'T061 biner']);
const BURST = new Set(['T072 AI泡沫']);

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
    const bp = sig.metadata?.buyPoint || {};
    console.log(`生产 cheat: grade=${cc.grade} exempt=${cc.exempt?.code} act=${cc.levels?.activityLevel} sbw=${cc.levels?.stallBurstWave}`);
    console.log(`生产 BP: status=${bp.status} rule=${bp.rule ?? bp.bucket} digest.mp=${bp.digest?.market_pattern} digest.act=${bp.digest?.activity_level}`);
  }

  // ── A. 大户在场三分 ──
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
    // 重析 mp 对照
    const pid = 'BP-' + name.split(' ')[0];
    const rr = runByPoint.get(pid);
    console.log(`  重析对照: mp=${rr?.answers?.market_pattern ?? rr?.digest?.market_pattern}(${rr?.mpProb}) act=${rr?.answers?.activity_level ?? rr?.digest?.activity_level}(${rr?.actProb})`);
  }

  // ── B. burst 波量级 ──
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
    const bkeys = Object.entries(anchors).filter(([k]) => /burst|act/i.test(k));
    console.log(`  重析 anchors(burst/act): ${bkeys.map(([k, v]) => k + '=' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' ') || '无'}`);
    const near = pre.filter(r => aTs - ts(r.block_time) < 60);
    const nb = near.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
    const ns = near.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
    console.log(`  锚前60s: ${near.length}笔 买${fmtN(nb)} 卖${fmtN(ns)} 卖占比${nb + ns > 0 ? ((ns / (nb + ns)) * 100).toFixed(1) : '?'}%`);
    // 全窗最密 5s 窗（供波量对照）
    let best = { key: 0 };
    for (let s0 = ts(rows[0].block_time); s0 < aTs; s0 += 1) {
      const w = pre.filter(r => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5);
      if (!w.length) continue;
      const b = w.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
      if (b > best.key) best = { key: b, at: new Date(s0 * 1000).toISOString().slice(11, 19), b, n: w.length, wallets: new Set(w.map(wallet)).size };
    }
    if (best.at) console.log(`  全窗买最密5s窗: @${best.at} 买${fmtN(best.b)} ${best.n}笔/${best.wallets}户`);
  }
}
process.exit(0);
