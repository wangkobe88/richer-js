// bt-v79 结果分析（=bt-v78 + v74 全量16卖腿 + BP10 insufficient_ticks 拒）：
// ① BP10 拦截效果核心对照——bt-v78 的 53 笔 insufficient_ticks 放行买入在 v79 的去向
//    （这些票 v79 全拒后，v79 买入集 vs v78 买入集差分、被拦票的 v78 盈亏合计=BP10 挽回额）
// ② 门链拒因分布 + per-leg + 豁免分布（vs v78）
// ③ v79 买入 token 盈亏 + 卡牌卖出生效检查（多笔卖出的票数——v78 1 卡退化零多卖）
// ④ 锚对照
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const EXP = '1b1f9ee3-0e9a-4fda-82de-121e968be45b'; // bt-v79
const EXP78 = '3172f028-56e7-4301-9d7b-b2e9c8cb5735'; // bt-v78 对照
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

async function tokenTrades(db, exp, addr) {
  const { data: tr, error } = await db.from('trades')
    .select('trade_direction,input_amount,output_amount,metadata')
    .eq('experiment_id', exp).eq('token_address', addr);
  if (error) throw new Error('trades: ' + error.message);
  let bnb = 0, sellN = 0;
  for (const t of tr || []) {
    if (t.trade_direction === 'sell') { bnb += Number(t.output_amount || 0); sellN++; }
    else bnb -= Number(t.input_amount || 0);
  }
  return { bnb, n: (tr || []).length, sellN };
}

(async () => {
  const { dbManager } = require('../src/services/dbManager');
  const db = dbManager.getClient();
  const [rows, rows78] = await Promise.all([pullSignals(db, EXP), pullSignals(db, EXP78)]);
  const buys = rows.filter(r => r.signal_type === 'BUY');
  const buys78 = rows78.filter(r => r.signal_type === 'BUY');

  // ① 门链拒因分布（v79）+ bp_gate_insufficient_ticks 计数
  const reasons = {}; let insuffN = 0;
  const insuffTokens = new Set();
  for (const r of buys) {
    const m = r.metadata || {};
    const es = m.execution_status, er = m.execution_reason;
    let k;
    if (r.executed) k = 'executed';
    else if (er) k = er;
    else k = r.reason || '?';
    reasons[k] = (reasons[k] || 0) + 1;
    if (er === 'bp_gate_insufficient_ticks') { insuffN++; insuffTokens.add(r.token_address); }
  }
  console.log('== v79 BUY 拒因分布（total=' + buys.length + '）');
  for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);
  console.log('  (bp_gate_insufficient_ticks 拒 ' + insuffN + ' 条 / ' + insuffTokens.size + ' token)');

  // ② BP10 核心对照：v78 买入集中走 insufficient_ticks 放行的票（从 v78 metadata 识别）
  const v78InsuffBought = new Set();
  for (const r of buys78) {
    if (!r.executed) continue;
    const bp = (r.metadata || {}).buyPoint || {};
    if (bp.status === 'insufficient_ticks' && bp.passed === true) v78InsuffBought.add(r.token_address);
  }
  const v79Bought = new Set(buys.filter(r => r.executed).map(r => r.token_address));
  const v78Bought = new Set(buys78.filter(r => r.executed).map(r => r.token_address));
  console.log('== BP10 对照：v78 insufficient_ticks 放行买入 ' + v78InsuffBought.size + ' token（53 笔口径核对）');
  let saved78 = 0, savedWin = 0;
  const savedRows = [];
  for (const t of v78InsuffBought) {
    const { bnb } = await tokenTrades(db, EXP78, t);
    saved78 += bnb; if (bnb > 0) savedWin++;
    savedRows.push({ t, bnb, inV79: v79Bought.has(t) });
  }
  savedRows.sort((a, b) => a.bnb - b.bnb);
  console.log('   这些票在 v78 的合计盈亏 = ' + saved78.toFixed(5) + ' BNB（赢 ' + savedWin + '/' + v78InsuffBought.size + '）= BP10 每 v78 形状跑一次挽回额');
  console.log('   其中 v79 仍买入（后续信号凑够 tick 重新过门）= ' + savedRows.filter(x => x.inV79).length + ' token');
  for (const x of savedRows.slice(0, 8)) console.log(`    ${x.t.slice(0, 10)} ${x.bnb >= 0 ? '+' : ''}${x.bnb.toFixed(5)} ${x.inV79 ? 'v79仍买' : 'v79全拒'}`);
  // v79 独有买入（v78 没买的）
  const only79 = [...v79Bought].filter(t => !v78Bought.has(t));
  let only79Sum = 0;
  for (const t of only79) { const { bnb } = await tokenTrades(db, EXP, t); only79Sum += bnb; }
  console.log('   v79 新增买入（v78 无）= ' + only79.length + ' token 合计 ' + only79Sum.toFixed(5) + ' BNB（阶梯接棒：门拒不消耗触发→次腿后续触发）');

  // ③ v79 盈亏 + 卡牌卖出生效检查
  const toks = [...v79Bought];
  let sum = 0, wins = 0, losses = 0, multiSell = 0, maxSell = 0;
  const tokRows = [];
  for (const t of toks) {
    const { bnb, n, sellN } = await tokenTrades(db, EXP, t);
    sum += bnb; if (bnb > 0) wins++; else losses++;
    if (sellN >= 2) multiSell++;
    if (sellN > maxSell) maxSell = sellN;
    tokRows.push({ t, bnb, n, sellN });
  }
  console.log('== v79 买入 token 盈亏（' + toks.length + ' token：' + wins + ' 赢 ' + losses + ' 亏）合计 ' + sum.toFixed(5) + ' BNB');
  console.log('   卡牌检查：卖出≥2 次的票 ' + multiSell + '/' + toks.length + '（1 卡退化下 v78=0）单票最多卖 ' + maxSell + ' 次');
  tokRows.sort((a, b) => b.bnb - a.bnb);
  for (const x of tokRows.slice(0, 6)) console.log(`    top ${x.t.slice(0, 10)} ${x.bnb >= 0 ? '+' : ''}${x.bnb.toFixed(5)} (${x.n}笔,卖${x.sellN}次)`);
  for (const x of tokRows.slice(-4)) console.log(`    bot ${x.t.slice(0, 10)} ${x.bnb >= 0 ? '+' : ''}${x.bnb.toFixed(5)} (${x.n}笔,卖${x.sellN}次)`);

  // ④ 锚对照
  console.log('== BP39 通过锚 8 token 对照（v79）');
  for (const [a, label] of Object.entries(ANCHORS)) {
    const sigA = buys.filter(r => r.token_address === a);
    const last = sigA[sigA.length - 1];
    const { bnb, n, sellN } = await tokenTrades(db, EXP, a);
    console.log(`  ${label} ${a.slice(0, 10)} BUY=${sigA.length} 末=${last ? (last.executed ? '已执行' : (last.metadata && last.metadata.execution_reason) || last.reason) : '无信号'} 成交=${n}笔 盈亏=${bnb.toFixed(5)} 卖${sellN}次`);
  }
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
