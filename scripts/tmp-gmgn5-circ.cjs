require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
const GMGN = ['gmgn', 'gmgn_go', 'axiom', 'padre'];
const ARB = ['arbitrager', 'sandwich_bot', 'wash_trader'];
const SUPPLY = 1e9;
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
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, s.created_at);
    }
    for (const [tok, anchor] of byTok) {
      const pnl = net.get(tok); if (pnl === undefined) continue;
      all.push({ label, exp, tok, anchor, pnl });
    }
  }
  for (const t of all) {
    const { data } = await sb.from('wss_price_ticks')
      .select('trade_type,trader_address,sender_address,bnb_amount,token_amount')
      .eq('token_address', t.tok).lte('block_time', t.anchor).limit(1000);
    t.flowTot = 0; t.gFlow = 0; const hold = new Map(); let gHoldNet = 0;
    for (const r of data || []) {
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      const bnb = Number(r.bnb_amount || 0), tok = Number(r.token_amount || 0);
      if (!w) continue;
      const isG = has(prof.get(w), GMGN);
      const isA = has(prof.get(w), ARB);
      if (r.trade_type === 'buy') { t.flowTot += bnb; if (isG) t.gFlow += bnb; }
      hold.set(w, (hold.get(w) || 0) + (r.trade_type === 'buy' ? tok : -tok));
      if (isG) gHoldNet += (r.trade_type === 'buy' ? tok : -tok);
      if (isA) t.aHoldNet = (t.aHoldNet || 0) + (r.trade_type === 'buy' ? tok : -tok);
    }
    let posTot = 0; for (const v of hold.values()) if (v > 0) posTot += v;
    t.gFlowPct = t.flowTot ? t.gFlow / t.flowTot * 100 : null;
    t.gHoldPct = posTot > 0 ? gHoldNet / posTot * 100 : null;
    t.aHoldPct = posTot > 0 ? (t.aHoldNet || 0) / posTot * 100 : null;
    t.circPct = posTot / SUPPLY * 100;
  }
  const med = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
  console.log('circPct 分布: 中位', med(all.map(t => t.circPct)).toFixed(1) + '%', 'p25', med(all.map(t => t.circPct).slice(0, Math.floor(all.length / 2))).toFixed(1) + '%', 'max', Math.max(...all.map(t => t.circPct)).toFixed(1) + '%');
  // 持筹占比 × 流通 矩阵
  function matrix(rowBands, colBands, rowKey, colKey, name) {
    console.log(`\n[${name}]`);
    console.log('          ' + colBands.map(c => c[0].padEnd(24)).join(''));
    for (const [rn, rc] of rowBands) {
      const cells = [];
      for (const [cn, cc] of colBands) {
        const l = all.filter((x) => rc(x) && cc(x));
        if (!l.length) { cells.push('0'.padEnd(24)); continue; }
        const w = l.filter((x) => x.pnl > 0).length, nv = l.reduce((s, x) => s + x.pnl, 0);
        cells.push(`${l.length}票${Math.round(w / l.length * 100)}%${nv >= 0 ? '+' : ''}${nv.toFixed(2)}(${Math.round(nv / l.length * 10000)}‱)`.padEnd(24));
      }
      console.log(`  ${rn.padEnd(8)} ${cells.join(' ')}`);
    }
  }
  const cb = [['流通<10%', t => t.circPct < 10], ['流通10-20%', t => t.circPct >= 10 && t.circPct < 20], ['流通20-35%', t => t.circPct >= 20 && t.circPct < 35], ['流通>=35%', t => t.circPct >= 35]];
  matrix([['g持<20', t => t.gHoldPct < 20], ['g持20-40', t => t.gHoldPct >= 20 && t.gHoldPct < 40], ['g持40-70', t => t.gHoldPct >= 40 && t.gHoldPct < 70], ['g持>=70', t => t.gHoldPct >= 70]], cb, null, null, 'gmgnUser 持筹占比 × 流通占比');
  matrix([['g流<20', t => t.gFlowPct < 20], ['g流20-50', t => t.gFlowPct >= 20 && t.gFlowPct < 50], ['g流>=50', t => t.gFlowPct >= 50]], cb, null, null, 'gmgnUser 流量占比 × 流通占比');
  // T198 命中票的流通分布
  const t198 = all.filter(t => t.aHoldPct !== null && t.aHoldPct >= 30);
  console.log(`\n[T198 命中 ${t198.length} 票的 circPct]: <10%: ${t198.filter(t => t.circPct < 10).length} | 10-20%: ${t198.filter(t => t.circPct >= 10 && t.circPct < 20).length} | 20-35%: ${t198.filter(t => t.circPct >= 20 && t.circPct < 35).length} | >=35%: ${t198.filter(t => t.circPct >= 35).length}`);
  const s198 = t198.filter(t => t.circPct < 20), l198 = t198.filter(t => t.circPct >= 20);
  console.log(`  小流通(<20%) ${s198.length} 票: 胜${s198.filter(t => t.pnl > 0).length} 净${s198.reduce((s, t) => s + t.pnl, 0).toFixed(3)} | 大流通(>=20%) ${l198.length} 票: 胜${l198.filter(t => t.pnl > 0).length} 净${l198.reduce((s, t) => s + t.pnl, 0).toFixed(3)}`);
  // 28ad/ba5e 参照
  for (const p of ['0x28ad2c7d', '0xba5ed45b']) {
    const t = all.find(x => x.tok.startsWith(p));
    if (t) console.log(`${p}: circPct=${t.circPct.toFixed(1)}% g持${t.gHoldPct.toFixed(0)}% g流${t.gFlowPct.toFixed(0)}%`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
