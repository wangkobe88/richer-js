const { dbManager } = require('../src/services/dbManager');

// 三窗成交 BUY 信号（executed）→ buyPoint.anchors 买点时刻证据 × 票 pnl
async function scan(sb, expId, label) {
  const { data: buys } = await sb.from('trades')
    .select('token_address,input_amount,token_symbol,signal_id,created_at').eq('experiment_id', expId)
    .eq('trade_direction', 'buy').eq('trade_status', 'success').limit(1000);
  const { data: sells } = await sb.from('trades')
    .select('token_address,output_amount').eq('experiment_id', expId)
    .eq('trade_direction', 'sell').eq('trade_status', 'success').limit(2000);
  const sym = new Map(), buyIn = new Map(), sellOut = new Map();
  for (const b of buys || []) { sym.set(b.token_address, b.token_symbol); buyIn.set(b.token_address, (buyIn.get(b.token_address) || 0) + Number(b.input_amount)); }
  for (const s of sells || []) sellOut.set(s.token_address, (sellOut.get(s.token_address) || 0) + Number(s.output_amount));
  const firstBuySig = new Map(); // token -> signal row（首成交信号）
  const sigIds = new Set((buys || []).map(b => b.signal_id).filter(Boolean));
  const tokens = [...new Set((buys || []).map(b => b.token_address))];

  // 分页拉信号（按 token 过滤太多次——按实验拉 executed BUY 信号）
  const { data: sigs } = await sb.from('strategy_signals')
    .select('created_at,token_address,metadata')
    .eq('experiment_id', expId).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(2000);
  for (const s of sigs || []) {
    if (!s.token_address || !tokens.includes(s.token_address)) continue;
    if ((s.metadata || {}).execution_status !== 'executed') continue;
    if (!firstBuySig.has(s.token_address)) firstBuySig.set(s.token_address, s);
  }
  console.log(`\n########## ${label}: 成交 ${tokens.length} 票，取到首成交信号 ${firstBuySig.size} ##########`);

  const rows = [];
  for (const [t, s] of firstBuySig) {
    const a = (s.metadata?.buyPoint?.anchors) || null;
    const pnl = (sellOut.get(t) || 0) - (buyIn.get(t) || 0);
    if (!a) { rows.push({ t, sym: sym.get(t), pnl: +pnl.toFixed(4), noAnchor: true }); continue; }
    rows.push({
      t, sym: String(sym.get(t) || '').slice(0, 12), pnl: +pnl.toFixed(4),
      ath: a.athVsLaunchPct, maxChg5: a.maxChg5Pct, secAth: a.secSinceAth, age: a.tokenAgeSec,
      chg5: a.chg5Pct, chg30: a.chg30Pct, curVs: a.currentVsLaunchPct,
      w30net: a.win30NetBnb, w60net: a.win60NetBnb, w30buy: a.win30BuyBnb, span: a.spanSec,
    });
  }

  // 候选线分离度（域=ath≥40 ∧ curVs≤28.5，T182 域）
  const dom = r => !r.noAnchor && typeof r.ath === 'number' && r.ath >= 40 && typeof r.curVs === 'number' && r.curVs <= 28.5;
  const lines = [
    ['T182 现线 chg5<-5∧chg30<-5', r => r.chg5 < -5 && r.chg30 < -5],
    ['+win30net<=-0.5 并入(chg5腿改并)', r => (r.chg5 < -5 || (typeof r.w30net === 'number' && r.w30net <= -0.5)) && r.chg30 < -5],
    ['ath开盘峰 secAth/age>0.8 ∧ chg30<=-15', r => (r.secAth / r.age) > 0.8 && r.chg30 <= -15],
    ['开盘峰∧chg30<-15∧w30net<-0.5', r => (r.secAth / r.age) > 0.8 && r.chg30 <= -15 && typeof r.w30net === 'number' && r.w30net < -0.5],
    ['chg30<=-15 ∧ w30net<=-0.5', r => r.chg30 <= -15 && typeof r.w30net === 'number' && r.w30net <= -0.5],
  ];
  console.log('域(ath≥40∧curVs≤28.5)票数:', rows.filter(dom).length);
  for (const [name, f] of lines) {
    const sub = rows.filter(r => dom(r) && f(r));
    if (!sub.length) { console.log(`  ${name}: 0`); continue; }
    const tot = sub.reduce((a, r) => a + r.pnl, 0);
    const neg = sub.filter(r => r.pnl < 0), pos = sub.filter(r => r.pnl > 0);
    console.log(`  ${name}: ${sub.length} 票 Σ=${tot.toFixed(3)} 负${neg.length}Σ${neg.reduce((a,r)=>a+r.pnl,0).toFixed(3)} 正${pos.length}Σ${pos.length?'+':''}${pos.reduce((a,r)=>a+r.pnl,0).toFixed(3)}`);
  }
  console.log('-- 域内全列（按 pnl 升序）:');
  for (const r of rows.filter(dom).sort((a, b) => a.pnl - b.pnl))
    console.log(`   ${r.t.slice(0, 10)} ${String(r.sym).padEnd(12)} pnl=${String(r.pnl).padStart(8)} ath=${r.ath} curVs=${r.curVs} chg5=${r.chg5} chg30=${r.chg30} w30net=${r.w30net} secAth/age=${r.secAth && r.age ? (r.secAth / r.age).toFixed(2) : '?'}`);
}

async function main() {
  const sb = dbManager.getClient();
  await scan(sb, 'b8ae9f2e-832f-42db-bbda-8d8701aecb63', 'bt-v156 48h win1019（主案窗）');
  await scan(sb, 'd3453504-03d5-480c-89e0-483db930361c', 'bt-v153 36h win1012');
  await scan(sb, '8ebaccce-62c6-4209-a2a0-40f361c49bf9', 'bt-v150 36h win1012 (v32)');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
