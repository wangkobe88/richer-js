// 第一轮修复取证（bt-v104）：A=②PVP 3票「大户在场」假设 B=⑨3票时间线/同block完整性 C=闪崩6票swing锚
// 182 跑：node scripts/buy-point/tmp-r1-forensic.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { AGGREGATOR_ROUTER_ADDRS } = require_('../../src/trading-engine/pre-check/aggregator-routers.js');
const sb = dbManager.getClient();

const EXP = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const GROUPS = {
  A_pvp: [
    ['29', '0xdc1910375c1c1c3d0c25c13ee6e5f2bec1887777'],
    ['蝴蝶', '0xac0b530995e47794dd0b722497aa33873b8c7777'],
    ['我靠', '0xcbfe6b2bceacfab7934c82513f568f4e31a04444'],
  ],
  B_nine: [
    ['SAMSUNG', '0x54117eb6d2481dc8d89ee377e00e683f882f7777'],
    ['GNusmas', '0x1c6be124ffe79abe2fd32adba76dd4f3d5567777'],
    ['LABU', '0x1ac4a310874e29290720d2fb55300a91a23e7777'],
  ],
  C_crash: [
    ['屎壳郎自拉', '0x2ef6c0e630d34b78ad36aabe04cd90f57e3c7777'],
    ['赵公主', '0x258e485725b8d799b885b9f079241e2c812d7777'],
    ['币安之心', '0x08aa150d7d86c4a0dfa37f310c1380de9c1877777'],
    ['蝴蝶人生路', '0xb359716d1affde1fb9d351fec71a0f2e79257777'],
    ['苹果SI', '0xc9bf4530033f6497002d228296fedb45036f7777'],
    ['持械入宋', '0xea3ce510829b2b3c77dae374aad440e23be94444'],
  ],
};
const ROUTERS = new Set([...AGGREGATOR_ROUTER_ADDRS, '0x1de460bb244aa755be1c3a545d290802cf6f77f4'].map((a) => String(a).toLowerCase()));
const allToks = Object.values(GROUPS).flat().map((pair) => pair[1]);

// ── 1) 每 token 首个 BUY 信号（锚）──
const sigAnchor = new Map(); // token -> {created_at, md}
{
  const { data, error } = await sb.from('strategy_signals')
    .select('id,token_address,created_at,metadata')
    .eq('experiment_id', EXP).in('token_address', allToks).eq('action', 'buy')
    .order('created_at', { ascending: true });
  if (error) throw new Error('signals: ' + error.message);
  for (const r of data || []) {
    const k = String(r.token_address).toLowerCase();
    if (!sigAnchor.has(k)) sigAnchor.set(k, { created_at: r.created_at, md: r.metadata || {} });
  }
  console.log(`anchors: ${sigAnchor.size}/${allToks.length}`);
}

// ── 2) 锚窗行集（生产 _pullTicksDb 同款 tail 形状）──
async function pullAnchorWindow(token, anchorIso) {
  let q = sb.from('wss_price_ticks')
    .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address')
    .eq('token_address', token);
  if (anchorIso) q = q.lte('block_time', anchorIso);
  const { data, error } = await q.order('block_number', { ascending: false })
    .order('log_index', { ascending: false }).limit(2000);
  if (error) throw new Error('ticks: ' + error.message);
  return (data || []).slice().reverse(); // 链上真序 asc
}
const walletOf = (r) => {
  const w = (r.sender_address || r.trader_address || '').toLowerCase();
  return ROUTERS.has(w) ? null : (w || null);
};

const fmtB = (v) => (v == null ? '-' : Number(v).toFixed(4));

for (const [gname, list] of Object.entries(GROUPS)) {
  console.log(`\n================ ${gname} ================`);
  for (const [sym, tok] of list) {
    const a = sigAnchor.get(tok);
    if (!a) { console.log(`\n### ${sym} ${tok.slice(0, 8)} — 无 BUY 信号行！`); continue; }
    const md = a.md;
    const bp = md.buyPoint || {};
    const dims = bp.dimensions || {};
    const anc = bp.anchors || {};
    const es = dims.entry_shape || null;
    const mp = dims.market_pattern || null;
    console.log(`\n### ${sym} ${tok.slice(0, 8)} 锚=${a.created_at.slice(11, 19)} es=${JSON.stringify(es)} mp=${JSON.stringify(mp)} rule=${bp.assessment?.rule || '-'} prob=${bp.assessment?.prob ?? '-'}`);

    if (gname === 'C_crash') {
      // C：swing 8 键 + 趋势打断对照
      const keys = ['tokenAgeSec','curVsLaunchPct','curVsAthPct','chg5Pct','chg10Pct','chg30Pct','maxDn5Pct','nearMaxDn5Pct','swingHighCount','swingLowCount','swingLastDir','secSinceSwingHigh','secSinceSwingLow','currentVsSwingHighPct','currentVsSwingLowPct','swingMaxAmplPct','anchorTickCount'];
      console.log('   ' + keys.map((k) => k + '=' + (anc[k] ?? '-')).join(' '));
      continue;
    }

    // A/B：锚窗行集聚合
    const rows = await pullAnchorWindow(tok, a.created_at);
    const tAnchor = new Date(a.created_at).getTime();
    const buys = rows.filter((r) => String(r.trade_type).toLowerCase() === 'buy');
    const sells = rows.filter((r) => String(r.trade_type).toLowerCase() === 'sell');
    console.log(`   行集=${rows.length}（buy ${buys.length}/${fmtB(buys.reduce((s, r) => s + (r.bnb_amount || 0), 0))}B sell ${sells.length}/${fmtB(sells.reduce((s, r) => s + (r.bnb_amount || 0), 0))}B）  anchors.anchorTickCount=${anc.anchorTickCount ?? '-'} tradeCount=${anc.tradeCount ?? '-'}`);

    // 钱包聚合（全锚窗）
    const wm = new Map();
    for (const r of rows) {
      const w = walletOf(r);
      if (!w) continue;
      const side = String(r.trade_type).toLowerCase();
      let e = wm.get(w);
      if (!e) { e = { w, buyBnb: 0, buyN: 0, sellBnb: 0, sellN: 0, maxBuy: 0, lastTs: 0, lastSide: '' }; wm.set(w, e); }
      const ts = new Date(r.block_time).getTime();
      if (side === 'buy') { e.buyBnb += r.bnb_amount || 0; e.buyN++; e.maxBuy = Math.max(e.maxBuy, r.bnb_amount || 0); }
      else { e.sellBnb += r.bnb_amount || 0; e.sellN++; }
      if (ts > e.lastTs) { e.lastTs = ts; e.lastSide = side; }
    }

    if (gname === 'A_pvp') {
      // 大户在场表：单笔 ≥0.19（BP55 口径）；在场=净>0.005 或末动距锚 ≤120s
      const bigs = [...wm.values()].filter((e) => e.maxBuy >= 0.19).sort((x, y) => y.maxBuy - x.maxBuy);
      console.log(`   单笔≥0.19 钱包数=${bigs.length}（BP55 判序线=≥2 个且在场 / 或单笔 0.3+ 且在场）`);
      for (const e of bigs.slice(0, 8)) {
        const net = e.buyBnb - e.sellBnb;
        const secBefore = Math.round((tAnchor - e.lastTs) / 1000);
        const onSite = (net > 0.005 ? '在场(净>0)' : '') + (secBefore <= 120 ? (net > 0.005 ? '+' : '') + '末动≤120s' : '');
        console.log(`     ${e.w.slice(0, 10)} max=${fmtB(e.maxBuy)} buy=${fmtB(e.buyBnb)}×${e.buyN} sell=${fmtB(e.sellBnb)}×${e.sellN} 净=${fmtB(net)} 末动=${e.lastSide}@锚前${secBefore}s ${onSite || '已离场'}`);
      }
      // 对照：近 120s 买在场（②(a) 量维度前置=单笔 0.3+/同块捆绑 0.3+）
      const nearBig = rows.filter((r) => tAnchor - new Date(r.block_time).getTime() <= 120000
        && String(r.trade_type).toLowerCase() === 'buy' && (r.bnb_amount || 0) >= 0.3 && walletOf(r));
      if (nearBig.length) console.log(`   近120s 单笔≥0.3 买入：${nearBig.length} 笔（${nearBig.map((r) => fmtB(r.bnb_amount)).join(',')}）`);
    }

    if (gname === 'B_nine') {
      // 10s 桶买卖时间线
      const t0 = rows.length ? new Date(rows[0].block_time).getTime() : tAnchor;
      const span = Math.max(1, Math.round((tAnchor - t0) / 1000));
      const nB = Math.min(24, Math.ceil(span / 10));
      const bsz = span / nB;
      const buckets = Array.from({ length: nB }, () => ({ bn: 0, bb: 0, sn: 0, sb: 0 }));
      for (const r of rows) {
        const i = Math.min(nB - 1, Math.floor((new Date(r.block_time).getTime() - t0) / bsz));
        const side = String(r.trade_type).toLowerCase();
        if (side === 'buy') { buckets[i].bn++; buckets[i].bb += r.bnb_amount || 0; }
        else { buckets[i].sn++; buckets[i].sb += r.bnb_amount || 0; }
      }
      console.log('   时间线(10s级桶)：');
      for (let i = 0; i < nB; i++) {
        const b = buckets[i];
        const sec = Math.round(i * bsz);
        console.log(`     +${String(sec).padStart(4)}s  B ${String(b.bn).padStart(3)}笔/${fmtB(b.bb).padStart(7)}  S ${String(b.sn).padStart(3)}笔/${fmtB(b.sb).padStart(7)}`);
      }
      // 分界启发式：max min(前缀买占比, 后缀卖占比)
      let best = null;
      for (let k = 1; k < nB; k++) {
        let pb = 0, pbB = 0, sb = 0, sbB = 0;
        for (let i = 0; i < k; i++) { pb += buckets[i].bn; pbB += buckets[i].bb; }
        for (let i = k; i < nB; i++) { sb += buckets[i].sn; sbB += buckets[i].sb; }
        const tb = pb + buckets.slice(k).reduce((s, b) => s + b.bn, 0);
        const ts = sb + buckets.slice(0, k).reduce((s, b) => s + b.sn, 0);
        if (!tb || !ts) continue;
        const buyShare = pb / tb, sellShare = sb / ts;
        const m = Math.min(buyShare, sellShare);
        if (!best || m > best.m) best = { k, m, buyShare, sellShare };
      }
      if (best) console.log(`   分界候选 @+${Math.round(best.k * bsz)}s：前段买占比 ${(best.buyShare * 100).toFixed(0)}% / 后段卖占比 ${(best.sellShare * 100).toFixed(0)}%`);
      // 同 block 完整性
      const blk = new Map();
      for (const r of rows) {
        const kk = r.block_number;
        let e = blk.get(kk);
        if (!e) { e = { n: 0, b: 0, s: 0 }; blk.set(kk, e); }
        e.n++;
        const side = String(r.trade_type).toLowerCase();
        if (side === 'buy') e.b++; else e.s++;
      }
      const multi = [...blk.entries()].filter(([, e]) => e.n > 1);
      const maxBlk = multi.sort((x, y) => y[1].n - x[1].n)[0];
      console.log(`   区块数=${blk.size} 多笔块=${multi.length} 最大同块=${maxBlk ? `blk${maxBlk[0]} ${maxBlk[1].n}笔(B${maxBlk[1].b}/S${maxBlk[1].s})` : '-'}`);
    }
  }
}
process.exit(0);
