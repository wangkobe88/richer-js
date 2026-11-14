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
  const LEGN = { buy_0_1: 't0a', buy_1_2: 't0b', buy_2_3: 't2', buy_3_4: 't3', buy_4_5: 't4', buy_5_6: 'N30', buy_6_7: 'N36', buy_7_8: 'N45', buy_8_9: 'NL15', buy_9_10: 'NL20', buy_10_11: 'NL25', buy_11_12: 'RL15', buy_12_13: 'RL10' };
  const legGrp = {}, hourGrp = {};
  const rows = [];
  for (const s of sigs) {
    const m = s.metadata || {};
    if (m.execution_status !== 'executed') continue;
    const cc = m.cheatCheck || {};
    if (cc.grade || cc.exempt || cc.status !== 'insufficient_ticks') continue;
    const b = by[s.token_address]; if (!b) continue;
    const leg = LEGN[m.signalGate?.legId] || m.signalGate?.legId;
    const net = b.sell - b.buy;
    rows.push({ tk: s.token_address, t: s.created_at, leg, net, resetMin: cc.marketReset?.minVsLaunchPct, fullAnchor: cc.marketReset?.fullAnchorTickCount, anchorN: cc.marketReset?.anchorTickCount, bpRule: m.buyPoint?.assessment?.rule, curVs: m.buyPoint?.assessment?.anchors?.currentVsLaunchPct });
    legGrp[leg] = legGrp[leg] || { n: 0, sum: 0, wins: 0 }; legGrp[leg].n++; legGrp[leg].sum += net; if (net > 0.0001) legGrp[leg].wins++;
    const h = s.created_at.slice(11, 13); hourGrp[h] = (hourGrp[h] || 0) + 1;
  }
  console.log('== 87 票 reset-insufficient fail-open：腿 × 盈亏 ==');
  for (const [k, v] of Object.entries(legGrp).sort((a, b) => a[1].sum - b[1].sum))
    console.log(`${k.padEnd(6)} n=${String(v.n).padStart(3)} 盈${String(v.wins).padStart(2)} 净${v.sum.toFixed(4)}`);
  console.log('小时分布:', JSON.stringify(hourGrp));
  console.log('\n== 明细（前 15 亏损） ==');
  rows.sort((a, b) => a.net - b.net);
  for (const r of rows.slice(0, 15)) console.log(`${r.tk.slice(0, 10)} ${r.net.toFixed(4)} leg=${r.leg} resetMin=${r.resetMin ?? '?'} @${r.t.slice(11, 19)}`);
  console.log('\n== 明细（前 8 盈利） ==');
  for (const r of rows.slice(-8).reverse()) console.log(`${r.tk.slice(0, 10)} ${r.net >= 0 ? '+' : ''}${r.net.toFixed(4)} leg=${r.leg} resetMin=${r.resetMin ?? '?'} @${r.t.slice(11, 19)}`);
  // 前向形状抽样 3 票最亏：首价/峰值/末价
  console.log('\n== 最亏 3 票价格轨迹 ==');
  for (const r of rows.slice(0, 3)) {
    const tk = r.tk; const tr = []; let c2 = null;
    for (let p = 0; p < 8; p++) {
      let q = db.from('wss_price_ticks').select('id,block_time,price_bnb').eq('token_address', tk).order('id', { ascending: true }).limit(1000);
      if (c2) q = q.gt('id', c2);
      const { data } = await q; if (!data?.length) break;
      tr.push(...data); c2 = data[data.length - 1].id; if (data.length < 1000) break;
    }
    const rel = tr.filter(x => x.price_bnb > 0);
    if (!rel.length) { console.log(`${tk.slice(0, 10)} 无可靠价`); continue; }
    const first = rel[0].price_bnb; let max = 0, maxT = '';
    for (const x of rel) if (x.price_bnb > max) { max = x.price_bnb; maxT = x.block_time; }
    const last = rel[rel.length - 1];
    const aMs = new Date(r.t).getTime();
    let a30 = null; for (const x of rel) { if (new Date(x.block_time).getTime() <= aMs + 30 * 60000) a30 = x; else break; }
    console.log(`${tk.slice(0, 10)} rows=${tr.length} 首价=${first.toExponential(3)} @${rel[0].block_time.slice(11, 19)} 峰值=+${((max / first - 1) * 100).toFixed(0)}% @${maxT.slice(11, 19)} 买点+30min=${a30 ? ((a30.price_bnb / first - 1) * 100).toFixed(0) + '%' : '?'} 末价=${((last.price_bnb / first - 1) * 100).toFixed(0)}% @${last.block_time.slice(11, 19)}`);
  }
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
