#!/usr/bin/env node
// tmp：豁免前提候选锚——「组织买入占比」（用户补充 2026-11-02：著名/绑定钱包豁免
// 还是要有一个前提，「它们砸跑了是砸跑了，但是盘面正常用户流量涌入依然要比较明显，
// 否则如果整个盘面全部是它们的砸盘，盘子也死了」）。两形状（买侧承接视角：
// 组织方撤退后盘面剩下的正常生态要用流量构成度量）：
//   bundleBuyPct      = sb∪eq 簇成员买入合计 ÷ Σ买 ×100（G 通道簇残余豁免前提）
//   famousGroupBuyPct = famous∪跟单 买入合计 ÷ Σ买 ×100（D 通道跟单集中度豁免前提）
// 全 128 票锚窗分布（零 Jev，182 跑）；同时输出 G/D 豁免形状（代码锚完整部分）
// 供定线。
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const {
  buildSnapshotFromRows, computeDerived, loadFamousRoster,
  SAME_BLOCK_CLUSTER_MIN, EQUAL_AMOUNT_MIN_BNB, EQUAL_BAND_PCT, FAMOUS_FOLLOW_WINDOW_SEC,
} = require_('../../src/market-analysis/cheat-snapshot.js');

function sb() {
  const { dbManager } = require_('../../src/services/dbManager.js');
  return dbManager.getClient();
}
const TICK_COLS = 'block_number,log_index,trade_type,bnb_amount,trader_address,sender_address,token_amount,price_bnb,price_outlier,block_time,tx_hash';
async function pullTicksToAnchor(token, n) {
  const { data, error } = await sb().from('wss_price_ticks').select(TICK_COLS)
    .eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(n);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length < n) throw new Error(`锚截窗不足：锚=${n} 实际=${rows.length}`);
  return rows;
}

function orgBuyAnchors(snapshot, roster) {
  const ticks = snapshot.ticks || [];
  const wallets = snapshot.wallets || [];
  let totalBuy = 0;
  for (const t of ticks) if (t.side === 'BUY') totalBuy += t.bnb || 0;
  if (totalBuy <= 0) return { bundleBuyPct: null, famousGroupBuyPct: null };
  // sb members（≥SAME_BLOCK_CLUSTER_MIN 笔买同块，与 D3.1 同口径）
  const blockBuys = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || t.block === null) continue;
    if (!blockBuys.has(t.block)) blockBuys.set(t.block, []);
    blockBuys.get(t.block).push(t);
  }
  const sbMembers = new Set();
  for (const [, arr] of blockBuys) {
    if (arr.length >= SAME_BLOCK_CLUSTER_MIN) for (const t of arr) if (t.wallet) sbMembers.add(t.wallet);
  }
  // eq members（±2% 对数带 ≥3 不同钱包，与 D3.1 同口径）
  const bandBase = Math.log(1 + EQUAL_BAND_PCT);
  const bands = new Map();
  for (const t of ticks) {
    if (t.side !== 'BUY' || !t.wallet) continue;
    const bnb = t.bnb || 0;
    if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
    const k = Math.round(Math.log(bnb) / bandBase);
    if (!bands.has(k)) bands.set(k, new Set());
    bands.get(k).add(t.wallet);
  }
  const eqMembers = new Set();
  for (const ws of bands.values()) if (ws.size >= SAME_BLOCK_CLUSTER_MIN) for (const w of ws) eqMembers.add(w);
  const buyOf = new Map(wallets.map((e) => [e.w, e.buyBnb || 0]));
  const sumBuy = (set) => { let s = 0; for (const w of set) s += buyOf.get(w) || 0; return s; };
  const both = new Set([...sbMembers, ...eqMembers]);
  const bundleBuyPct = both.size ? +((sumBuy(both) / totalBuy) * 100).toFixed(1) : null;
  // famous group（famous∪跟单，与 D3.2b/G5 同口径）
  let famousGroupBuyPct = null;
  if (roster && roster.size > 0) {
    const famousInWin = wallets.filter((e) => roster.has(e.w.toLowerCase()));
    if (famousInWin.length > 0) {
      const famousBuyDts = ticks
        .filter((t) => t.side === 'BUY' && t.dt !== null && t.wallet && roster.has(t.wallet.toLowerCase()))
        .map((t) => t.dt);
      const group = new Set(famousInWin.map((e) => e.w));
      for (const e of wallets) {
        if (roster.has(e.w.toLowerCase())) continue;
        if (e.firstBuyDt === null || e.firstBuyDt === undefined) continue;
        for (const fd of famousBuyDts) {
          if (e.firstBuyDt >= fd && e.firstBuyDt - fd <= FAMOUS_FOLLOW_WINDOW_SEC) { group.add(e.w); break; }
        }
      }
      famousGroupBuyPct = +((sumBuy(group) / totalBuy) * 100).toFixed(1);
    }
  }
  return { bundleBuyPct, famousGroupBuyPct };
}

const only = process.argv[2] || '';
const fxDoc = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const { loadAndValidateFixtures } = await import('./lib.mjs');
const { cases, errors } = loadAndValidateFixtures(fxDoc);
if (errors.length) { console.error(errors.join('\n')); process.exit(2); }
const targets = only ? cases.filter((c) => only.split(',').includes(c.caseId)) : cases;
const roster = loadFamousRoster();

const out = [];
for (const c of targets) {
  const rows = await pullTicksToAnchor(c.addr.toLowerCase(), c.anchor.tickCount);
  const snapshot = buildSnapshotFromRows(rows, {});
  const d = computeDerived(snapshot);
  const o = orgBuyAnchors(snapshot, roster);
  // 豁免形状（代码锚部分）：G=sbHold<20∧(eqHold<50∨null)；D=dom high∧top3<45
  const gShape = d.sameBlockHoldPct !== null && d.sameBlockHoldPct < 20
    && (d.equalBandHoldPct === null || d.equalBandHoldPct < 50);
  const dShape = d.famousDominanceLevel === 'high' && d.famousFollowerTop3Pct !== null && d.famousFollowerTop3Pct < 45;
  const expectV = c.expect && typeof c.expect === 'object' ? c.expect.verdict : c.expect;
  out.push({
    id: c.caseId, expect: expectV,
    sbHold: d.sameBlockHoldPct, eqHold: d.equalBandHoldPct,
    dom: d.famousDominanceLevel, top3: d.famousFollowerTop3Pct,
    ...o, gShape, dShape,
  });
}
console.log('\ncaseId expect  sbHold eqHold  dom  top3  bundleBuy% famousBuy%  gShape dShape');
for (const o of out) {
  const f = (v) => (v === null || v === undefined ? '    —' : String(v).padStart(5));
  console.log(o.id.padEnd(6), o.expect.padEnd(9), f(o.sbHold), f(o.eqHold),
    ' ', String(o.dom ?? '—').padEnd(4), f(o.top3), f(o.bundleBuyPct), f(o.famousGroupBuyPct),
    '   ', o.gShape ? 'G' : '.', o.dShape ? 'D' : '.');
}
// 分布：豁免形状票的前提锚取值 + 人工对照
const gs = out.filter((o) => o.gShape);
const ds = out.filter((o) => o.dShape);
console.log(`\nG 豁免形状（sbHold<20∧eqHold<50∨null，bd=high 未含=超集）${gs.length} 票：`);
for (const th of [40, 60, 80, 90]) {
  console.log(`  bundleBuy≥${th}%: ${gs.filter((o) => (o.bundleBuyPct ?? 0) >= th).map((o) => o.id + ':' + o.bundleBuyPct).join(' ') || '无'}`);
}
console.log(`D 豁免形状（dom=high∧top3<45）${ds.length} 票：`);
for (const th of [40, 60, 80, 90]) {
  console.log(`  famousBuy≥${th}%: ${ds.filter((o) => (o.famousGroupBuyPct ?? 0) >= th).map((o) => o.id + ':' + o.famousGroupBuyPct + (o.expect === 'cheat' ? '*' : '')).join(' ') || '无'}`);
}
console.log('\n全 128 票 bundleBuyPct 分布（升序前 30）：');
console.log(out.filter((o) => o.bundleBuyPct !== null).sort((a, b) => a.bundleBuyPct - b.bundleBuyPct).slice(0, 30)
  .map((o) => `${o.id}:${o.bundleBuyPct}`).join(' '));
