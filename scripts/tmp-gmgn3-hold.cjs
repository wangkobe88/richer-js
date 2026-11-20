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
const GRP = {
  arbBot: ['arbitrager', 'sandwich_bot', 'wash_trader'],
  gmgnUser: ['gmgn', 'gmgn_go', 'axiom', 'padre'],
};
async function page(sb, table, select, exp, uuid) {
  let after = uuid ? '00000000-0000-0000-0000-000000000000' : null, out = [];
  while (true) {
    let q = sb.from(table).select(select).eq('experiment_id', exp).order('id').limit(1000);
    if (after !== null) q = q.gt('id', after);
    const { data } = await q;
    if (!data || !data.length) break;
    out = out.concat(data); after = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return out;
}
async function main() {
  const sb = dbManager.getClient();
  const prof = new Map();
  { let after = null;
    while (true) {
      let q = sb.from('gmgn_wallet_profiles').select('address,tags').order('address').limit(1000);
      if (after) q = q.gt('address', after);
      const { data } = await q;
      if (!data || !data.length) break;
      for (const r of data) prof.set(r.address.toLowerCase(), new Set(r.tags || []));
      after = data[data.length - 1].address;
      if (data.length < 1000) break;
    } }
  const routers = new Set([...AGGREGATOR_ROUTER_ADDRS].map(a => a.toLowerCase()));
  const all = [];
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
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, { r60: s.routerBuyPct60, anchor: s.created_at });
    }
    for (const [tok, i] of byTok) {
      const pnl = net.get(tok); if (pnl === undefined) continue;
      all.push({ label, exp, tok, r60: i.r60, anchor: i.anchor, pnl });
    }
  }
  console.log('成交票:', all.length);
  // 持仓重建
  for (const t of all) {
    const { data } = await sb.from('wss_price_ticks')
      .select('trade_type,trader_address,sender_address,token_amount,bnb_amount')
      .eq('token_address', t.tok).lte('block_time', t.anchor).limit(1000);
    t.flowArb = 0; t.flowBnb = 0;
    t.hold = new Map(); // wallet -> net tokens
    t.gHold = { arbBot: 0, gmgnUser: 0 };
    for (const r of data || []) {
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const tok = Number(r.token_amount || 0);
      const bnb = Number(r.bnb_amount || 0);
      if (!w || !tok) continue;
      const delta = r.trade_type === 'buy' ? tok : -tok;
      t.hold.set(w, (t.hold.get(w) || 0) + delta);
      const tags = prof.get(w);
      if (tags) for (const [g, list] of Object.entries(GRP)) if (list.some(x => tags.has(x))) t.gHold[g] += delta;
      if (r.trade_type === 'buy') {
        t.flowBnb += bnb;
        if (tags && GRP.arbBot.some(x => tags.has(x))) t.flowArb += bnb;
      }
    }
    // Σ正净 = 流通近似；top1/2/5
    const nets = [...t.hold.values()].filter(v => v > 0).sort((a, b) => b - a);
    t.totPos = nets.reduce((s, v) => s + v, 0);
    t.top1 = t.totPos ? nets[0] / t.totPos * 100 : null;
    t.top2 = t.totPos ? (nets[0] + (nets[1] || 0)) / t.totPos * 100 : null;
    t.top5 = t.totPos ? nets.slice(0, 5).reduce((s, v) => s + v, 0) / t.totPos * 100 : null;
    t.arbHold = t.totPos ? t.gHold.arbBot / t.totPos * 100 : null;
    t.gmgnHold = t.totPos ? t.gHold.gmgnUser / t.totPos * 100 : null;
    t.arbFlow = t.flowBnb ? t.flowArb / t.flowBnb * 100 : 0;
    t.nPosHolders = nets.filter(v => v > 1e-6).length;
  }
  // 集中度分带
  function band(list, key, edges, name) {
    console.log(`\n[${name}]`);
    for (let i = 0; i <= edges.length; i++) {
      const lo = i === 0 ? null : edges[i - 1], hi = i === edges.length ? null : edges[i];
      const l = list.filter(x => x[key] !== null && (lo === null || x[key] >= lo) && (hi === null || x[key] < hi));
      if (!l.length) { console.log(`  ${lo === null ? '<' + hi : hi === null ? '>=' + lo : lo + '~' + hi}: 0`); continue; }
      const w = l.filter(x => x.pnl > 0).length, nv = l.reduce((s, x) => s + x.pnl, 0);
      console.log(`  ${lo === null ? '<' + hi : hi === null ? '>=' + lo : lo + '~' + hi}: n=${l.length} 胜${w}(${Math.round(w / l.length * 100)}%) 净${nv >= 0 ? '+' : ''}${nv.toFixed(3)} 均${Math.round(nv / l.length * 10000)}‱`);
      const perW = {};
      for (const x of l) { perW[x.label] = perW[x.label] || [0, 0, 0]; perW[x.label][0]++; if (x.pnl > 0) perW[x.label][1]++; perW[x.label][2] += x.pnl; }
      console.log('     分窗: ' + Object.entries(perW).map(([w2, d]) => `${w2} ${d[0]}/胜${d[1]}/${d[2].toFixed(2)}`).join(' | '));
    }
  }
  band(all, 'top1', [15, 30, 50], 'top1 净持仓集中度 %');
  band(all, 'top5', [40, 60, 80], 'top5 净持仓集中度 %');
  band(all, 'arbHold', [10, 30], 'arbBot 组净持筹占流通 %');
  band(all, 'gmgnHold', [30, 60], 'gmgnUser 组净持筹占流通 %');
  // 交叉：arb 流量 ≥20% × arbHold
  console.log('\n[交叉] arbBot流量≥20% × arbBot持筹');
  for (const [fn, fc] of [['流量<20%', x => x.arbFlow < 20], ['流量>=20%', x => x.arbFlow >= 20]]) {
    for (const [hn, hc] of [['持筹<10%', x => x.arbHold !== null && x.arbHold < 10], ['持筹>=10%', x => x.arbHold !== null && x.arbHold >= 10]]) {
      const l = all.filter(x => fc(x) && hc(x));
      if (!l.length) { console.log(`  ${fn} & ${hn}: 0`); continue; }
      const w = l.filter(x => x.pnl > 0).length;
      console.log(`  ${fn} & ${hn}: n=${l.length} 胜${w}(${Math.round(w / l.length * 100)}%) 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
    }
  }
  // 重点票持仓画像
  console.log('\n[重点票] token           arb流量 arb持筹 gmgn持筹 top1  top2  top5  正持人  pnl');
  for (const t of all.filter(x => ['0x28ad2c7d', '0xba5ed45b', '0xf818ac2c', '0x4fe71b03', '0x06c78718', '0xdf0e5775', '0xee74e6f1', '0x04124a5e'].some(p => x.tok.startsWith(p)))
    .sort((a, b) => b.pnl - a.pnl))
    console.log(`${t.tok.slice(0, 10)} ${String(t.arbFlow.toFixed(0)).padStart(5)}% ${String((t.arbHold ?? -1).toFixed(0)).padStart(6)}% ${String((t.gmgnHold ?? -1).toFixed(0)).padStart(7)}% ${String((t.top1 ?? -1).toFixed(0)).padStart(4)}% ${String((t.top2 ?? -1).toFixed(0)).padStart(4)}% ${String((t.top5 ?? -1).toFixed(0)).padStart(4)}% ${String(t.nPosHolders).padStart(5)} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(3)}`);
  // arbBot 持筹 >=30% 名单
  const hlist = all.filter(x => x.arbHold !== null && x.arbHold >= 30).sort((a, b) => a.pnl - b.pnl);
  console.log('\n[arbBot持筹>=30% 名单] ' + hlist.length + ' 票（pnl 升序；◇=同时 arb流量>=20%）');
  for (const t of hlist) console.log(`  ${t.label} ${t.tok} 持筹${String(t.arbHold.toFixed(0)).padStart(3)}%${t.arbFlow >= 20 ? '◇' : ' '} 流量${String(t.arbFlow.toFixed(0)).padStart(3)}% gmgn持${String(t.gmgnHold.toFixed(0)).padStart(3)}% top1=${String(t.top1.toFixed(0)).padStart(3)}% 正持人${String(t.nPosHolders).padStart(3)} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(3)}`);
  console.log(`  合计: 胜${hlist.filter(x => x.pnl > 0).length}/${hlist.length} 净${hlist.reduce((s2, x) => s2 + x.pnl, 0).toFixed(3)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
