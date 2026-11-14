// bt-v78 结果分析：CD379 豁免分布 + per-leg + 盈亏 + bt-v77 对照 + 無為救回检查
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '3172f028-56e7-4301-9d7b-b2e9c8cb5735';
const EXP77 = 'ff1c8725-e6dd-46fb-a877-43fb6f463098'; // 对照（同窗口 ladder v7 七腿无豁免）
const ANCHORS = {
  '0x92aac04f03278ce7ac82ba0367dbaf9686437777': 'BP39锚1',
  '0xb97d5772bf70814161d29243b0e39ec62f734444': '無為(语义张力票)',
  '0x24436292ae46bb4f0bdc4389d7180eaa82747777': 'BP39锚3',
  '0xc88bf78562ad5b5212dc31750a694c1cf5d17777': 'BP39锚4',
  '0x275c17eb37d8e5d4184d2f12565e4b4722727777': 'BP39锚5',
  '0xb88113c98d5e33b15925edd635170e80a0fbffff': 'BP39锚6',
  '0xbcb27c14a0faec17461cb6101810aee9fb554444': 'BP39锚7',
  '0x5a8d94c69998daffcfdc365f1d333dc4ab087777': '羊王',
};

async function pullSignals(db, exp) {
  let from = 0; const rows = [];
  for (;;) {
    const { data, error } = await db.from('strategy_signals')
      .select('token_address,token_symbol,signal_type,executed,reason,created_at,metadata')
      .eq('experiment_id', exp).order('created_at').range(from, from + 999);
    if (error) throw new Error('signals: ' + error.message);
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function tokenPnl(db, exp, addr) {
  const { data: tr, error } = await db.from('trades')
    .select('trade_direction,input_amount,output_amount')
    .eq('experiment_id', exp).eq('token_address', addr);
  if (error) throw new Error('trades: ' + error.message);
  let bnb = 0;
  for (const t of tr || []) bnb += t.trade_direction === 'sell' ? Number(t.output_amount || 0) : -Number(t.input_amount || 0);
  return { bnb, n: (tr || []).length };
}

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const rows = await pullSignals(db, EXP);
  const buys = rows.filter(r => r.signal_type === 'BUY');

  // ① 拒因分布（reason 列）+ per-leg + 豁免分布
  const reasons = {}, byLeg = {}, exemptBy = { code: {}, origGrade: {} };
  let execN = 0, exemptN = 0, exemptBoughtN = 0, noMeta = 0;
  const exemptBoughtTokens = new Set();
  for (const r of buys) {
    const k = r.reason || (r.executed ? 'executed' : '?');
    reasons[k] = (reasons[k] || 0) + 1;
    const m = r.metadata || {};
    const leg = (m.strategyName || '?').replace('买入策略 ', '');
    byLeg[leg] = byLeg[leg] || { sig: 0, buy: 0 };
    byLeg[leg].sig++;
    if (r.executed) { byLeg[leg].buy++; execN++; }
    const cc = m.cheatCheck;
    if (!cc) { noMeta++; continue; }
    if (cc.exempt) {
      exemptN++;
      exemptBy.code[cc.exempt.code] = (exemptBy.code[cc.exempt.code] || 0) + 1;
      exemptBy.origGrade[cc.exempt.originalGrade] = (exemptBy.origGrade[cc.exempt.originalGrade] || 0) + 1;
      if (r.executed) { exemptBoughtN++; exemptBoughtTokens.add(r.token_address); }
    }
  }
  console.log('== BUY 信号拒因分布（total=' + buys.length + ' 已执行=' + execN + ' 无门链meta=' + noMeta + '）');
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);
  console.log('== per-leg（P1=t0b,P2-4=t2-t4,P5-7=N30-45,P8=NL15,P9=NL20,P10=NL25）');
  for (const k of Object.keys(byLeg).sort()) console.log(`  ${k}\tsig=${byLeg[k].sig}\tbuy=${byLeg[k].buy}`);
  console.log('== CD379 豁免分布（BUY 信号上）: 计 ' + exemptN + ' 条，其中后续买入 ' + exemptBoughtN + ' 条 / ' + exemptBoughtTokens.size + ' token');
  for (const [k, v] of Object.entries(exemptBy.code)) console.log(`  code=${k}\t${v}`);
  for (const [k, v] of Object.entries(exemptBy.origGrade)) console.log(`  原判=${k}\t${v}`);

  // ② 已执行买入 token 盈亏（win/loss + 合计）
  const toks = [...new Set(buys.filter(r => r.executed).map(r => r.token_address))];
  let sum = 0, wins = 0, losses = 0;
  const tokRows = [];
  for (const t of toks) {
    const { bnb, n } = await tokenPnl(db, EXP, t);
    sum += bnb; if (bnb > 0) wins++; else losses++;
    tokRows.push({ t, bnb, n, exempt: exemptBoughtTokens.has(t) });
  }
  console.log('== 买入 token 盈亏（' + toks.length + ' token：' + wins + ' 赢 ' + losses + ' 亏）合计 ' + sum.toFixed(5) + ' BNB');
  tokRows.sort((a, b) => b.bnb - a.bnb);
  for (const x of tokRows) console.log(`  ${x.t.slice(0, 10)} ${x.bnb >= 0 ? '+' : ''}${x.bnb.toFixed(5)} (${x.n}笔${x.exempt ? ',豁免救回' : ''})`);

  // ③ bt-v77 对照（同窗口）
  const rows77 = await pullSignals(db, EXP77);
  const buys77 = rows77.filter(r => r.signal_type === 'BUY');
  const toks77 = [...new Set(buys77.filter(r => r.executed).map(r => r.token_address))];
  let sum77 = 0, wins77 = 0;
  for (const t of toks77) { const { bnb } = await tokenPnl(db, EXP77, t); sum77 += bnb; if (bnb > 0) wins77++; }
  console.log(`== 对照 bt-v77（v7 七腿无豁免）：BUY=${buys77.length} 买=${toks77.length}token 赢=${wins77} 盈亏=${sum77.toFixed(5)}`);
  console.log(`== 对照 bt-v78（v8 十腿+豁免）：BUY=${buys.length} 买=${toks.length}token 赢=${wins} 盈亏=${sum.toFixed(5)}`);
  const overlap = toks.filter(t => toks77.includes(t)).length;
  console.log(`   两轮买入重叠 token=${overlap}（bt-v78 新增=${toks.length - overlap}）`);

  // ④ 锚对照（含無為救回检查）
  console.log('== BP39 通过锚 8 token 对照');
  for (const [a, label] of Object.entries(ANCHORS)) {
    const sigA = buys.filter(r => r.token_address === a);
    const last = sigA[sigA.length - 1];
    const { bnb, n } = await tokenPnl(db, EXP, a);
    const cc = last && last.metadata && last.metadata.cheatCheck;
    const ex = cc && cc.exempt ? `豁免(${cc.exempt.code}←${cc.exempt.originalGrade})` : '';
    console.log(`  ${label} ${a.slice(0, 10)} BUY=${sigA.length} 末=${last ? (last.executed ? '已执行' : last.reason) : '无信号'} 成交=${n}笔 盈亏=${bnb.toFixed(5)} ${ex}`);
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
