require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['v162w1003', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['v158w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['v150w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['v145w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
async function main() {
  const sb = dbManager.getClient();
  const rows = [];
  for (const [label, exp] of EXPS) {
    let afterId = '00000000-0000-0000-0000-000000000000';
    while (true) {
      const { data } = await sb.from('strategy_signals')
        .select(`id,token_address,${A}->routerBuyPct60,${A}->tokenAgeSec,${A}->win30BuyBnb,${A}->actNearTail5BuyN,${A}->athVsLaunchPct,metadata->actFrontGate`)
        .eq('experiment_id', exp).eq('signal_type', 'BUY')
        .gt('id', afterId).order('id').limit(1000);
      if (!data || !data.length) break;
      for (const s of data) {
        if (s.routerBuyPct60 === null || s.routerBuyPct60 === undefined) continue;
        if (s.routerBuyPct60 >= 10) continue;
        rows.push({ label, tok: s.token_address, r: s.routerBuyPct60, age: s.tokenAgeSec, w30: s.win30BuyBnb, t5: s.actNearTail5BuyN, ath: s.athVsLaunchPct, sbw: s.actFrontGate ? s.actFrontGate.sbw : '?', act: s.actFrontGate ? s.actFrontGate.act : '?' });
      }
      afterId = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
    // trades net
    let afterId2 = null; const net = new Map();
    while (true) {
      let q = sb.from('trades').select('id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success')
        .eq('experiment_id', exp).order('id').limit(1000);
      if (afterId2 !== null) q = q.gt('id', afterId2);
      const { data } = await q;
      if (!data || !data.length) break;
      for (const t of data) {
        if (!t.success) continue;
        let v = net.get(t.token_address) || 0;
        if (t.trade_direction === 'buy' && t.input_currency === 'BNB') v -= Number(t.input_amount);
        if (t.trade_direction === 'sell' && t.output_currency === 'BNB') v += Number(t.output_amount);
        net.set(t.token_address, v);
      }
      afterId2 = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
    for (const r of rows) if (r.label === label && net.has(r.tok)) r.pnl = net.get(r.tok);
  }
  const withPnl = rows.filter(r => r.pnl !== undefined);
  console.log('r60<10 且成交的票（全部列出，按 pnl 升序）:');
  console.log('窗      token        r60   age   sbw    act   w30买B  t5  ath   pnl');
  for (const r of withPnl.sort((a, b) => a.pnl - b.pnl))
    console.log(`${r.label} ${r.tok.slice(0, 10)} ${String(r.r).padStart(4)} ${String(r.age).padStart(5)} ${String(r.sbw).padStart(5)} ${String(r.act).padStart(5)} ${Number(r.w30 || 0).toFixed(2).padStart(6)} ${String(r.t5).padStart(3)} ${String(r.ath).padStart(5)} ${r.pnl >= 0 ? '+' : ''}${r.pnl.toFixed(3)}`);
  // 年龄交叉
  for (const [cond, name] of [[r => r.age <= 90, 'age<=90'], [r => r.age > 90 && r.age <= 300, '90-300'], [r => r.age > 300, 'age>300']]) {
    const list = withPnl.filter(cond);
    if (!list.length) { console.log(`${name}: 0`); continue; }
    console.log(`${name}: n=${list.length} 胜${list.filter(x => x.pnl > 0).length} 净${list.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
  }
  // sbw 交叉
  for (const sbw of ['burst', 'none', '?']) {
    const list = withPnl.filter(r => r.sbw === sbw);
    if (!list.length) continue;
    console.log(`sbw=${sbw}: n=${list.length} 胜${list.filter(x => x.pnl > 0).length} 净${list.reduce((s, x) => s + x.pnl, 0).toFixed(3)}`);
  }
  // 年龄×sbw 组合
  const list2 = withPnl.filter(r => r.age > 90);
  console.log(`\nage>90 细分: sbw=burst n=${list2.filter(r=>r.sbw==='burst').length} 净${list2.filter(r=>r.sbw==='burst').reduce((s,x)=>s+x.pnl,0).toFixed(3)} | sbw≠burst n=${list2.filter(r=>r.sbw!=='burst').length} 净${list2.filter(r=>r.sbw!=='burst').reduce((s,x)=>s+x.pnl,0).toFixed(3)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
