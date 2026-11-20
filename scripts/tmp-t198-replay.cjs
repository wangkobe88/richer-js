require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { buildBuyPointSnapshot } = require('../src/market-analysis/buy-point-snapshot');
const { evaluateFactorPreBuy } = require('../src/market-analysis/factor-pre-buy-check');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
const TAGS = new Set(['arbitrager', 'sandwich_bot', 'wash_trader']);
async function page(sb, table, sel, exp, uuid) {
  let after = uuid ? '00000000-0000-0000-0000-000000000000' : null, out = [];
  for (;;) {
    let q = sb.from(table).select(sel).eq('experiment_id', exp).order('id').limit(1000);
    if (after !== null) q = q.gt('id', after);
    const { data } = await q; if (!data || !data.length) break;
    out = out.concat(data); after = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return out;
}
(async () => {
  const sb = dbManager.getClient();
  const arbSet = new Set();
  { let after = null;
    for (;;) {
      let q = sb.from('gmgn_wallet_profiles').select('address,tags').order('address').limit(1000);
      if (after) q = q.gt('address', after);
      const { data } = await q; if (!data || !data.length) break;
      for (const r of data) if ((r.tags || []).some((t) => TAGS.has(t))) arbSet.add(r.address.toLowerCase());
      after = data[data.length - 1].address;
      if (data.length < 1000) break;
    } }
  console.log(`arbBot 集: ${arbSet.size} 址`);
  let hitN = 0, hitWin = 0, hitNet = 0; const misses = [];
  for (const [label, exp] of EXPS) {
    const sigs = await page(sb, 'strategy_signals', `id,token_address,created_at,${A}->routerBuyPct60`, exp, true);
    const trs = await page(sb, 'trades', 'id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success', exp, false);
    const net = new Map();
    for (const t of trs) {
      if (!t.success) continue;
      let v = net.get(t.token_address) || 0;
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') v -= Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') v += Number(t.output_amount);
      net.set(t.token_address, v);
    }
    const byTok = new Map();
    for (const s of sigs) {
      if (s.routerBuyPct60 === null || s.routerBuyPct60 === undefined) continue;
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, { anchor: s.created_at });
    }
    let wN = 0, wWin = 0, wNet = 0;
    for (const [tok, i] of byTok) {
      const pnl = net.get(tok); if (pnl === undefined) continue;
      const { data: rows } = await sb.from('wss_price_ticks')
        .select('*').eq('token_address', tok).lte('block_time', i.anchor)
        .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3000);
      if (!rows || rows.length < 6) continue;
      const meta = { address: tok, symbol: '', name: '', createdAt: rows[0].block_time, creatorAddress: null, totalSupply: 1e9 };
      const snap = buildBuyPointSnapshot(rows, meta, { arbBotWallets: arbSet });
      const v = evaluateFactorPreBuy(snap);
      const pct = snap.buyDerived.arbBotHoldCircPct;
      if (v.arms && v.arms.includes('arb_bot_holdings')) {
        hitN++; wN++; hitNet += pnl; wNet += pnl; if (pnl > 0) { hitWin++; wWin++; }
        console.log(`  HIT ${label} ${tok.slice(0, 10)} arbHold=${pct}% pnl=${pnl.toFixed(3)}`);
      } else if (pct !== null && pct >= 25) {
        misses.push(`${label} ${tok.slice(0, 10)} arbHold=${pct}% pnl=${pnl.toFixed(3)} arms=${(v.arms || []).join(',')}`);
      }
    }
    console.log(`### ${label}: 命中 ${wN} 票 胜${wWin} 净${wNet.toFixed(3)}`);
  }
  console.log(`\n总计: 命中 ${hitN} 票 胜${hitWin} 净${hitNet.toFixed(3)}`);
  if (misses.length) console.log(`25~30% 贴线未拦票（观察）:\n  ${misses.join('\n  ')}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
