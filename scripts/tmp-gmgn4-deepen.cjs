require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
const ARB = ['arbitrager', 'sandwich_bot', 'wash_trader'];
const GMGN = ['gmgn', 'gmgn_go', 'axiom', 'padre'];
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
async function main() {
  const sb = dbManager.getClient();
  const prof = new Map();
  { let after = null;
    for (;;) {
      let q = sb.from('gmgn_wallet_profiles').select('address,tags').order('address').limit(1000);
      if (after) q = q.gt('address', after);
      const { data } = await q; if (!data || !data.length) break;
      for (const r of data) prof.set(r.address.toLowerCase(), new Set(r.tags || []));
      after = data[data.length - 1].address;
      if (data.length < 1000) break;
    } }
  const has = (tags, list) => !!tags && list.some((t) => tags.has(t));
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
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, { anchor: s.created_at });
    }
    for (const [tok, i] of byTok) {
      const pnl = net.get(tok); if (pnl === undefined) continue;
      all.push({ label, exp, tok, anchor: i.anchor, pnl });
    }
  }
  console.log('成交票:', all.length);
  for (const t of all) {
    const { data } = await sb.from('wss_price_ticks')
      .select('trade_type,trader_address,sender_address,bnb_amount,token_amount,platform')
      .eq('token_address', t.tok).lte('block_time', t.anchor).limit(1000);
    t.flowTot = 0; t.gFlow = 0; t.hold = new Map(); t.gHoldNet = 0;
    // 低占比带构成解剖用：非 gmgn 买家的分解
    t.comp = { fresh: 0, arb: 0, libNoTag: 0, unknown: 0 }; // bnb 域
    t.plat = (data && data[0] && data[0].platform) || '?';
    for (const r of data || []) {
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const bnb = Number(r.bnb_amount || 0), tok = Number(r.token_amount || 0);
      if (!w) continue;
      const tags = prof.get(w);
      const isG = has(tags, GMGN);
      if (r.trade_type === 'buy') {
        t.flowTot += bnb;
        if (isG) t.gFlow += bnb;
        else {
          if (has(tags, ['fresh_wallet'])) t.comp.fresh += bnb;
          else if (has(tags, ARB)) t.comp.arb += bnb;
          else if (tags) t.comp.libNoTag += bnb;
          else t.comp.unknown += bnb;
        }
      }
      t.hold.set(w, (t.hold.get(w) || 0) + (r.trade_type === 'buy' ? tok : -tok));
      if (isG) t.gHoldNet += (r.trade_type === 'buy' ? tok : -tok);
    }
    let posTot = 0; for (const v of t.hold.values()) if (v > 0) posTot += v;
    t.gFlowPct = t.flowTot ? t.gFlow / t.flowTot * 100 : null;
    t.gHoldPct = posTot > 0 ? t.gHoldNet / posTot * 100 : null;
  }
  const band = (t) => t.gFlowPct;
  function table(list, key, edges, name) {
    console.log(`\n[${name}]`);
    for (let i = 0; i <= edges.length; i++) {
      const lo = i === 0 ? null : edges[i - 1], hi = i === edges.length ? null : edges[i];
      const l = list.filter((x) => x[key] !== null && (lo === null || x[key] >= lo) && (hi === null || x[key] < hi));
      if (!l.length) { console.log(`  ${lo ?? '<' + hi}~${hi ?? '+'}: 0`); continue; }
      const w = l.filter((x) => x.pnl > 0).length, nv = l.reduce((s, x) => s + x.pnl, 0);
      const perW = {};
      for (const x of l) { perW[x.label] = perW[x.label] || [0, 0, 0]; perW[x.label][0]++; if (x.pnl > 0) perW[x.label][1]++; perW[x.label][2] += x.pnl; }
      console.log(`  ${String(lo ?? 0)}~${hi ?? 100}%: n=${l.length} 胜${w}(${Math.round(w / l.length * 100)}%) 净${nv >= 0 ? '+' : ''}${nv.toFixed(2)} 均${Math.round(nv / l.length * 10000)}‱ | ${Object.entries(perW).map(([k, d]) => `${k.slice(1, 4)}:${d[0]}/${d[1]}/${d[2].toFixed(2)}`).join(' ')}`);
    }
  }
  table(all, 'gFlowPct', [10, 20, 30, 50, 70], 'gmgnUser 买额占比·细分带');
  table(all, 'gHoldPct', [20, 40, 60, 80], 'gmgnUser 持筹占比·细分带');
  // 2D 流量×持筹
  console.log('\n[2D] gmgnUser流量 × 持筹（行=流量带 列=持筹带）');
  const fb = [['流<20', t => t.gFlowPct < 20], ['流20-50', t => t.gFlowPct >= 20 && t.gFlowPct < 50], ['流>=50', t => t.gFlowPct >= 50]];
  const hb = [['持<40', t => t.gHoldPct !== null && t.gHoldPct < 40], ['持40-70', t => t.gHoldPct >= 40 && t.gHoldPct < 70], ['持>=70', t => t.gHoldPct >= 70]];
  for (const [fn, fc] of fb) {
    const cells = [];
    for (const [hn, hc] of hb) {
      const l = all.filter((x) => fc(x) && hc(x));
      if (!l.length) { cells.push('0'.padEnd(22)); continue; }
      const w = l.filter((x) => x.pnl > 0).length, nv = l.reduce((s, x) => s + x.pnl, 0);
      cells.push(`${l.length}票${Math.round(w / l.length * 100)}%${nv >= 0 ? '+' : ''}${nv.toFixed(2)}(${Math.round(nv / l.length * 10000)}‱)`.padEnd(22));
    }
    console.log(`  ${fn.padEnd(9)} ${cells.join(' ')}`);
  }
  // 低流量带（<20%）构成解剖
  const low = all.filter((t) => t.gFlowPct < 20);
  console.log(`\n[低占比带解剖] gmgnUser流量<20% n=${low.length}：非 GMGN 买家买额构成（占比）`);
  let cf = 0, ca = 0, cl = 0, cu = 0, ctot = 0;
  for (const t of low) { cf += t.comp.fresh; ca += t.comp.arb; cl += t.comp.libNoTag; cu += t.comp.unknown; ctot += (t.flowTot - t.gFlow); }
  console.log(`  fresh ${(cf / ctot * 100).toFixed(0)}% | arbBot ${(ca / ctot * 100).toFixed(0)}% | 库内无标签 ${(cl / ctot * 100).toFixed(0)}% | 库外未识别 ${(cu / ctot * 100).toFixed(0)}%`);
  const lowPlat = {}; for (const t of low) lowPlat[t.plat] = (lowPlat[t.plat] || 0) + 1;
  console.log('  带内平台:', JSON.stringify(lowPlat), '| 带 PnL: 胜', low.filter(t => t.pnl > 0).length, '净', low.reduce((s, t) => s + t.pnl, 0).toFixed(3));
  const sorted = [...low].sort((a, b) => b.pnl - a.pnl);
  console.log('  最好3:', sorted.slice(0, 3).map(x => `${x.label.slice(1, 4)} ${x.tok.slice(0, 8)} g流${x.gFlowPct.toFixed(0)}% g持${(x.gHoldPct ?? -1).toFixed(0)}% ${x.pnl.toFixed(3)}`).join(' | '));
  console.log('  最差3:', sorted.slice(-3).map(x => `${x.label.slice(1, 4)} ${x.tok.slice(0, 8)} g流${x.gFlowPct.toFixed(0)}% g持${(x.gHoldPct ?? -1).toFixed(0)}% ${x.pnl.toFixed(3)}`).join(' | '));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
