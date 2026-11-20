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
    // 分页拉全量 BUY 信号
    let afterId = '00000000-0000-0000-0000-000000000000', sigs = [];
    while (true) {
      const { data } = await sb.from('strategy_signals')
        .select(`id,token_address,created_at,executed,${A}->routerBuyPct60,${A}->tokenAgeSec`)
        .eq('experiment_id', exp).eq('signal_type', 'BUY')
        .gt('id', afterId).order('id', { ascending: true }).limit(1000);
      if (!data || !data.length) break;
      sigs = sigs.concat(data); afterId = data[data.length - 1].id;
      if (data.length < 1000) break;
    }
    let afterId2 = null, trs = [];
    while (true) {
      let q = sb.from('trades')
        .select('id,token_address,trade_direction,input_currency,output_currency,input_amount,output_amount,success')
        .eq('experiment_id', exp).order('id').limit(1000);
      if (afterId2 !== null) q = q.gt('id', afterId2);
      const { data, error: te } = await q;
      if (te) { console.error(label, 'trade err', te.message); break; }
      if (!data || !data.length) break;
      trs = trs.concat(data); afterId2 = data[data.length - 1].id;
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
    const byTok = new Map(); let reachedBp = 0;
    for (const s of sigs) {
      const r60 = s.routerBuyPct60;
      if (r60 === null || r60 === undefined) continue;
      reachedBp++;
      if (!byTok.has(s.token_address)) byTok.set(s.token_address, { r60, age: s.tokenAgeSec });
    }
    let executedToks = 0;
    for (const [tok, info] of byTok) {
      const pnl = net.get(tok);
      if (pnl === undefined) continue;
      executedToks++;
      pool[band(info.r60)].push({ label, tok, r60: info.r60, age: info.age, pnl });
    }
    const dist = {}; for (const i of byTok.values()) dist[band(i.r60)] = (dist[band(i.r60)] || 0) + 1;
    console.log(`### ${label}: BUY信号 ${sigs.length} / 到达BP ${reachedBp} / 成交票 ${executedToks} | r60分布 ${JSON.stringify(dist)}`);
  }
  console.log('\n===== 四窗合并（成交票，按 r60 分带）=====');
  for (const b of ['null', '0', '(0,10)', '[10,30)', '>=30']) {
    const list = pool[b]; if (!list.length) { console.log(`[${b}] 0`); continue; }
    const n = list.length, win = list.filter(x => x.pnl > 0).length, sum = list.reduce((s, x) => s + x.pnl, 0);
    const perWin = {};
    for (const x of list) { const k = x.label.slice(6); perWin[k] = perWin[k] || { n: 0, sum: 0, win: 0 }; perWin[k].n++; perWin[k].sum += x.pnl; if (x.pnl > 0) perWin[k].win++; }
    console.log(`\n[${b}] n=${n} 胜${win}(${(win / n * 100).toFixed(0)}%) 净=${sum.toFixed(3)} BNB`);
    for (const [w, d] of Object.entries(perWin)) console.log(`   ${w}: n=${d.n} 胜${d.win} 净${d.sum.toFixed(3)}`);
    const sorted = [...list].sort((a, b2) => a.pnl - b2.pnl);
    console.log('   最差3:', sorted.slice(0, 3).map(x => `${x.label.slice(6)} ${x.tok.slice(0, 8)} r${x.r60} ${x.pnl.toFixed(3)}`).join(' | '));
    console.log('   最好3:', sorted.slice(-3).reverse().map(x => `${x.label.slice(6)} ${x.tok.slice(0, 8)} r${x.r60} ${x.pnl.toFixed(3)}`).join(' | '));
  }
  const blocked = [...pool['0'], ...pool['(0,10)']];
  console.log(`\n>>> 若拦 r60<10: n=${blocked.length} 胜${blocked.filter(x=>x.pnl>0).length} 净${blocked.reduce((s,x)=>s+x.pnl,0).toFixed(3)}（负值才=止血为正）`);
  console.log(`>>> 被拦票里正票Σ=${blocked.filter(x=>x.pnl>0).reduce((s,x)=>s+x.pnl,0).toFixed(3)} 负票Σ=${blocked.filter(x=>x.pnl<=0).reduce((s,x)=>s+x.pnl,0).toFixed(3)}`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
