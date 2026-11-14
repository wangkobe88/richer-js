const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
const EXP = 'b0b3bf11-cfde-4a13-9031-1fa9269a13e3';
(async () => {
  // 成交信号的豁免/腿/时刻（每票取成交那笔）
  const sigs = []; let cur = '';
  for (let p = 0; p < 30; p++) {
    let q = db.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1000);
    if (cur) q = q.gt('created_at', cur);
    const { data } = await q; if (!data?.length) break;
    sigs.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  const execBy = {}; // token -> 豁免信息
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status !== 'executed') continue;
    const cc = m.cheatCheck || {}; const sg = m.signalGate || {};
    execBy[s.token_address] = {
      t: s.created_at, leg: sg.legId || '-',
      exempt: cc.exempt ? cc.exempt.code : (cc.grade === 'healthy' ? 'none(healthy)' : (cc.grade === 'insufficient_ticks' ? 'insufficient' : `deny(${cc.grade})`)),
      origGrade: cc.exempt?.originalGrade || cc.grade || '-',
      pumpExempt: (m.buyPoint?.exempt || m.signalGate?.pumpExempt) ? true : false,
      bpRule: m.buyPoint?.assessment?.rule || '-',
      reset: cc.marketReset ? true : false,
    };
  }
  // 盈亏
  const { data: trades } = await db.from('trades')
    .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', EXP).limit(2000);
  const by = {};
  for (const t of trades || []) {
    if (t.success === false) continue;
    by[t.token_address] = by[t.token_address] || { buy: 0, sell: 0 };
    if (t.trade_direction === 'buy') { const v = t.input_currency === 'BNB' ? Number(t.input_amount || 0) : t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0; by[t.token_address].buy += v; }
    else { const v = t.output_currency === 'BNB' ? Number(t.output_amount || 0) : t.input_currency === 'BNB' ? Number(t.input_amount || 0) : 0; by[t.token_address].sell += v; }
  }
  // 交叉
  const grp = {};
  for (const [tk, info] of Object.entries(execBy)) {
    const b = by[tk]; if (!b) continue;
    const net = b.sell - b.buy;
    const k = info.exempt;
    grp[k] = grp[k] || { n: 0, sum: 0, wins: 0 };
    grp[k].n++; grp[k].sum += net; if (net > 0.0001) grp[k].wins++;
  }
  console.log('== 豁免类型 × 盈亏（成交票） ==');
  for (const [k, v] of Object.entries(grp).sort((a, b) => b[1].sum - a[1].sum))
    console.log(`${k.padEnd(18)} n=${String(v.n).padStart(3)} 盈${String(v.wins).padStart(3)} 净${v.sum >= 0 ? '+' : ''}${v.sum.toFixed(4)} 均值${(v.sum / v.n).toFixed(4)}`);
  // 腿 × 盈亏
  const legGrp = {};
  for (const [tk, info] of Object.entries(execBy)) {
    const b = by[tk]; if (!b) continue;
    legGrp[info.leg] = legGrp[info.leg] || { n: 0, sum: 0, wins: 0 };
    legGrp[info.leg].n++; legGrp[info.leg].sum += b.sell - b.buy; if (b.sell - b.buy > 0.0001) legGrp[info.leg].wins++;
  }
  console.log('\n== 成交腿 × 盈亏 ==');
  for (const [k, v] of Object.entries(legGrp).sort((a, b) => b[1].sum - a[1].sum))
    console.log(`${k.padEnd(10)} n=${String(v.n).padStart(3)} 盈${String(v.wins).padStart(3)} 净${v.sum >= 0 ? '+' : ''}${v.sum.toFixed(4)} 均值${(v.sum / v.n).toFixed(4)}`);
  // 亏损票豁免类型明细（top 20 亏）
  const rows = Object.entries(execBy).map(([tk, i]) => { const b = by[tk]; return b ? { tk, net: b.sell - b.buy, ...i } : null; }).filter(Boolean).sort((a, b) => a.net - b.net);
  console.log('\n== Top20 亏损票 × 豁免/腿 ==');
  for (const r of rows.slice(0, 20)) console.log(`${r.tk.slice(0, 10)} ${r.net.toFixed(4)} leg=${r.leg} exempt=${r.exempt}←${r.origGrade} reset=${r.reset ? 1 : 0} @${r.t?.slice(11, 19)}`);
  console.log('\n== Top5 盈利票 × 豁免/腿 ==');
  for (const r of rows.slice(-5).reverse()) console.log(`${r.tk.slice(0, 10)} ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} leg=${r.leg} exempt=${r.exempt}←${r.origGrade} reset=${r.reset ? 1 : 0} @${r.t?.slice(11, 19)}`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
