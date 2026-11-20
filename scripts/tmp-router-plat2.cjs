require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
async function main() {
  const sb = dbManager.getClient();
  const routers = new Set([...AGGREGATOR_ROUTER_ADDRS].map(a => a.toLowerCase()));
  const rows = [];
  for (const [label, exp] of EXPS) {
    // signals（分页）
    let after = '00000000-0000-0000-0000-000000000000', sigs = [];
    for (;;) {
      const { data } = await sb.from('strategy_signals')
        .select(`id,token_address,created_at,${A}->routerBuyPct60`).eq('experiment_id', exp).eq('signal_type', 'BUY')
        .gt('id', after).order('id').limit(1000);
      if (!data || !data.length) break;
      sigs = sigs.concat(data); after = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
    let after2 = null, trs = [];
    for (;;) {
      let q = sb.from('trades').select('id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success')
        .eq('experiment_id', exp).order('id').limit(1000);
      if (after2 !== null) q = q.gt('id', after2);
      const { data } = await q; if (!data || !data.length) break;
      trs = trs.concat(data); after2 = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
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
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, { r60: s.routerBuyPct60, anchor: s.created_at });
    }
    for (const [tok, i] of byTok) {
      const pnl = net.get(tok); if (pnl === undefined) continue;
      rows.push({ label, exp, tok, r60: i.r60, anchor: i.anchor, pnl });
    }
  }
  console.log('成交票:', rows.length);
  // per-token platform + 锚窗路由占比（count 口径）
  for (const r of rows) {
    const { data } = await sb.from('wss_price_ticks')
      .select('platform,trade_type,trader_address').eq('token_address', r.tok).lte('block_time', r.anchor).limit(1000);
    const buys = (data || []).filter(t => t.trade_type === 'buy');
    r.plat = (data && data[0] && data[0].platform) || 'null';
    r.routerCntShare = buys.length ? +(buys.filter(t => routers.has((t.trader_address || '').toLowerCase())).length / buys.length * 100).toFixed(1) : null;
  }
  // 平台 × PnL 总览
  for (const p of ['fourmeme', 'flap', 'null']) {
    const l = rows.filter(r => r.plat === p);
    if (!l.length) continue;
    console.log(`[${p}] n=${l.length} 胜${l.filter(x => x.pnl > 0).length}(${Math.round(l.filter(x => x.pnl > 0).length / l.length * 100)}%) 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
    const per = {}; for (const x of l) { per[x.label] = per[x.label] || [0, 0, 0]; per[x.label][0]++; if (x.pnl > 0) per[x.label][1]++; per[x.label][2] += x.pnl; }
    console.log('   分窗: ' + Object.entries(per).map(([w, d]) => `${w} ${d[0]}/胜${d[1]}/${d[2].toFixed(2)}`).join(' | '));
    // 路由 count 占比分布
    const med = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
    console.log(`   锚窗路由count占比: 中位 ${med(l.map(x => x.routerCntShare).filter(v => v !== null))}%`);
  }
  // r60 带 × 平台
  console.log('\nr60带 × 平台:');
  for (const [rn, rc] of [['r60<10', r => r.r60 < 10], ['r60>=30', r => r.r60 >= 30]]) {
    for (const p of ['fourmeme', 'flap']) {
      const l = rows.filter(x => rc(x) && x.plat === p);
      if (!l.length) { console.log(`  ${rn} & ${p}: 0`); continue; }
      console.log(`  ${rn} & ${p}: n=${l.length} 胜${l.filter(x => x.pnl > 0).length} 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
