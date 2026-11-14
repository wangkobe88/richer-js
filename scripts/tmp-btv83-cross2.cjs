const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
const EXP = 'b0b3bf11-cfde-4a13-9031-1fa9269a13e3';
(async () => {
  const sigs = []; let cur = '';
  for (let p = 0; p < 30; p++) {
    let q = db.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1000);
    if (cur) q = q.gt('created_at', cur);
    const { data } = await q; if (!data?.length) break;
    sigs.push(...data); cur = data[data.length - 1].created_at; if (data.length < 1000) break;
  }
  const execBy = {};
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status !== 'executed') continue;
    const cc = m.cheatCheck || {};
    execBy[s.token_address] = {
      t: s.created_at, leg: m.signalGate?.legId || '-',
      grade: cc.grade ?? null, status: cc.status ?? null,
      exempt: cc.exempt?.code ?? null, reset: cc.marketReset ? true : false,
      resetMin: cc.marketReset?.minVsLaunchPct,
      fullAnchor: cc.marketReset ? cc.marketReset.fullAnchorTickCount : undefined,
    };
  }
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
  const grp = {};
  for (const [tk, i] of Object.entries(execBy)) {
    const b = by[tk]; if (!b) continue;
    const key = i.grade ? i.grade : (i.exempt ? `${i.exempt}←exempt` : `noGrade(${i.status})`);
    grp[key] = grp[key] || { n: 0, sum: 0, wins: 0, resets: 0 };
    grp[key].n++; grp[key].sum += b.sell - b.buy; if (b.sell - b.buy > 0.0001) grp[key].wins++; if (i.reset) grp[key].resets++;
  }
  console.log('== cheat 判定形态 × 盈亏（成交票，按 grade/status 重分类） ==');
  for (const [k, v] of Object.entries(grp).sort((a, b) => b[1].sum - a[1].sum))
    console.log(`${k.padEnd(24)} n=${String(v.n).padStart(3)} 盈${String(v.wins).padStart(3)} reset=${v.resets} 净${v.sum >= 0 ? '+' : ''}${v.sum.toFixed(4)} 均值${(v.sum / v.n).toFixed(4)}`);
  // fail-open 票明细（grade=null 无豁免但成交）
  console.log('\n== fail-open 放行票明细（noGrade 状态分布） ==');
  const st2 = {};
  for (const [tk, i] of Object.entries(execBy)) { if (!i.grade && !i.exempt) { const k = `${i.status}|reset=${i.reset ? 1 : 0}`; st2[k] = (st2[k] || 0) + 1; } }
  console.log(JSON.stringify(st2, null, 0));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
