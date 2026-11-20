const { dbManager } = require('../src/services/dbManager');

async function scan(sb, expId, label) {
  const { data: buys } = await sb.from('trades')
    .select('token_address,input_amount,token_symbol').eq('experiment_id', expId)
    .eq('trade_direction', 'buy').eq('trade_status', 'success').limit(1000);
  const { data: sells } = await sb.from('trades')
    .select('token_address,output_amount').eq('experiment_id', expId)
    .eq('trade_direction', 'sell').eq('trade_status', 'success').limit(2000);
  const sym = new Map(), buyIn = new Map(), sellOut = new Map();
  for (const b of buys || []) { sym.set(b.token_address, b.token_symbol); buyIn.set(b.token_address, (buyIn.get(b.token_address) || 0) + Number(b.input_amount)); }
  for (const s of sells || []) sellOut.set(s.token_address, (sellOut.get(s.token_address) || 0) + Number(s.output_amount));
  const tokens = [...new Set((buys || []).map(b => b.token_address))];

  // 全部 executed BUY 信号（per token 取全部，用于算「该票是否有 >120s 的成交信号」）
  const { data: sigs } = await sb.from('strategy_signals')
    .select('created_at,token_address,metadata')
    .eq('experiment_id', expId).eq('signal_type', 'BUY')
    .order('created_at', { ascending: true }).limit(2500);
  const execSigs = new Map(); // token -> [{ts}]
  for (const s of sigs || []) {
    if (!tokens.includes(s.token_address)) continue;
    if ((s.metadata || {}).execution_status !== 'executed') continue;
    if (!execSigs.has(s.token_address)) execSigs.set(s.token_address, []);
    execSigs.get(s.token_address).push(new Date(s.created_at).getTime());
  }

  // 首成交信号 age（信号时刻 − 首 tick）
  const rows = [];
  for (const t of tokens) {
    const es = execSigs.get(t) || [];
    const pnl = (sellOut.get(t) || 0) - (buyIn.get(t) || 0);
    if (!es.length) { rows.push({ t, sym: sym.get(t), pnl: +pnl.toFixed(4), age: null, lateSig: false }); continue; }
    const { data: tk } = await sb.from('wss_price_ticks')
      .select('block_time').eq('token_address', t).gt('block_number', 0)
      .order('block_number', { ascending: true }).limit(1);
    if (!tk || !tk[0]) { rows.push({ t, sym: sym.get(t), pnl: +pnl.toFixed(4), age: null, lateSig: false }); continue; }
    const t0 = new Date(tk[0].block_time).getTime();
    const age = (Math.min(...es) - t0) / 1000;
    rows.push({ t, sym: sym.get(t), pnl: +pnl.toFixed(4), age: +age.toFixed(0), lateSig: es.some(x => (x - t0) / 1000 > 120) });
  }

  console.log(`\n########## ${label}: ${tokens.length} 票 ##########`);
  const bands = [
    ['首成交 age ≤ 60s ', r => r.age !== null && r.age <= 60],
    ['首成交 age 61-90 ', r => r.age !== null && r.age > 60 && r.age <= 90],
    ['首成交 age 91-120', r => r.age !== null && r.age > 90 && r.age <= 120],
    ['首成交 age > 120  ', r => r.age !== null && r.age > 120],
    ['61-120 无后续>120 成交信号', r => r.age !== null && r.age > 60 && r.age <= 120 && !r.lateSig],
  ];
  for (const [name, f] of bands) {
    const sub = rows.filter(f);
    if (!sub.length) { console.log(`${name}: 0`); continue; }
    const tot = sub.reduce((a, r) => a + r.pnl, 0);
    const neg = sub.filter(r => r.pnl < 0), pos = sub.filter(r => r.pnl > 0);
    console.log(`${name}: ${sub.length} 票 Σ=${tot.toFixed(3)} 负${neg.length}Σ${neg.reduce((a,r)=>a+r.pnl,0).toFixed(3)} 正${pos.length}${pos.length?'Σ+'+pos.reduce((a,r)=>a+r.pnl,0).toFixed(3):''}`);
  }
  console.log('-- 61~120s 且无 >120s 成交信号的全列（推迟门收紧的真实拦截面）:');
  for (const r of rows.filter(r => r.age !== null && r.age > 60 && r.age <= 120 && !r.lateSig).sort((a, b) => a.pnl - b.pnl))
    console.log(`   ${r.t.slice(0, 10)} ${String(r.sym).slice(0, 12).padEnd(12)} age=${r.pnl < 0 ? '' : ''}${r.age}s pnl=${r.pnl}`);
}

async function main() {
  const sb = dbManager.getClient();
  await scan(sb, 'b8ae9f2e-832f-42db-bbda-8d8701aecb63', 'bt-v156 48h win1019（主案窗）');
  await scan(sb, 'd3453504-03d5-480c-89e0-483db930361c', 'bt-v153 36h win1012');
  await scan(sb, '8ebaccce-62c6-4209-a2a0-40f361c49bf9', 'bt-v150 36h win1012 (v32)');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
