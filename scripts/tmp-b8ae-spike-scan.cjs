const { dbManager } = require('../src/services/dbManager');

const EXP = 'b8ae9f2e-832f-42db-bbda-8d8701aecb63';

async function main() {
  const sb = dbManager.getClient();
  // 全部 BUY 信号（分页拉全）
  const all = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from('strategy_signals')
      .select('*')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 999);
    if (error) throw error;
    if (!data || !data.length) break;
    all.push(...data); from += 1000;
    if (data.length < 1000) break;
  }
  console.log('BUY 信号总数:', all.length);

  // trades 盈亏（per token：买入 Σin、卖出 Σout）
  const trades = new Map();
  {
    let f2 = 0;
    while (true) {
      const { data } = await sb.from('trades')
        .select('token_address,trade_direction,input_amount,output_currency,input_currency,output_amount,trade_status,success')
        .eq('experiment_id', EXP).order('created_at').range(f2, f2 + 999);
      if (!data || !data.length) break;
      for (const t of data) {
        if (!trades.has(t.token_address)) trades.set(t.token_address, { buyIn: 0, sellOut: 0, nBuy: 0, nSell: 0 });
        const o = trades.get(t.token_address);
        if (t.trade_direction === 'buy' && t.success) { o.buyIn += Number(t.input_amount); o.nBuy++; }
        if (t.trade_direction === 'sell' && t.success) { o.sellOut += Number(t.output_amount); o.nSell++; }
      }
      f2 += 1000;
      if (data.length < 1000) break;
    }
  }
  console.log('有成交的 token 数:', trades.size);

  // per token 聚合信号特征（取首条 BUY）
  const rows = [];
  const seen = new Set();
  for (const s of all) {
    if (seen.has(s.token_address)) continue;
    seen.add(s.token_address);
    const m = s.metadata || {};
    const bp = m.buyPoint || {};
    const dim = bp.dimensions || {};
    const an = bp.anchors || {};
    const cc = m.cheatCheck || {};
    const af = m.actFrontGate || {};
    rows.push({
      token: s.token_address, t: s.created_at,
      passed: bp.passed, exec: s.execution_status,
      shape: dim.entry_shape && dim.entry_shape.bucket, shapeProb: dim.entry_shape && dim.entry_shape.prob,
      pattern: dim.market_pattern && dim.market_pattern.bucket,
      act: dim.activity_level && dim.activity_level.bucket,
      holder: dim.holder_concentration && dim.holder_concentration.bucket,
      chg5: an.chg5Pct, chg30: an.chg30Pct, curVsAth: an.currentVsAthPct, curVs: an.currentVsLaunchPct,
      idle: an.actIdlePct, span: an.actSpanSec, secAth: an.secSinceAth, maxChg5: an.maxChg5Pct,
      burstN: an.burst5N, burstBnb: an.burst5BuyBnb, age: an.tokenAgeSec,
      ccGrade: cc.grade, sbw: cc.levels && cc.levels.stallBurstWave, afAct: af.act, afSbw: af.sbw,
      tvm: an.totalVolumeBnb,
    });
  }
  // 盈亏关联
  for (const r of rows) {
    const o = trades.get(r.token);
    r.pnl = o ? +(o.sellOut - o.buyIn).toFixed(4) : null;
    r.bought = !!o && o.nBuy > 0;
  }

  // 分组 1：entry_shape
  const groups = {};
  for (const r of rows) {
    const k = r.shape || '(无答案)';
    (groups[k] = groups[k] || []).push(r);
  }
  console.log('\n== entry_shape 分组 ==');
  for (const [k, g] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const bought = g.filter(r => r.bought);
    const pnl = bought.reduce((s, r) => s + (r.pnl || 0), 0);
    const win = bought.filter(r => r.pnl > 0).length;
    console.log(`${k.padEnd(14)} 信号 ${String(g.length).padStart(3)} | 成交 ${String(bought.length).padStart(3)} | pnlΣ ${pnl.toFixed(4)} | 胜 ${win}/${bought.length}`);
  }

  // spike 组明细
  console.log('\n== spike 桶成交票明细 ==');
  for (const r of rows.filter(r => r.shape === 'spike' && r.bought)) {
    console.log(`${r.token.slice(0, 10)} ${r.t} chg5=${r.chg5} curVsAth=${r.curVsAth} curVs=${r.curVs} idle=${r.idle} secAth=${r.secAth} burst=${r.burstN}w/${r.burstBnb}B age=${r.age} cc=${r.ccGrade}/sbw${r.sbw} af=${r.afAct}/${r.afSbw} pnl=${r.pnl}`);
  }
  // 全体成交票 pnl 汇总
  const allBought = rows.filter(r => r.bought);
  const totalPnl = allBought.reduce((s, r) => s + (r.pnl || 0), 0);
  console.log(`\n实验全体成交票: ${allBought.length} 票 pnlΣ=${totalPnl.toFixed(4)}`);

  // 数值形状对照：非 spike 桶但「贴顶买入」secSinceAth<=3 的票
  console.log('\n== 贴顶买入（secSinceAth<=3，任意桶）成交票 ==');
  for (const r of allBought.filter(r => r.secAth !== null && r.secAth !== undefined && r.secAth <= 3)) {
    console.log(`${r.token.slice(0, 10)} shape=${r.shape} chg5=${r.chg5} curVs=${r.curVs} secAth=${r.secAth} idle=${r.idle} pnl=${r.pnl}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
