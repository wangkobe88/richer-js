require('dotenv').config({ path: 'config/.env' });
const fs = require('fs');
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
async function page(sb, table, select, exp, pkIsUuid) {
  let after = pkIsUuid ? '00000000-0000-0000-0000-000000000000' : null, out = [];
  while (true) {
    let q = sb.from(table).select(select).eq('experiment_id', exp).order('id').limit(1000);
    if (after !== null) q = q.gt('id', after);
    const { data, error } = await q;
    if (error) throw new Error(table + ': ' + error.message);
    if (!data || !data.length) break;
    out = out.concat(data); after = data[data.length - 1].id;
    if (data.length < 1000) break;
  }
  return out;
}
async function main() {
  const sb = dbManager.getClient();
  // 名单装载
  const prof = new Set();
  { let after = null;
    while (true) {
      let q = sb.from('gmgn_wallet_profiles').select('address').order('address').limit(1000);
      if (after) q = q.gt('address', after);
      const { data } = await q;
      if (!data || !data.length) break;
      for (const r of data) prof.add(r.address.toLowerCase());
      after = data[data.length - 1].address;
      if (data.length < 1000) break;
    } }
  const smRaw = JSON.parse(fs.readFileSync('data/kol-study/smartmoney-accum.json', 'utf8'));
  const sm = new Set(Object.keys(smRaw.sources.smartmoney || {}).map(a => a.toLowerCase()));
  const famous = new Set(JSON.parse(fs.readFileSync('config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(a => a.toLowerCase()));
  console.log(`名单: profiles=${prof.size} smartmoney=${sm.size} famous=${famous.size}`);
  const routers = new Set([...AGGREGATOR_ROUTER_ADDRS].map(a => a.toLowerCase()));

  const all = []; // {label, exp, tok, r60, anchorTs, pnl}
  for (const [label, exp] of EXPS) {
    const sigs = await page(sb, 'strategy_signals',
      `id,token_address,created_at,${A}->routerBuyPct60`, exp, true);
    const trs = await page(sb, 'trades',
      'id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success', exp, false);
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
  console.log('成交票总数:', all.length);
  // 选票：r60<10 全部 + [10,30) 全部 + >=30 极值各 23
  const low = all.filter(x => x.r60 < 10);
  const mid = all.filter(x => x.r60 >= 10 && x.r60 < 30);
  const targets = all; // 全量 433 票
  console.log(`目标票(全量): ${targets.length}`);

  // 拉锚窗 ticks（按实验分批 .in）
  for (const t of targets) { t.buyers = new Map(); t.routerBuyN = 0; t.buyN = 0; }
  const byExp = new Map();
  for (const t of targets) { if (!byExp.has(t.exp)) byExp.set(t.exp, []); byExp.get(t.exp).push(t); }
  for (const [exp, list] of byExp) {
    for (const t of list) {
      const { data, error } = await sb.from('wss_price_ticks')
        .select('block_time,trade_type,trader_address,sender_address,bnb_amount')
        .eq('token_address', t.tok).lte('block_time', t.anchor).limit(1000);
      if (error) { console.error('ticks err', t.tok, error.message); continue; }
      for (const r of data || []) {
        if (r.trade_type !== 'buy') continue;
        t.buyN++;
        if (routers.has((r.trader_address || '').toLowerCase())) t.routerBuyN++;
        const w = ((r.sender_address || r.trader_address) || '').toLowerCase();
        if (!w) continue;
        const cur = t.buyers.get(w) || 0;
        t.buyers.set(w, cur + Number(r.bnb_amount || 0));
      }
    }
  }
  // GMGN 命中计算 + 输出
  const rows = targets.map(t => {
    let profHit = 0, profBnb = 0, smHit = 0, famHit = 0, totBnb = 0;
    for (const [w, bnb] of t.buyers) {
      totBnb += bnb;
      if (prof.has(w)) { profHit++; profBnb += bnb; }
      if (sm.has(w)) smHit++;
      if (famous.has(w)) famHit++;
    }
    return { ...t, profHit, profBnb, smHit, famHit, totBnb, nW: t.buyers.size, rCnt: t.routerBuyN, rN: t.buyN };
  });
  function dump(list, name) {
    console.log(`\n### ${name} (n=${list.length})`);
    if (list.length <= 60) {
      console.log('token        r60  买N/路由N  钱包N  画像命中  sm  fam  画像买额占比   pnl');
      for (const r of list.sort((a, b) => a.pnl - b.pnl)) {
        const share = r.totBnb ? (r.profBnb / r.totBnb * 100).toFixed(0) : '-';
        console.log(`${r.tok.slice(0, 10)} ${String(r.r60).padStart(4)} ${String(r.rN).padStart(3)}/${String(r.rCnt).padStart(2)} ${String(r.nW).padStart(5)} ${String(r.profHit).padStart(6)} ${String(r.smHit).padStart(3)} ${String(r.famHit).padStart(3)} ${String(share).padStart(8)}% ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(3)}`);
      }
    }
    for (const [nm, cut] of [['GMGN命中=0', x => x.profHit === 0], ['GMGN命中>0', x => x.profHit > 0], ['sm命中>0', x => x.smHit > 0]]) {
      const l = list.filter(cut);
      if (!l.length) { console.log(`  ${nm}: 0`); continue; }
      console.log(`  ${nm}: n=${l.length} 胜${l.filter(x => x.pnl > 0).length} 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
    }
  }
  dump(rows.filter(r => r.r60 < 10), 'r60<10 带');
  dump(rows.filter(r => r.r60 >= 10 && r.r60 < 30), '[10,30) 带');
  dump(rows.filter(r => r.r60 >= 30), '>=30 带极值样本');
  // ===== 比例轴：命中买额占比 + 命中钱包占比 分带 =====
  function ratioCut(list, name) {
    console.log(`\n### 比例切【${name}】(n=${list.length})`);
    const bands = [
      ['占比<30%', r => (r.totBnb ? r.profBnb / r.totBnb : 0) < 0.30],
      ['30-70%', r => { const x = r.totBnb ? r.profBnb / r.totBnb : 0; return x >= 0.30 && x < 0.70; }],
      ['70-90%', r => { const x = r.totBnb ? r.profBnb / r.totBnb : 0; return x >= 0.70 && x < 0.90; }],
      ['>=90%', r => (r.totBnb ? r.profBnb / r.totBnb : 0) >= 0.90],
    ];
    for (const [nm, cut] of bands) {
      const l = list.filter(cut);
      if (!l.length) { console.log(`  买额${nm}: 0`); continue; }
      console.log(`  买额${nm}: n=${l.length} 胜${l.filter(x => x.pnl > 0).length}(${(l.filter(x => x.pnl > 0).length / l.length * 100).toFixed(0)}%) 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
      const perW = {};
      for (const x of l) { perW[x.label] = perW[x.label] || [0, 0, 0]; perW[x.label][0]++; if (x.pnl > 0) perW[x.label][1]++; perW[x.label][2] += x.pnl; }
      console.log('     分窗: ' + Object.entries(perW).map(([w, d]) => `${w} ${d[0]}票/胜${d[1]}/${d[2].toFixed(2)}`).join(' | '));
    }
    const cbands = [
      ['钱包占比<30%', r => r.nW > 0 && r.profHit / r.nW < 0.30],
      ['钱包占比30-70%', r => { const x = r.nW ? r.profHit / r.nW : 0; return x >= 0.30 && x < 0.70; }],
      ['钱包占比>=70%', r => r.nW > 0 && r.profHit / r.nW >= 0.70],
    ];
    for (const [nm, cut] of cbands) {
      const l = list.filter(cut);
      if (!l.length) { console.log(`  ${nm}: 0`); continue; }
      console.log(`  ${nm}: n=${l.length} 胜${l.filter(x => x.pnl > 0).length} 净${l.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
    }
  }
  ratioCut(rows, '全部目标票');
  ratioCut(rows.filter(r => r.r60 < 10), 'r60<10 带');
  ratioCut(rows.filter(r => r.r60 >= 10 && r.r60 < 30), '[10,30) 带');
  ratioCut(rows.filter(r => r.r60 >= 30), '>=30 带极值');
  // ===== 全矩阵：router 四档 × 画像买额占比 三档 =====
  console.log('\n### 全矩阵 router(r60) × 画像买额占比（n/胜率/净BNB/平均单票‱）');
  const rbands = [['r60<10', r => r.r60 < 10], ['[10,30)', r => r.r60 >= 10 && r.r60 < 30], ['[30,60)', r => r.r60 >= 30 && r.r60 < 60], ['>=60', r => r.r60 >= 60]];
  const pbands = [['画像<30%', r => (r.totBnb ? r.profBnb / r.totBnb : 0) < 0.30], ['画像30-70%', r => { const x = r.totBnb ? r.profBnb / r.totBnb : 0; return x >= 0.30 && x < 0.70; }], ['画像>=70%', r => (r.totBnb ? r.profBnb / r.totBnb : 0) >= 0.70]];
  console.log('router\\画像    ' + pbands.map(b => b[0].padEnd(24)).join(''));
  for (const [rn, rc] of rbands) {
    const line = [rn.padEnd(14)];
    for (const [pn, pc] of pbands) {
      const l = rows.filter(x => rc(x) && pc(x));
      if (!l.length) { line.push(('0').padEnd(24)); continue; }
      const w = l.filter(x => x.pnl > 0).length;
      const net = l.reduce((s2, x) => s2 + x.pnl, 0);
      line.push(`${l.length}票 ${Math.round(w / l.length * 100)}% ${net >= 0 ? '+' : ''}${net.toFixed(2)}(${Math.round(net / l.length * 10000)}‱)`.padEnd(24));
    }
    console.log(line.join(''));
  }
  for (const [nm, cut] of [
    ['角A·r60<10 ∧ 画像<30%（直连+新钱）', r => r.r60 < 10 && (r.totBnb ? r.profBnb / r.totBnb : 0) < 0.30],
    ['角B·r60<10 ∧ 画像>=90%（直连+全老手）', r => r.r60 < 10 && (r.totBnb ? r.profBnb / r.totBnb : 0) >= 0.90],
    ['角C·r60>=60 ∧ 画像>=70%（散户通道+老手主导）', r => r.r60 >= 60 && (r.totBnb ? r.profBnb / r.totBnb : 0) >= 0.70],
    ['角D·r60>=30 ∧ 画像<30%（散户+新钱）', r => r.r60 >= 30 && (r.totBnb ? r.profBnb / r.totBnb : 0) < 0.30],
  ]) {
    const l = rows.filter(cut);
    if (!l.length) { console.log(`\n${nm}: 0`); continue; }
    console.log(`\n${nm}: n=${l.length} 胜${l.filter(x => x.pnl > 0).length}(${Math.round(l.filter(x => x.pnl > 0).length / l.length * 100)}%) 净${l.reduce((s2, x) => s2 + x.pnl, 0).toFixed(3)}`);
    const perW = {};
    for (const x of l) { perW[x.label] = perW[x.label] || [0, 0, 0]; perW[x.label][0]++; if (x.pnl > 0) perW[x.label][1]++; perW[x.label][2] += x.pnl; }
    console.log('  分窗: ' + Object.entries(perW).map(([w2, d]) => `${w2} ${d[0]}票/胜${d[1]}/${d[2].toFixed(2)}`).join(' | '));
    const sorted = [...l].sort((a, b) => a.pnl - b.pnl);
    console.log('  最差2:', sorted.slice(0, 2).map(x => `${x.label} ${x.tok.slice(0, 8)} ${x.pnl.toFixed(3)}`).join(' | '));
    console.log('  最好2:', sorted.slice(-2).reverse().map(x => `${x.label} ${x.tok.slice(0, 8)} ${x.pnl.toFixed(3)}`).join(' | '));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
