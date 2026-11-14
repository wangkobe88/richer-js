// 一次性（182 跑）：bt-v100（11fc182a）T133 四条读数——净盈亏/成交票 vs bt-v96 基线（+0.9421/57）；
// t0 6 笔臂+maxTriggers 2 两次 Jev 形态；28.5 域新成交（fire 因子 curVs∈(27.5,28.5]）；
// actTotalBnb 门/两新卖臂触发；门链漏斗。
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '11fc182a-b051-4665-857c-5c14e6713334';
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '-');
const parse = (m) => { try { return typeof m === 'string' ? JSON.parse(m) : (m || {}); } catch { return {}; } };

async function pullAll(c, table, cols) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await c.from(table).select(cols).eq('experiment_id', EXP).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

(async () => {
  const c = await dbManager.getClient();
  const sigs = await pullAll(c, 'strategy_signals', 'id,token_address,token_symbol,signal_type,created_at,metadata');
  const trades = await pullAll(c, 'trades', 'id,token_address,token_symbol,trade_direction,input_amount,output_amount,unit_price,created_at,signal_id,metadata');
  console.log(`===== bt-v100（T133 四条+库 v17+BP69 28.5）=====`);
  console.log(`信号 ${sigs.length} 行 | trades ${trades.length} 行`);

  // ===== 门链漏斗 + 腿分布 =====
  const byType = {}, byStatus = {}, byLeg = {}, cheatGrades = {}, bpRules = {};
  const p1Signals = new Map(); // t0 腿（P1）per-token 信号数 → maxTriggers 2 形态
  for (const s of sigs) {
    byType[s.signal_type] = (byType[s.signal_type] || 0) + 1;
    const m = parse(s.metadata);
    byStatus[m.execution_status || 'null'] = (byStatus[m.execution_status] || 0) + 1;
    if (s.signal_type === 'BUY') {
      const leg = m.strategyName || m.strategyId || '?';
      byLeg[leg] = (byLeg[leg] || 0) + 1;
      if (/P1/.test(String(leg))) {
        if (!p1Signals.has(s.token_address)) p1Signals.set(s.token_address, []);
        p1Signals.get(s.token_address).push({ at: s.created_at, status: m.execution_status });
      }
      const cc = m.cheatCheck; const g = cc && cc.grade ? cc.grade + (cc.exempt ? '(豁免←' + cc.exempt.originalGrade + ')' : '') : (cc ? (cc.status || 'no-grade') : '无段');
      cheatGrades[g] = (cheatGrades[g] || 0) + 1;
      const bp = m.buyPoint; const a = bp && bp.assessment;
      if (a && a.rule) bpRules[a.rule] = (bpRules[a.rule] || 0) + 1;
    }
  }
  console.log('signal_type:', JSON.stringify(byType));
  console.log('execution_status:', JSON.stringify(byStatus));
  console.log('BUY 腿分布:', JSON.stringify(byLeg, null, 0));
  console.log('cheat grade:', JSON.stringify(cheatGrades, null, 0));
  console.log('BP rule:', JSON.stringify(bpRules, null, 0));

  // t0 maxTriggers=2 形态
  const two = [...p1Signals.entries()].filter(([, l]) => l.length >= 2);
  console.log(`\n===== t0 腿（P1）maxTriggers 2 形态：${two.length} 票出 ≥2 信号 =====`);
  for (const [tok, l] of two.slice(0, 15))
    console.log(`  ${short(tok)}: ${l.map((x) => x.status).join(' → ')} @${l.map((x) => String(x.at).slice(11, 19)).join(',')}`);

  // ===== 28.5 域新成交（fire 因子 curVs）=====
  const sigById = new Map(sigs.map((s) => [s.id, s]));
  const band = [];
  for (const s of sigs) {
    if (s.signal_type !== 'BUY') continue;
    const m = parse(s.metadata);
    const tf = m.trendFactors || {};
    const cv = tf.currentVsLaunchPct;
    if (cv != null && cv > 27.5 && cv <= 28.5) band.push({ tok: s.token_address, sym: s.token_symbol, cv, status: m.execution_status, at: s.created_at });
  }
  console.log(`\n===== 28.5 域（curVs∈(27.5,28.5]）BUY 信号：${band.length} 行 =====`);
  for (const b of band) console.log(`  ${b.sym || short(b.tok)} curVs=${b.cv} ${b.status} @${String(b.at).slice(11, 19)}`);

  // ===== trades episode 盈亏 =====
  const sigNameById = new Map(); // signalId → strategyName（卖臂归因真源）
  for (const s of sigs) {
    const m = parse(s.metadata);
    if (m.strategyName) sigNameById.set(s.id, m.strategyName);
  }
  const perTok = new Map();
  for (const t of trades) {
    if (!perTok.has(t.token_address)) perTok.set(t.token_address, []);
    perTok.get(t.token_address).push(t);
  }
  const eps = [];
  const armCount = { famous: 0, lowzone: 0 };
  const armRows = [];
  for (const [tok, list] of perTok) {
    let buyBnb = 0, sellBnb = 0, nb = 0, ns = 0;
    for (const t of list) {
      const isBuy = /buy|买入/i.test(t.trade_direction || '');
      const m = parse(t.metadata);
      const legName = m.signalId ? (sigNameById.get(m.signalId) || '?') : '?';
      if (!isBuy && /famous/i.test(legName)) { armCount.famous++; armRows.push(`${t.token_symbol || short(tok)} famous-entry-exit`); }
      if (!isBuy && /low-zone|low_zone|lowzone/i.test(legName)) { armCount.lowzone++; armRows.push(`${t.token_symbol || short(tok)} low-zone-stall-exit`); }
      const bnb = isBuy ? Number(t.input_amount ?? 0) : Number(t.output_amount ?? 0);
      if (isBuy) { buyBnb += bnb; nb++; } else { sellBnb += bnb; ns++; }
    }
    eps.push({ tok, sym: list[0].token_symbol, nb, ns, buyBnb, sellBnb, pnl: Number((sellBnb - buyBnb).toFixed(4)) });
  }
  eps.sort((a, b) => a.pnl - b.pnl);
  const tot = eps.reduce((s2, e) => s2 + e.pnl, 0);
  const win = eps.filter((e) => e.pnl > 0).length;
  console.log(`\n===== 成交 ${eps.length} 票 | 合计 PnL ${tot >= 0 ? '+' : ''}${tot.toFixed(4)} BNB | 盈利 ${win}/${eps.length} =====`);
  console.log('最差 8:', eps.slice(0, 8).map((e) => `${e.sym || short(e.tok)}${e.pnl >= 0 ? '+' : ''}${e.pnl}`).join('  '));
  console.log('最好 8:', eps.slice(-8).map((e) => `${e.sym || short(e.tok)}${e.pnl >= 0 ? '+' : ''}${e.pnl}`).join('  '));
  console.log(`新卖臂触发（signalId→strategyName 归因）：famous-entry-exit=${armCount.famous} low-zone-stall-exit=${armCount.lowzone}`);
  for (const r of armRows) console.log('  ' + r);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
