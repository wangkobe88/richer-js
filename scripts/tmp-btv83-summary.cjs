const path = require('path'); require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager.js');
const db = dbManager.getClient();
const EXP = process.argv[2] || 'b0b3bf11-cfde-4a13-9031-1fa9269a13e3';
(async () => {
  // 1) BUY 信号全量（created_at keyset 分页防 1000 截断）
  const sigs = []; let cur = '';
  for (let p = 0; p < 30; p++) {
    let q = db.from('strategy_signals').select('created_at,token_address,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(1000);
    if (cur) q = q.gt('created_at', cur);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    sigs.push(...data); cur = data[data.length - 1].created_at;
    if (data.length < 1000) break;
  }
  // 去重（同时刻同腿同 triggerNo）
  const seen = new Set(); const rows = [];
  for (const s of sigs) { const k = `${s.created_at}|${s.metadata?.signalGate?.legId}|${s.metadata?.signalGate?.triggerNo}`; if (!seen.has(k)) { seen.add(k); rows.push(s); } }
  // 2) 漏斗
  let nExec = 0, nCheat = 0, nBp = 0, nOther = 0; const cheatGrade = {}, bpRule = {}, exemptCnt = {}, execStatus = {}, legCnt = {};
  const execTokens = new Set();
  for (const s of rows) {
    const m = s.metadata || {}; const sg = m.signalGate || {}; const cc = m.cheatCheck || {};
    const leg = sg.legId || '-'; legCnt[leg] = (legCnt[leg] || 0) + 1;
    const st = m.execution_status ?? '(null)';
    const why = String(m.execution_reason || '');
    if (cc.exempt) { const c = `${cc.exempt.code}←${cc.exempt.originalGrade}`; exemptCnt[c] = (exemptCnt[c] || 0) + 1; }
    if (st === 'executed' || st === 'success' || st === 'bought') { nExec++; execTokens.add(s.token_address); continue; }
    execStatus[st] = (execStatus[st] || 0) + 1;
    const g = cc.grade || cc.status || '-';
    if (why.includes('cheat_gate') || why.includes('cheat=')) { cheatGrade[`${g}(${why.slice(0, 40)})`] = (cheatGrade[`${g}(${why.slice(0, 40)})`] || 0) + 1; nCheat++; continue; }
    if (why.includes('bp_gate') || m.buyPoint) { const r = m.buyPoint?.assessment?.rule || why.slice(0, 50); bpRule[r] = (bpRule[r] || 0) + 1; nBp++; continue; }
    nOther++;
  }
  console.log(`BUY 信号（去重后）${rows.length} | 成交 ${nExec}（${execTokens.size} 票）| cheat 拒 ${nCheat} | BP 拒 ${nBp} | 其他/未执行 ${nOther}`);
  console.log('\n未成交 execution_status 分布:', JSON.stringify(execStatus, null, 0).slice(0, 800));
  console.log('\nBP 拒 rule 分布:', JSON.stringify(bpRule, null, 0));
  console.log('cheat 拒分布(top):', JSON.stringify(Object.fromEntries(Object.entries(cheatGrade).sort((a, b) => b[1] - a[1]).slice(0, 12)), null, 0));
  console.log('cheat 豁免分布:', JSON.stringify(exemptCnt, null, 0));
  console.log('信号腿分布:', JSON.stringify(Object.fromEntries(Object.entries(legCnt).sort((a, b) => b[1] - a[1])), null, 0));
  // 3) 分票盈亏（trade_direction 口径）
  const { data: trades, error: te } = await db.from('trades')
    .select('token_address,trade_direction,input_currency,input_amount,output_currency,output_amount,success')
    .eq('experiment_id', EXP).limit(2000);
  if (te) throw new Error(te.message);
  const by = {};
  for (const t of trades || []) {
    if (t.success === false) continue;
    by[t.token_address] = by[t.token_address] || { buy: 0, sell: 0, nB: 0, nS: 0 };
    const b = by[t.token_address];
    if (t.trade_direction === 'buy') {
      const v = t.input_currency === 'BNB' ? Number(t.input_amount || 0) : t.output_currency === 'BNB' ? Number(t.output_amount || 0) : 0;
      b.buy += v; b.nB++;
    } else if (t.trade_direction === 'sell') {
      const v = t.output_currency === 'BNB' ? Number(t.output_amount || 0) : t.input_currency === 'BNB' ? Number(t.input_amount || 0) : 0;
      b.sell += v; b.nS++;
    }
  }
  const list = Object.entries(by).map(([tk, v]) => ({ tk, net: v.sell - v.buy, ...v })).sort((a, b) => b.net - a.net);
  const pos = list.filter(r => r.net > 0.0001), neg = list.filter(r => r.net < -0.0001);
  const sP = pos.reduce((a, r) => a + r.net, 0), sN = neg.reduce((a, r) => a + r.net, 0);
  console.log(`\n成交票 ${list.length} | 盈 ${pos.length} 票 +${sP.toFixed(4)} | 亏 ${neg.length} 票 ${sN.toFixed(4)} | 平/余仓 ${list.length - pos.length - neg.length}`);
  const open = list.filter(r => r.nB > r.nS); // 买笔>卖笔=可能有余仓未清（回测终态应已全清）
  console.log(`买>卖笔数票数（疑似余仓）: ${open.length}`);
  console.log('\n== Top12 盈 =='); for (const r of pos.slice(0, 12)) console.log(`${r.tk.slice(0, 10)} net=+${r.net.toFixed(4)} (买${r.nB}×${r.buy.toFixed(3)} 卖${r.nS}×${r.sell.toFixed(3)})`);
  console.log('\n== Top12 亏 =='); for (const r of neg.slice(-12).reverse()) console.log(`${r.tk.slice(0, 10)} net=${r.net.toFixed(4)} (买${r.nB}×${r.buy.toFixed(3)} 卖${r.nS}×${r.sell.toFixed(3)})`);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
