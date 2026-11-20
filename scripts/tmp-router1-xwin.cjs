require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const EXPS = [
  ['w1003热 bt-v162', 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f'],
  ['w1019中 bt-v158', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012中 bt-v150', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103冷 bt-v145', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
const A = 'metadata->buyPoint->anchors';
function band(r) {
  if (r === null || r === undefined) return 'null';
  if (r === 0) return '0';
  if (r < 10) return '(0,10)';
  if (r < 30) return '[10,30)';
  return '>=30';
}
async function main() {
  const sb = dbManager.getClient();
  const pool = { null: [], '0': [], '(0,10)': [], '[10,30)': [], '>=30': [] };
  for (const [label, exp] of EXPS) {
    const { data: sigs, error } = await sb.from('strategy_signals')
      .select(`id,token_address,created_at,executed,${A}->routerBuyPct60,${A}->tokenAgeSec,${A}->win30BuyN`)
      .eq('experiment_id', exp).eq('signal_type', 'BUY')
      .order('created_at').limit(2000);
    if (error) { console.error(label, 'sig err', error.message); continue; }
    const { data: trs } = await sb.from('trades')
      .select('token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success')
      .eq('experiment_id', exp).limit(4000);
    const net = new Map();
    for (const t of (trs || [])) {
      if (!t.success) continue;
      const k = t.token_address;
      let v = net.get(k) || 0;
      if (t.trade_direction === 'buy' && t.input_currency === 'BNB') v -= Number(t.input_amount);
      if (t.trade_direction === 'sell' && t.output_currency === 'BNB') v += Number(t.output_amount);
      net.set(k, v);
    }
    // 每票取首个到达 BP（有锚）的信号
    const byTok = new Map();
    let reachedBp = 0, executedToks = 0;
    for (const s of sigs) {
      const r60 = s.routerBuyPct60;
      if (r60 === null || r60 === undefined) continue;
      reachedBp++;
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, { r60, age: s.tokenAgeSec, buyN: s.win30BuyN, firstAt: s.created_at });
    }
    for (const [tok, info] of byTok) {
      const pnl = net.get(tok);
      if (pnl === undefined) continue; // 未成交
      executedToks++;
      pool[band(info.r60)].push({ label, tok, r60: info.r60, age: info.age, pnl, sym: tok.slice(0, 8) });
    }
    console.log(`\n### ${label}: BUY信号 ${sigs.length} / 到达BP ${reachedBp} / 成交票 ${executedToks}`);
    // 本窗分布
    const rows = [...byTok.entries()].map(([tok, i]) => i);
    const dist = {}; for (const r of rows) dist[band(r.r60)] = (dist[band(r.r60)] || 0) + 1;
    console.log('  r60 分布(到达BP票):', JSON.stringify(dist));
  }
  console.log('\n===== 四窗合并（成交票，按 r60 分带）=====');
  for (const b of ['null', '0', '(0,10)', '[10,30)', '>=30']) {
    const list = pool[b]; if (!list.length) { console.log(`${b}: 0`); continue; }
    const n = list.length, win = list.filter(x => x.pnl > 0).length, sum = list.reduce((s, x) => s + x.pnl, 0);
    const perWin = {};
    for (const x of list) { perWin[x.label] = perWin[x.label] || { n: 0, sum: 0, win: 0 }; perWin[x.label].n++; perWin[x.label].sum += x.pnl; if (x.pnl > 0) perWin[x.label].win++; }
    console.log(`\n[${b}] n=${n} 胜${win}(${(win / n * 100).toFixed(0)}%) 净=${sum.toFixed(3)} BNB`);
    for (const [w, d] of Object.entries(perWin)) console.log(`   ${w}: n=${d.n} 胜${d.win} 净${d.sum.toFixed(3)}`);
    const sorted = [...list].sort((a, b2) => a.pnl - b2.pnl);
    console.log('   最差3:', sorted.slice(0, 3).map(x => `${x.label.slice(6)} ${x.sym} r${x.r60} ${x.pnl.toFixed(3)}`).join(' | '));
    console.log('   最好3:', sorted.slice(-3).reverse().map(x => `${x.label.slice(6)} ${x.sym} r${x.r60} ${x.pnl.toFixed(3)}`).join(' | '));
  }
  // G17 线视角：<10 全拦的净效果
  const blocked = [...pool['0'], ...pool['(0,10)']];
  const bs = blocked.reduce((s, x) => s + x.pnl, 0);
  const bw = blocked.filter(x => x.pnl > 0).length;
  console.log(`\n>>> 若拦 r60<10（0 与 (0,10) 合并，null 不拦）: n=${blocked.length} 胜${bw} 净${bs.toFixed(3)} BNB（负=止血为正）`);
  console.log(`>>> 被拦票里的正票肥尾: Σ正pnl=${blocked.filter(x=>x.pnl>0).reduce((s,x)=>s+x.pnl,0).toFixed(3)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
