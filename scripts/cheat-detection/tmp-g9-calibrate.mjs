#!/usr/bin/env node
/**
 * 一次性校准探针（G9 候选判别锚分离度，不进 git、零 Jev 纯 DB 重放）。
 * 问题：eq strong→A 通道拉黑在「前端整档散户盘」上假阳性（MAI/四票）。候选判别锚：
 *   eqCov       = eqMembers（合格 ±2% 带钱包并集）/ 全场钱包数 ×100 —— 簇=市场本身？
 *   bandRouter% = 合格带内买入笔中经 GMGN 聚合路由（trader 层）占比 —— 前端快捷档流量？
 *   eqMemRouter% = eqMembers 中至少一笔经路由买入的钱包占比
 * 对 128 fixture（人工期望）+ 5 现场票（首个 cheat 锚窗重放，另打 +120s 复检窗看锚稀释）。
 * 与 run.mjs 同组装路径：buildSnapshotFromRows 官方锚 + snapshot.ticks 内部形状自算候选。
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const PULL_LIMIT = 3000;
const EQUAL_AMOUNT_MIN_BNB = 0.001;
const BAND_BASE = Math.log(1.02);
const sb = dbManager.getClient();
const tickets = JSON.parse(readFileSync(resolve(HERE, 'data/tmp-g9-tickets.json'), 'utf8'));

async function pullFull(token) {
  const { data, error } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .limit(PULL_LIMIT + 1);
  if (error) throw new Error(error.message);
  return (data ?? []).slice(0, PULL_LIMIT);
}

async function loadMeta(token) {
  const { data } = await sb.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', token)
    .order('id', { ascending: true }).limit(5);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return {
    address: token, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
  };
}

/** 候选判别锚（band 逻辑与 cheat-snapshot 逐字同款） */
function candidates(snapshot) {
  const ticks = snapshot.ticks || [];
  const bands = new Map(); // k -> Map(wallet -> rowCount, routerCount)
  for (const t of ticks) {
    if (t.side !== 'BUY' || !t.wallet) continue;
    const bnb = t.bnb || 0;
    if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
    const k = Math.round(Math.log(bnb) / BAND_BASE);
    if (!bands.has(k)) bands.set(k, { wallets: new Map(), rows: 0, routerRows: 0 });
    const b = bands.get(k);
    b.rows++;
    if (t.viaRouter) b.routerRows++;
    const we = b.wallets.get(t.wallet) || { router: 0 };
    if (t.viaRouter) we.router++;
    b.wallets.set(t.wallet, we);
  }
  const eqMembers = new Set();
  let bandRows = 0, bandRouterRows = 0, topBand = null;
  for (const [k, b] of bands) {
    if (b.wallets.size < 3) continue;
    for (const w of b.wallets.keys()) eqMembers.add(w);
    bandRows += b.rows; bandRouterRows += b.routerRows;
    if (!topBand || b.rows > topBand.rows) topBand = { center: Math.exp(k * BAND_BASE), wallets: b.wallets.size, rows: b.rows, routerRows: b.routerRows };
  }
  let eqMemRouter = 0;
  const memRouter = new Set();
  for (const t of ticks) {
    if (t.side !== 'BUY' || !t.viaRouter || !t.wallet) continue;
    const bnb = t.bnb || 0;
    if (bnb < EQUAL_AMOUNT_MIN_BNB) continue;
    memRouter.add(t.wallet);
  }
  for (const w of eqMembers) if (memRouter.has(w)) eqMemRouter++;
  return {
    eqCov: snapshot.derived.walletCount ? +( (eqMembers.size / snapshot.derived.walletCount) * 100).toFixed(1) : null,
    bandRouterPct: bandRows ? +((bandRouterRows / bandRows) * 100).toFixed(1) : null,
    eqMemRouterPct: eqMembers.size ? +((eqMemRouter / eqMembers.size) * 100).toFixed(1) : null,
    topBand,
  };
}

const fmt = (v, suf = '') => (v === null || v === undefined) ? '—' : (typeof v === 'number' ? v.toFixed(1) : v) + suf;

const out = [];
console.log(['id'.padEnd(10), 'symbol'.padEnd(11), 'expect'.padEnd(10), '锚'.padEnd(5), '钱包'.padEnd(5), 'sbHold'.padEnd(7), 'eqHold'.padEnd(7), 'wash'.padEnd(5), 'eqCov%'.padEnd(7), '带路由%'.padEnd(7), '簇路由%'.padEnd(7), '顶带形状'].join(''));
for (const t of tickets) {
  try {
    const rows = await pullFull(t.addr);
    let window, recheckInfo = '';
    if (t.anchorN) {
      if (rows.length < t.anchorN) { console.log(`${t.caseId.padEnd(10)} 锚不足 ${rows.length}/${t.anchorN} 跳过`); continue; }
      window = rows.slice(0, t.anchorN);
    } else {
      const cut = t.firstCheat;
      window = rows.filter((r) => r.block_time <= cut).slice(-PULL_LIMIT);
      // +120s 复检窗（锚稀释速度）
      const rc = rows.filter((r) => r.block_time <= new Date(Date.parse(cut) + 120000).toISOString()).slice(-PULL_LIMIT);
      if (rc.length > window.length) {
        const s2 = buildSnapshotFromRows(rc, { ...(await loadMeta(t.addr)) }, { anchorTickCount: rc.length });
        recheckInfo = ` | +120s(${rc.length}tick): sbHold=${fmt(s2.derived.sameBlockHoldPct)} eqHold=${fmt(s2.derived.equalBandHoldPct)} 纯卖=${fmt(s2.derived.noBuySellPct)}`;
      }
    }
    const meta = await loadMeta(t.addr);
    const snap = buildSnapshotFromRows(window, meta, { anchorTickCount: window.length });
    const d = snap.derived;
    const c = candidates(snap);
    const tb = c.topBand ? `${c.topBand.center.toFixed(4)}/${c.topBand.wallets}户${c.topBand.routerRows}/${c.topBand.rows}路由` : '—';
    const tag = t.eqStrong ? '*' : (t.expect === 'LIVE' ? '▶' : ' ');
    console.log([`${tag}${t.caseId}`.padEnd(10), (t.symbol || '?').slice(0, 10).padEnd(11), t.expect.padEnd(10), String(window.length).padEnd(5), String(d.walletCount).padEnd(5), fmt(d.sameBlockHoldPct).padEnd(7), fmt(d.equalBandHoldPct).padEnd(7), String(d.washPairCount ?? '—').padEnd(5), fmt(c.eqCov).padEnd(7), fmt(c.bandRouterPct).padEnd(7), fmt(c.eqMemRouterPct).padEnd(7), tb].join('') + recheckInfo);
    out.push({ id: t.caseId, expect: t.expect, eqStrong: !!t.eqStrong, anchorN: window.length, wallets: d.walletCount, sbHold: d.sameBlockHoldPct, eqHold: d.equalBandHoldPct, washPairCount: d.washPairCount, ...c });
  } catch (e) {
    console.log(`${t.caseId} ERROR ${e.message}`);
  }
}

// ── 分离度汇总：eqHold≥45（A:eq 拉黑高危形状）按人工期望分组 ──
console.log('\n== 分离度汇总（eqHold≥45 子集）==');
const hi = out.filter((r) => r.eqHold !== null && r.eqHold >= 45);
const grp = (label, arr) => {
  if (!arr.length) return console.log(`${label}: 无`);
  const st = (k) => arr.map((r) => r[k]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
  const range = (a) => a.length ? `${a[0].toFixed(0)}~${a[a.length - 1].toFixed(0)}(中位${a[Math.floor(a.length / 2)].toFixed(0)})` : '—';
  console.log(`${label}: n=${arr.length} eqCov=${range(st('eqCov'))} 带路由%=${range(st('bandRouterPct'))} 簇路由%=${range(st('eqMemRouterPct'))} wash≥3=${arr.filter((r) => (r.washPairCount || 0) >= 3).length}/${arr.length}`);
};
grp('人工=cheat   ', hi.filter((r) => r.expect === 'cheat'));
grp('人工=unhealthy', hi.filter((r) => r.expect === 'unhealthy'));
grp('人工=healthy ', hi.filter((r) => r.expect === 'healthy'));
grp('现场票(用户点名)', hi.filter((r) => r.expect === 'LIVE'));
const missed = out.filter((r) => r.eqHold !== null && r.eqHold >= 45 && !hi.includes(r));
if (missed.length) console.log(`（eqHold<45 未进子集：${missed.length} 票）`);
console.log('\n== 候选判据扫描：A:eq 拉黑须 (带路由%<R ∨ eqCov<C) 否则降 unhealthy ==');
for (const R of [40, 50, 60]) for (const C of [50, 60]) {
  const resc = (r) => (r.bandRouterPct ?? 0) < R || (r.eqCov ?? 0) < C; // true=仍可拉黑
  const sub = hi.filter((r) => r.expect !== 'LIVE');
  const keptCheat = sub.filter((r) => r.expect === 'cheat' && resc(r)).length;
  const totCheat = sub.filter((r) => r.expect === 'cheat').length;
  const demotedReal = sub.filter((r) => r.expect === 'cheat' && !resc(r));
  const liveSaved = hi.filter((r) => r.expect === 'LIVE' && !resc(r)).map((r) => r.id);
  console.log(`R=${R} C=${C}: cheat 保留 ${keptCheat}/${totCheat}${demotedReal.length ? `（降级: ${demotedReal.map((r) => r.id).join(',')}）` : ''}；现场票救回: ${liveSaved.join(',') || '无'}`);
}
