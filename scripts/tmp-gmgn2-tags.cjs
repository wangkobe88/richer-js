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
const GROUPS = {
  gmgnUser: ['gmgn', 'gmgn_go'],
  platform: ['gmgn', 'gmgn_go', 'axiom', 'padre'],
  fresh: ['fresh_wallet'],
  arbBot: ['arbitrager', 'sandwich_bot', 'wash_trader'],
  smartish: ['kol', 'top_followed', 'app_smart_money', 'smart_degen', 'top_renamed', 'top_dev'],
  fomo: ['fomo'],
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
  const prof = new Map(); // addr -> Set(tags)
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
  console.log('profile 库:', prof.size);
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
  for (const t of all) { t.totBnb = 0; t.g = {}; for (const k of Object.keys(GROUPS)) t.g[k] = 0; }
  for (const t of all) {
    const { data } = await sb.from('wss_price_ticks')
      .select('trade_type,trader_address,sender_address,bnb_amount')
      .eq('token_address', t.tok).lte('block_time', t.anchor).limit(1000);
    for (const r of data || []) {
      if (r.trade_type !== 'buy') continue;
      const bnb = Number(r.bnb_amount || 0);
      const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
      t.totBnb += bnb;
      if (!w) continue;
      const tags = prof.get(w);
      if (!tags) continue;
      for (const [g, list] of Object.entries(GROUPS)) if (list.some(x => tags.has(x))) t.g[g] += bnb;
    }
  }
  const share = (t, g) => t.totBnb ? t.g[g] / t.totBnb : 0;
  console.log('\n===== 各标签组·锚窗买额占比分带（全量 433 票）=====');
  for (const g of Object.keys(GROUPS)) {
    const bands = [['=0', x => share(x, g) === 0], ['(0,20%)', x => share(x, g) > 0 && share(x, g) < 0.20], ['[20,50%)', x => share(x, g) >= 0.20 && share(x, g) < 0.50], ['>=50%', x => share(x, g) >= 0.50]];
    console.log(`\n[${g}]`);
    for (const [nm, cut] of bands) {
      const l = all.filter(cut);
      if (!l.length) { console.log(`  ${nm}: 0`); continue; }
      const w = l.filter(x => x.pnl > 0).length;
      const netV = l.reduce((s, x) => s + x.pnl, 0);
      console.log(`  ${nm}: n=${l.length} 胜${w}(${Math.round(w / l.length * 100)}%) 净${netV >= 0 ? '+' : ''}${netV.toFixed(3)} 均${Math.round(netV / l.length * 10000)}‱`);
      const perW = {};
      for (const x of l) { perW[x.label] = perW[x.label] || [0, 0, 0]; perW[x.label][0]++; if (x.pnl > 0) perW[x.label][1]++; perW[x.label][2] += x.pnl; }
      console.log('     分窗: ' + Object.entries(perW).map(([w2, d]) => `${w2} ${d[0]}/胜${d[1]}/${d[2].toFixed(2)}`).join(' | '));
    }
  }
  // gmgnUser 与 r60 的关系：是否同一信号
  let corr = 0;
  const med = arr => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const gShare = all.map(t => share(t, 'gmgnUser')), rShare = all.map(t => t.r60);
  console.log(`\ngmgnUser占比 中位=${(med(gShare) * 100).toFixed(1)}% 均值=${(gShare.reduce((a, b) => a + b, 0) / all.length * 100).toFixed(1)}% | r60 中位=${med(rShare).toFixed(1)}%`);
  // 2D: gmgnUser share × router 带
  console.log('\n===== 2D: gmgnUser占比 × router(r60) =====');
  for (const [rn, rc] of [['r60<10', t => t.r60 < 10], ['r60>=10', t => t.r60 >= 10]]) {
    for (const [gn, gc] of [['gmgnUser<20%', t => share(t, 'gmgnUser') < 0.20], ['gmgnUser>=50%', t => share(t, 'gmgnUser') >= 0.50]]) {
      const l = all.filter(x => rc(x) && gc(x));
      if (!l.length) { console.log(`  ${rn} & ${gn}: 0`); continue; }
      const w = l.filter(x => x.pnl > 0).length;
      console.log(`  ${rn} & ${gn}: n=${l.length} 胜${w}(${Math.round(w / l.length * 100)}%) 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
    }
  }
  // ===== arbBot 细分带（<10% 以下看结构）=====
  console.log('\n===== arbBot 细分带 =====');
  const fine = [['=0', x => share(x, 'arbBot') === 0], ['(0,5%)', x => share(x, 'arbBot') > 0 && share(x, 'arbBot') < 0.05], ['[5,10%)', x => share(x, 'arbBot') >= 0.05 && share(x, 'arbBot') < 0.10], ['[10,20%)', x => share(x, 'arbBot') >= 0.10 && share(x, 'arbBot') < 0.20], ['[20,50%)', x => share(x, 'arbBot') >= 0.20 && share(x, 'arbBot') < 0.50], ['>=50%', x => share(x, 'arbBot') >= 0.50]];
  for (const [nm, cut] of fine) {
    const l = all.filter(cut);
    if (!l.length) { console.log(`  ${nm}: 0`); continue; }
    const w = l.filter(x => x.pnl > 0).length, netV = l.reduce((s2, x) => s2 + x.pnl, 0);
    console.log(`  ${nm}: n=${l.length} 胜${w}(${Math.round(w / l.length * 100)}%) 净${netV >= 0 ? '+' : ''}${netV.toFixed(3)} 均${Math.round(netV / l.length * 10000)}‱`);
    const perW = {};
    for (const x of l) { perW[x.label] = perW[x.label] || [0, 0, 0]; perW[x.label][0]++; if (x.pnl > 0) perW[x.label][1]++; perW[x.label][2] += x.pnl; }
    console.log('     分窗: ' + Object.entries(perW).map(([w2, d]) => `${w2} ${d[0]}/胜${d[1]}/${d[2].toFixed(2)}`).join(' | '));
  }
  // 10-20% 带名单（用户最关心的潜在新刀口）
  const mid = all.filter(x => share(x, 'arbBot') >= 0.10 && share(x, 'arbBot') < 0.20).sort((a, b) => a.pnl - b.pnl);
  console.log(`\n[10,20%) 带 ${mid.length} 票（pnl 升序）:`);
  for (const t of mid) console.log(`  ${t.label} ${t.tok.slice(0, 10)} arb=${(share(t, 'arbBot') * 100).toFixed(0)}% gmgn=${(share(t, 'gmgnUser') * 100).toFixed(0)}% r60=${t.r60} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(3)}`);
  const midW = mid.filter(x => x.pnl > 0).length, midNet = mid.reduce((s2, x) => s2 + x.pnl, 0);
  console.log(`  [10,20%) 合计: 胜${midW}/${mid.length} 净${midNet.toFixed(3)}`);
  // 5-10% 也给名单概要
  const lo = all.filter(x => share(x, 'arbBot') >= 0.05 && share(x, 'arbBot') < 0.10);
  console.log(`\n[5,10%) 带 ${lo.length} 票: 胜${lo.filter(x => x.pnl > 0).length} 净${lo.reduce((s2, x) => s2 + x.pnl, 0).toFixed(3)}，最差3: ${[...lo].sort((a,b)=>a.pnl-b.pnl).slice(0,3).map(x => `${x.tok.slice(0,8)} ${x.pnl.toFixed(3)}`).join(' | ')} 最好3: ${[...lo].sort((a,b)=>b.pnl-a.pnl).slice(0,3).map(x => `${x.tok.slice(0,8)} ${x.pnl.toFixed(3)}`).join(' | ')}`);
  // ===== arbBot>=20% 名单输出 + 开页 URL =====
  const hits = all.filter(t => share(t, 'arbBot') >= 0.20).sort((a, b) => a.pnl - b.pnl);
  console.log('\n===== arbBot>=20% 名单（' + hits.length + ' 票）=====');
  console.log('窗        token(全)                              arbBot%  gmgnUser%  r60    pnl');
  const urls = [];
  for (const t of hits) {
    const ab = (share(t, 'arbBot') * 100).toFixed(0), gu = (share(t, 'gmgnUser') * 100).toFixed(0);
    console.log(`${t.label} ${t.tok} ${String(ab).padStart(5)} ${String(gu).padStart(8)} ${String(t.r60).padStart(5)} ${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(3)}`);
    urls.push(`http://localhost:3010/experiment/${t.exp}/signals#token=${t.tok}`);
  }
  require('fs').writeFileSync('/tmp/arbbot18-urls.txt', urls.join('\n') + '\n');
  console.log('URLs -> /tmp/arbbot18-urls.txt');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
