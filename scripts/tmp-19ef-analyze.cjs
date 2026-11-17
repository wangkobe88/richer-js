// bt-v134 (19ef6433) 因子过滤角度归因：trades per-token 净额 + signals 拒因分布
const { dbManager } = require('../src/services/dbManager.js');
const EXP = '19ef6433-0c92-47ff-a6fd-9f6bea745b8d';
async function main() {
  const c = await dbManager.getClient();
  // 1) trades per-token 净额（BNB 域）
  const { data: rows } = await c.from('trades')
    .select('token_address,token_symbol,trade_direction,input_currency,input_amount,output_currency,output_amount,success,created_at')
    .eq('experiment_id', EXP).range(0, 999);
  const m = new Map();
  for (const t of rows || []) {
    if (t.success === false) continue;
    const buy = t.trade_direction === 'buy';
    const v = buy ? (t.input_currency === 'BNB' ? Number(t.input_amount || 0) : Number(t.output_amount || 0))
      : (t.output_currency === 'BNB' ? Number(t.output_amount || 0) : Number(t.input_amount || 0));
    let e = m.get(t.token_address);
    if (!e) { e = { sym: t.token_symbol, buyBnb: 0, sellBnb: 0, firstBuy: t.created_at }; m.set(t.token_address, e); }
    if (buy) { e.buyBnb += v; if (t.created_at < e.firstBuy) e.firstBuy = t.created_at; } else e.sellBnb += v;
  }
  const nets = [...m.entries()].map(([addr, e]) => ({ addr, ...e, net: e.sellBnb - e.buyBnb }))
    .sort((a, b) => a.net - b.net);
  const tot = nets.reduce((s, x) => s + x.net, 0);
  const win = nets.filter((x) => x.net > 0).length;
  console.log(`== trades：${nets.length} 票，净额 ${tot >= 0 ? '+' : ''}${tot.toFixed(4)} BNB，胜率 ${win}/${nets.length}（${(win / nets.length * 100).toFixed(1)}%）==`);
  console.log('-- 亏损票（net<0）--');
  for (const x of nets.filter((n) => n.net < 0)) console.log(`${x.net.toFixed(4)}  ${x.sym}  ${x.addr}  ${x.firstBuy}`);
  console.log('-- 盈利票 top15 --');
  for (const x of nets.filter((n) => n.net > 0).slice(-15).reverse()) console.log(`+${x.net.toFixed(4)}  ${x.sym}  ${x.addr}`);

  // 2) signals 分布
  const { data: sigs } = await c.from('strategy_signals')
    .select('id,status,signal_type,action,reason,token_address,created_at,metadata')
    .eq('experiment_id', EXP).range(0, 999);
  const { data: sigs2 } = await c.from('strategy_signals')
    .select('id,status,signal_type,action,reason,token_address,created_at,metadata')
    .eq('experiment_id', EXP).range(1000, 1999);
  const { data: sigs3 } = await c.from('strategy_signals')
    .select('id,status,signal_type,action,reason,token_address,created_at,metadata')
    .eq('experiment_id', EXP).range(2000, 2999);
  const all = [...(sigs || []), ...(sigs2 || []), ...(sigs3 || [])];
  console.log(`\n== signals ${all.length} 行 ==`);
  const byStatus = new Map();
  for (const s of all) byStatus.set(`${s.status}|${s.signal_type}`, (byStatus.get(`${s.status}|${s.signal_type}`) || 0) + 1);
  for (const [k, v] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`${k}: ${v}`);
  // 失败 BUY 信号的拒因分布
  const failReasons = new Map();
  for (const s of all) {
    if (s.signal_type !== 'BUY' || s.status === 'success') continue;
    const md = s.metadata || {};
    const r = md.failureReason || md.reason || s.reason || md.blockedReason || '(no reason key)';
    failReasons.set(r, (failReasons.get(r) || 0) + 1);
  }
  console.log('-- 失败 BUY 拒因分布 --');
  for (const [k, v] of [...failReasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`${v}\t${k}`);
  // 打印一行 failed BUY 的 metadata 顶层键（确认结构）
  const f = all.find((s) => s.signal_type === 'BUY' && s.status !== 'success');
  if (f) console.log('\nsample failed BUY metadata keys:', Object.keys(f.metadata || {}).join(','));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(1); });
