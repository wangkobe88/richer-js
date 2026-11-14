// BP79 state 探针（182 跑）：打印指定票锚时刻的 state 趋势打断/尾段/价格拱段——看 Jev 实际看到什么
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { buildBuyPointState } = require_('../../src/market-analysis/buy-point-state-builder.js');

const V104 = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const TOKENS = [
  { addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', hint: '2026-11-05T12:43:10', key: '蝴蝶人生路' },
  { addr: '0x08aa150d7d86c4a0dfa37f310c1380de9c187777', hint: '2026-11-05T12:11:23', key: '币安之心' },
  { addr: '0xc9bf4530033f6497002d228296fedb45036f7777', hint: '2026-11-05T05:11:40', key: '苹果SI' },
];

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').eq('experiment_id', V104).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  for (const t of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', V104).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(50);
    if (!sigs || !sigs.length) { console.log(`${t.key} 无信号行`); continue; }
    const ht = Date.parse(t.hint + 'Z');
    let best = sigs[0], bestD = Infinity;
    for (const r of sigs) { const d = Math.abs(Date.parse(r.created_at) - ht); if (d < bestD) { bestD = d; best = r; } }
    const anchorMs = Date.parse(best.created_at);

    const { data: probe } = await client.from('wss_price_ticks')
      .select('id').eq('token_address', t.addr).gt('block_time', new Date(anchorMs - 40 * 60 * 1000).toISOString())
      .order('id', { ascending: true }).limit(1);
    const minId = probe && probe.length ? probe[0].id - 1000 : 0;
    const { data: probe2 } = await client.from('wss_price_ticks')
      .select('id').eq('token_address', t.addr).lt('id', minId).order('id', { ascending: false }).limit(1);
    const startId = probe2 && probe2.length ? probe2[0].id : minId;
    const { data: rows } = await client.from('wss_price_ticks')
      .select('*').eq('token_address', t.addr).gt('id', startId).lte('block_time', new Date(anchorMs).toISOString())
      .order('id', { ascending: true }).limit(20000);
    const fit = (rows || []).filter((r) => Date.parse(r.block_time) <= anchorMs && r.bnb_amount >= 1e-12 && r.price_bnb > 0);

    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const snap = buildBuyPointSnapshot(fit, meta, { anchorMs });
    const { state } = buildBuyPointState(snap);
    const lines = state.split('\n');
    console.log(`\n===== ${t.key} ${t.addr.slice(0, 8)} 锚=${best.created_at.slice(11, 19)} 行数=${fit.length}`);
    const keep = (l) => /趋势打断|摆高|锚前尾段|临近段|价格动量|\[PRICE\]|现价较|最近确认|deep|反弹|收复/.test(l);
    let inPrice = false, priceCount = 0;
    for (const l of lines) {
      if (/^\[PRICE\]/.test(l)) { inPrice = true; priceCount = 0; }
      else if (/^\[/.test(l) && !/^\[PRICE\]/.test(l)) inPrice = false;
      if (inPrice && priceCount < 6) { console.log('  ' + l); priceCount++; continue; }
      if (keep(l)) console.log('  ' + l);
    }
    const b = snap.buyDerived || {};
    console.log(`  -- anchors: curVsAth=${b.currentVsAthPct} chg5=${b.chg5Pct} chg10=${b.chg10Pct} chg30=${b.chg30Pct} nearMaxDn5=${b.nearMaxDn5Pct} curVsMinGap=${b.curVsMinGapPct} recentDipPct=${b.recentDip5 && b.recentDip5.pct} tail10BuyN=${b.nearTail10 && b.nearTail10.buyN} tail10BuyBnb=${b.nearTail10 && b.nearTail10.buyBnb} maxDn5=${b.maxDn5Pct}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
