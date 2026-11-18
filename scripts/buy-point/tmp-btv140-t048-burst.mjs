// BP-T048 TYB 0x21bf04d3…7777 burst 波 famous 构成取证（182 跑）：
// 用户裁定线索「burst 是纯 famous 带起来的」——波窗口径 famous 占比 + 生产信号元数据
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { loadFamousRoster } = require_('../../src/market-analysis/cheat-snapshot.js');
const { sliceAsOf } = await import('./lib.mjs');

const PID = process.argv[2] || 'BP-T048';
const EXP = '6e75ed6d-807a-4164-9551-d3b95d1fc37b';
const doc = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades.json'), 'utf8'));
const p = doc.points.find((x) => x.pointId === PID);
const raw = JSON.parse(readFileSync(resolve(HERE, 'sets', 'btv140-trades-ticks', p.ticksFile), 'utf8')).rows || [];
const rows = sliceAsOf(raw, p.anchorTickCount);
const meta = { ...(doc.tokens[p.tokenAddress] || { address: p.tokenAddress }), quoteToken: p.quoteToken || null };
const roster = loadFamousRoster();
const snap = buildBuyPointSnapshot(rows, meta, { anchorTickCount: p.anchorTickCount, capped: p.capped === true, signalInfo: {} });

// 归一：wallet=sender||trader；链上真序
const norm = rows.map((r) => ({
  t: new Date(r.block_time).getTime(),
  iso: String(r.block_time).slice(11, 19),
  wallet: String(r.sender_address || r.trader_address || '').toLowerCase(),
  side: String(r.trade_type).toLowerCase() === 'buy' ? 'B' : 'S',
  bnb: r.bnb_amount || 0,
  price: r.price_bnb, outlier: !!r.price_outlier,
  block: r.block_number, log: r.log_index,
})).sort((a, b) => a.t - b.t || a.block - b.block || a.log - b.log);
const T0 = norm[0].t, TA = norm[norm.length - 1].t;
for (const n of norm) n.dt = (n.t - T0) / 1000;
const fam = (w) => roster.has(w);
const short = (w) => (w ? w.slice(0, 6) + '…' + w.slice(-4) : '?');

console.log(`=== ${PID} ${p.tokenSymbol} ${p.tokenAddress} rows=${norm.length} span=${((TA - T0) / 1000).toFixed(0)}s anchor=${p.anchorTimeIso}`);

// 1) 静默段地图（≥30s gap）+ CD407 burst 簇
console.log('\n--- ≥30s 静默段 ---');
let exitIdx = null;
for (let i = 1; i < norm.length; i++) {
  const g = (norm[i].t - norm[i - 1].t) / 1000;
  if (g >= 30) { console.log(`gap ${g.toFixed(0)}s @dt=${norm[i].dt.toFixed(0)}s (${norm[i - 1].iso}→${norm[i].iso})`); exitIdx = i; }
}
let waveEnd = norm.length;
if (exitIdx !== null) for (let i = exitIdx + 1; i < norm.length; i++) {
  if ((norm[i].t - norm[i - 1].t) / 1000 >= 5) { waveEnd = i; break; }
}
const wave = exitIdx === null ? [] : norm.slice(exitIdx, waveEnd);

// 2) 波构成
function segStats(seg, label) {
  const buy = seg.filter((x) => x.side === 'B');
  const sell = seg.filter((x) => x.side === 'S');
  const buyBnb = buy.reduce((s, x) => s + x.bnb, 0);
  const sellBnb = sell.reduce((s, x) => s + x.bnb, 0);
  const perWallet = new Map();
  for (const x of seg) {
    const e = perWallet.get(x.wallet) || { w: x.wallet, buyBnb: 0, sellBnb: 0, buyN: 0, sellN: 0 };
    if (x.side === 'B') { e.buyBnb += x.bnb; e.buyN++; } else { e.sellBnb += x.bnb; e.sellN++; }
    perWallet.set(x.wallet, e);
  }
  const famBuyBnb = buy.filter((x) => fam(x.wallet)).reduce((s, x) => s + x.bnb, 0);
  const famSellBnb = sell.filter((x) => fam(x.wallet)).reduce((s, x) => s + x.bnb, 0);
  console.log(`\n--- ${label}: n=${seg.length} dt[${seg.length ? seg[0].dt.toFixed(0) : '-'}~${seg.length ? seg[seg.length - 1].dt.toFixed(0) : '-'}]s 买${buy.length}笔/${buyBnb.toFixed(3)}B 卖${sell.length}笔/${sellBnb.toFixed(3)}B`);
  console.log(`    famous 买=${famBuyBnb.toFixed(3)}B (${buyBnb > 0 ? ((famBuyBnb / buyBnb) * 100).toFixed(1) : '-'}%)  卖=${famSellBnb.toFixed(3)}B (${sellBnb > 0 ? ((famSellBnb / sellBnb) * 100).toFixed(1) : '-'}%)`);
  const wl = [...perWallet.values()].sort((a, b) => (b.buyBnb + b.sellBnb) - (a.buyBnb + a.sellBnb));
  for (const e of wl.slice(0, 12)) {
    console.log(`    ${fam(e.w) ? '★famous' : '      '} ${short(e.w)} 买${e.buyBnb.toFixed(3)}B×${e.buyN} 卖${e.sellBnb.toFixed(3)}B×${e.sellN}`);
  }
  return { buyBnb, sellBnb, famBuyBnb, famBuyPct: buyBnb > 0 ? (famBuyBnb / buyBnb) * 100 : null, wallets: wl.length };
}

const stats = {};
stats.wave = segStats(wave, `CD407 burst 簇（最后≥30s 静默出口+gap<5s 连续段，${exitIdx === null ? '无静默段→空' : `dt ${wave[0].iso}~${wave[wave.length - 1].iso}`}`);
const last = (sec) => norm.filter((x) => TA - x.t <= sec * 1000);
stats.w30 = segStats(last(30), '尾 30s');
stats.w60 = segStats(last(60), '尾 60s');
stats.w120 = segStats(last(120), '尾 120s');

// 3) famous 全窗时间线
console.log('\n--- famous 全窗时间线 ---');
const ft = snap.buyDerived?.famousTraces;
if (ft) for (const w of ft.wallets) {
  console.log(`★ ${short(w.w)} 买${w.buyBnb}B×${w.buyN} (首买 dt=${w.firstBuyDt === null ? '-' : w.firstBuyDt.toFixed(0) + 's'}) 卖${w.sellBnb}B×${w.sellN} (首卖=${w.firstSellDt === null ? '-' : w.firstSellDt.toFixed(0) + 's'} 末卖=${w.lastSellDt === null ? '-' : w.lastSellDt.toFixed(0) + 's'}) 净${w.netBnb}`);
} else console.log('famousTraces=null（roster 缺失或无命中）');
console.log(`groupBuyPct=${ft?.groupBuyPct} groupSellPct=${ft?.groupSellPct} presenceNet=${ft?.presenceNetBnb} inCustody=${ft?.inCustodyCount}`);
const cd = snap.cheatDerived || {};
console.log(`cheatDerived: famousDominancePct=${cd.famousDominancePct} famousHoldPct=${cd.famousHoldPct} famousFollowerPct=${cd.famousFollowerPct} famousGroupBuyPct=${cd.famousGroupBuyPct} bundleBuyPct=${cd.bundleBuyPct} totalBuyBnb=${cd.totalBuyBnb}`);

// 4) 尾 90s 逐行明细（砸+拉的 V 形现场）
console.log('\n--- 尾 90s 逐行 ---');
for (const x of norm.filter((y) => TA - y.t <= 90 * 1000)) {
  console.log(`${x.iso} dt=${String(x.dt.toFixed(0)).padStart(4)} ${fam(x.wallet) ? '★' : ' '} ${x.side} ${x.bnb.toFixed(4).padStart(8)}B @${(x.price * 1e9).toFixed(3)}e-9 ${short(x.wallet)}${x.outlier ? ' OUTLIER' : ''}`);
}

// 5) 波内等额簇检测（toFixed(4) 同额）
{
  const seg = stats.wave ? wave : last(30);
  const buckets = new Map();
  for (const x of seg) if (x.side === 'B' && x.bnb >= 0.001) {
    const k = x.bnb.toFixed(4);
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  const eq = [...buckets.entries()].filter(([, n]) => n >= 3);
  console.log('\n--- 波内同额(0.0001 精度)≥3 笔簇 ---', eq.length ? '' : '（无）');
  for (const [k, n] of eq) console.log(`  ${k}B × ${n} 笔`);
}

// 6) 生产信号元数据（cheat levels/anchors/burst 锚 + BP）
{
  const { dbManager } = await import('../../src/services/dbManager.js');
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('id,created_at,action,executed,execution_status,metadata')
    .eq('experiment_id', EXP).eq('token_address', p.tokenAddress)
    .order('created_at', { ascending: true }).limit(20);
  if (error) throw new Error('signals: ' + error.message);
  console.log(`\n--- 生产信号 ${data.length} 行 ---`);
  for (const s of data) {
    const cc = s.metadata?.cheatCheck;
    const lv = cc?.levels || {};
    const an = cc?.anchors || {};
    console.log(`${s.created_at} ${s.action} ${s.execution_status} cheat.grade=${cc?.grade} exempt=${JSON.stringify(cc?.exempt || null)} act=${lv.activityLevel} sbw=${lv.stallBurstWave}`);
    console.log(`  reasons=${JSON.stringify(cc?.reasons || []).slice(0, 400)}`);
    console.log(`  burst 锚: burstSecSinceWaveEnd=${an.burstSecSinceWaveEnd} burstExitWaveBuyBnb=${an.burstExitWaveBuyBnb} burstExitWaveWallets=${an.burstExitWaveWallets} burstWaveWalletNetBnb=${an.burstWaveWalletNetBnb} burstWalletAvgBnb=${an.burstWalletAvgBnb} burstExitVsLaunchPct=${an.burstExitVsLaunchPct}`);
    console.log(`  nearTail: ${JSON.stringify(an.nearTail10 || {})} nearTail5=${JSON.stringify(an.nearTail5 || {})}`);
    const bp = s.metadata?.buyPoint;
    if (bp) console.log(`  BP: ${bp.status} ${bp.assessment?.bucket}/${bp.assessment?.rule}`);
  }
}

writeFileSync(`/tmp/btv140-${PID.toLowerCase()}-burst.json`, JSON.stringify({ stats: Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { buyBnb: v.buyBnb, sellBnb: v.sellBnb, famBuyPct: v.famBuyPct, wallets: v.wallets }])), famousTraces: ft, cheatDerivedFamous: { dom: cd.famousDominancePct, hold: cd.famousHoldPct, follower: cd.famousFollowerPct, groupBuy: cd.famousGroupBuyPct } }, null, 1));
console.log(`\n→ /tmp/btv140-${PID.toLowerCase()}-burst.json`);
process.exit(0);
