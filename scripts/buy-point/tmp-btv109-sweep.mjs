// btv109 六批收官全量调研 sweep（182 跑，只读）：109 票 ticks 全扫
// ① roster 26 址命中面（0xa83b73f5 连环计数）② 单 block ≥8 户买/卖 ③ 相邻两块纯砸 ≥6户&≥0.5
// ④ 零买入纯卖占比 ≥25%（L_insider 口径泛化） ⑤ sbw=1 票全窗锚 vs 出口波 ⑥ 先买后卖轮转粗扫
import { dbManager } from '../../src/services/dbManager.js';
import fs from 'node:fs';

const EXP = '029bd863-55e5-4319-91d5-10803a6a9a82';
const TICKS = 'scripts/buy-point/sets/btv109-trades-ticks';
const SET = 'scripts/buy-point/sets/btv109-trades.json';
const ROSTER = 'config/rosters/famous-copy-wallets.json';

const set = JSON.parse(fs.readFileSync(SET, 'utf8'));
const rosterRaw = JSON.parse(fs.readFileSync(ROSTER, 'utf8')).wallets.map(w => w.toLowerCase());
const roster = new Set(rosterRaw);

const c = await dbManager.getClient();
const sigs = []; let from = 0;
while (true) {
  const { data, error } = await c.from('strategy_signals')
    .select('id,token_address,action,executed,reason,metadata,created_at')
    .eq('experiment_id', EXP).order('id', { ascending: true }).range(from, from + 999);
  if (error) throw new Error(error.message);
  sigs.push(...data); if (data.length < 1000) break; from += 1000;
}
const buySig = new Map();
for (const s of sigs) {
  if (s.action !== 'buy') continue;
  if (!buySig.has(s.token_address) || s.executed) buySig.set(s.token_address, s);
}

const wallet = (r) => (r.sender_address || r.trader_address || '').toLowerCase();
const ts = (iso) => Date.parse(iso) / 1000;
const fmtN = (v, d = 2) => (v == null ? '?' : Number(v).toFixed(d));

// 累计器
const rosterHits = new Map(); // addr -> [{pid, symbol, buy, sell, net, buyPct, pnl}]
const blk8 = [];        // 单 block ≥8 户（买或卖，锚前全窗+锚后60s）
const blkDump = [];     // 相邻两块纯砸 ≥6户 & ≥0.5
const noBuySell = [];   // 零买入纯卖占比 ≥25%
const sbwGap = [];      // sbw=1 票 全窗锚 vs 出口 5s 波
const flip = [];        // 先买后卖轮转（锚前 10s ≥3笔买拉起 & 锚后 5s 内 ≥2 笔卖）

let n = 0;
for (const p of set.points) {
  n++;
  const pid = p.pointId ?? p.id ?? '?'; const sym = p.tokenSymbol ?? p.symbol ?? '-'; const addr = p.tokenAddress;
  let rows;
  try { rows = JSON.parse(fs.readFileSync(`${TICKS}/${addr}.json`, 'utf8')).rows; } catch { continue; }
  const anchor = p.anchorTimeIso || rows[rows.length - 1].block_time;
  const aTs = ts(anchor);
  const pre = rows.filter(r => ts(r.block_time) <= aTs);
  const post60 = rows.filter(r => ts(r.block_time) > aTs && ts(r.block_time) <= aTs + 60);
  const pnl = p.trade?.episode?.pnlBnb ?? null;
  const sig = buySig.get(addr);
  const cc = sig?.metadata?.cheatCheck || {};
  const ex = cc.exempt?.code || '原生';
  const act = cc.levels?.activityLevel || '?';
  const sbw = cc.levels?.stallBurstWave;

  // ① roster 命中
  const agg = new Map();
  for (const r of pre) {
    const w = wallet(r);
    if (!agg.has(w)) agg.set(w, { buy: 0, sell: 0 });
    if (r.trade_type === 'buy') agg.get(w).buy += r.bnb_amount; else agg.get(w).sell += r.bnb_amount;
  }
  const totalBuy = pre.filter(r => r.trade_type === 'buy').reduce((a, r) => a + r.bnb_amount, 0);
  for (const [w, o] of agg) {
    if (!roster.has(w)) continue;
    if (!rosterHits.has(w)) rosterHits.set(w, []);
    rosterHits.get(w).push({ pid, sym, buy: o.buy, sell: o.sell, net: o.buy - o.sell, buyPct: totalBuy > 0 ? o.buy / totalBuy * 100 : 0, pnl, ex });
  }

  // ②③ block 统计（锚前+锚后60s）
  const blocks = new Map();
  for (const r of [...pre, ...post60]) {
    if (!blocks.has(r.block_number)) blocks.set(r.block_number, { blk: r.block_number, ts2: r.block_time, buy: 0, nb: 0, buyers: new Set(), sell: 0, ns: 0, sellers: new Set() });
    const b = blocks.get(r.block_number);
    if (r.trade_type === 'buy') { b.buy += r.bnb_amount; b.nb++; b.buyers.add(wallet(r)); } else { b.sell += r.bnb_amount; b.ns++; b.sellers.add(wallet(r)); }
  }
  const bl = [...blocks.values()].sort((x, y) => x.blk - y.blk);
  for (const b of bl) {
    if (b.buyers.size >= 8) blk8.push({ pid, sym, side: '买' + b.buyers.size + '户', bnb: b.buy, at: b.ts2.slice(11, 19), rel: ts(b.ts2) <= aTs ? '锚前' : '锚后', pnl, ex });
    if (b.sellers.size >= 8) blk8.push({ pid, sym, side: '卖' + b.sellers.size + '户', bnb: b.sell, at: b.ts2.slice(11, 19), rel: ts(b.ts2) <= aTs ? '锚前' : '锚后', pnl, ex });
  }
  for (let i = 1; i < bl.length; i++) {
    const a = bl[i - 1], b = bl[i];
    if (b.blk - a.blk > 1) continue;
    const sellers = new Set([...a.sellers, ...b.sellers]);
    const totS = a.sell + b.sell, totB = a.buy + b.buy;
    if (sellers.size >= 6 && totS >= 0.5 && totS >= totB * 3) {
      // 块内跌幅
      const relRows = rows.filter(r => r.price_bnb > 0);
      const before = relRows.filter(r => ts(r.block_time) < ts(a.ts2)).slice(-1)[0];
      const after = relRows.filter(r => ts(r.block_time) >= ts(a.ts2) && ts(r.block_time) <= ts(b.ts2)).map(r => r.price_bnb);
      const minP = after.length ? Math.min(...after) : null;
      const drop = before && minP ? (minP / before.price_bnb - 1) * 100 : null;
      blkDump.push({ pid, sym, sellers: sellers.size, bnb: totS, drop, at: a.ts2.slice(11, 19), rel: ts(a.ts2) <= aTs ? '锚前' : '锚后', pnl, ex });
    }
  }

  // ④ 零买入纯卖占比
  const totalSell = pre.filter(r => r.trade_type === 'sell').reduce((a, r) => a + r.bnb_amount, 0);
  let nbS = 0;
  for (const [, o] of agg) if (o.buy <= 0.0001 && o.sell > 0.01) nbS += o.sell;
  const nbPct = totalSell > 0 ? nbS / totalSell * 100 : 0;
  if (nbPct >= 25) noBuySell.push({ pid, sym, nbPct, totalSell, pnl, ex, lins: (cc.reasons || []).some(x => (x.code || '').includes('L_insider')), orig: cc.exempt?.originalGrade || cc.grade });

  // ⑤ sbw 票全窗锚 vs 出口波
  if (sbw === 1) {
    const anchorBurst = cc.anchors?.burstWaveBuyBnb ?? null;
    // 找最后一个 ≥50s 静默段出口后的 5s 最密买窗
    const segs = [];
    for (let i = 1; i < pre.length; i++) {
      if (ts(pre[i].block_time) - ts(pre[i - 1].block_time) >= 50) segs.push(ts(pre[i].block_time));
    }
    let exitWave = null;
    if (segs.length) {
      const ex0 = segs[segs.length - 1];
      let best = 0;
      for (let s0 = ex0; s0 < Math.min(ex0 + 55, aTs + 5); s0 += 1) {
        const w = pre.filter(r => ts(r.block_time) >= s0 && ts(r.block_time) < s0 + 5 && r.trade_type === 'buy');
        const b = w.reduce((a, r) => a + r.bnb_amount, 0);
        if (b > best) best = b;
      }
      exitWave = best;
    }
    sbwGap.push({ pid, sym, anchorBurst, exitWave, ratio: anchorBurst && exitWave != null && exitWave > 0 ? +(exitWave / anchorBurst).toFixed(2) : null, pnl, ex, gapSec: cc.anchors?.burstMaxGapSec });
  }

  // ⑥ 先买后卖轮转：锚前 10s ≥3 笔买 & 合计 ≥0.3；锚后 5s 内 ≥2 笔卖
  const pre10 = pre.filter(r => aTs - ts(r.block_time) < 10);
  const pre10b = pre10.filter(r => r.trade_type === 'buy');
  const post5s = post60.filter(r => ts(r.block_time) <= aTs + 5 && r.trade_type === 'sell');
  if (pre10b.length >= 3 && pre10b.reduce((a, r) => a + r.bnb_amount, 0) >= 0.3 && post5s.length >= 2) {
    flip.push({ pid, sym, preBuy: pre10b.reduce((a, r) => a + r.bnb_amount, 0), preN: pre10b.length, postSell: post5s.reduce((a, r) => a + r.bnb_amount, 0), postN: post5s.length, pnl, ex, act });
  }
}

console.log(`扫描 ${n} 票完成\n`);

console.log('═① roster v3 26 址 109 票命中面═');
for (const [w, list] of [...rosterHits.entries()].sort((x, y) => y[1].length - x[1].length)) {
  const totPnl = list.reduce((a, x) => a + (x.pnl || 0), 0);
  console.log(`  ${w} ${list.length}票 pnl合计${fmtN(totPnl)}`);
  for (const x of list) console.log(`    ${x.pid.slice(3)} ${String(x.sym).slice(0, 10)} 买${fmtN(x.buy)} 卖${fmtN(x.sell)} 净${fmtN(x.net, 3)} 占买${fmtN(x.buyPct, 1)}% pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} ${x.ex}`);
}

console.log('\n═② 单 block ≥8 户（买/卖）═');
for (const x of blk8) console.log(`  ${x.pid.slice(3)} ${String(x.sym).slice(0, 10)} ${x.side} ${fmtN(x.bnb)}BNB @${x.at} ${x.rel} pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} ${x.ex}`);
if (!blk8.length) console.log('  （无）');

console.log('\n═③ 相邻两块纯砸 ≥6户 且 ≥0.5BNB（卖≥买3倍）═');
for (const x of blkDump) console.log(`  ${x.pid.slice(3)} ${String(x.sym).slice(0, 10)} ${x.sellers}户 ${fmtN(x.bnb)}BNB drop=${x.drop == null ? '?' : x.drop.toFixed(1)}% @${x.at} ${x.rel} pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} ${x.ex}`);
if (!blkDump.length) console.log('  （无）');

console.log('\n═④ 零买入纯卖占比 ≥25%═（L_insider 口径泛化）');
for (const x of noBuySell.sort((a, b) => b.nbPct - a.nbPct)) console.log(`  ${x.pid.slice(3)} ${String(x.sym).slice(0, 10)} 纯卖占${fmtN(x.nbPct, 1)}%（总卖${fmtN(x.totalSell)}）pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} 生产L_insider=${x.lins ? '是' : '否'} orig=${x.orig} ${x.ex}`);
console.log(`  小计: ${noBuySell.length}票 pnl合计${fmtN(noBuySell.reduce((a, x) => a + (x.pnl || 0), 0))}`);

console.log('\n═⑤ sbw=1 票：生产全窗锚 vs 出口 5s 真实波═');
for (const x of sbwGap) console.log(`  ${x.pid.slice(3)} ${String(x.sym).slice(0, 10)} 全窗锚${x.anchorBurst} 出口波${fmtN(x.exitWave, 3)} 比值=${x.ratio ?? '出口0'} gap=${x.gapSec}s pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} ${x.ex}`);

console.log('\n═⑥ 先买后卖轮转（锚前10s ≥3笔买≥0.3 & 锚后5s ≥2笔卖）═');
for (const x of flip) console.log(`  ${x.pid.slice(3)} ${String(x.sym).slice(0, 10)} 锚前买${fmtN(x.preBuy)}(${x.preN}笔) 锚后5s卖${fmtN(x.postSell)}(${x.postN}笔) pnl=${x.pnl == null ? '?' : x.pnl.toFixed(4)} ${x.ex} act=${x.act}`);
console.log(`  小计: ${flip.length}票 pnl合计${fmtN(flip.reduce((a, x) => a + (x.pnl || 0), 0))}`);
process.exit(0);
