// Go Brrrrr 0xdae106c8…7777 被 pvp_zero_absorption 拦的取证（182 跑）：
// ① v131 信号行 factorCheck 完整 trace；② v129 对照（买入时刻+门链路径）；③ 拦截时刻盘面轨迹。
const { dbManager } = require('../src/services/dbManager.js');
const PRE = '0xdae106c8';

async function main() {
  const c = await dbManager.getClient();
  const { data: exps } = await c.from('experiments').select('id').limit(500);
  const e129 = exps.find((e) => e.id.startsWith('4af09d63')).id;
  const e131 = exps.find((e) => e.id.startsWith('f3dd5537')).id;
  for (const [tag, id] of [['v129', e129], ['v131', e131]]) {
    const { data: sig } = await c.from('strategy_signals')
      .select('created_at,executed,reason,er:metadata->>execution_reason,metadata')
      .eq('experiment_id', id).eq('signal_type', 'BUY')
      .ilike('token_address', PRE + '%')
      .order('created_at', { ascending: true }).limit(6);
    console.log(`\n===== ${tag} Go Brrrrr BUY 信号 ${sig ? sig.length : 0} 行 =====`);
    for (const s of sig || []) {
      const m = s.metadata || {};
      const fc = m.factorCheck;
      console.log(`${s.created_at.slice(11, 19)} exec=${s.executed} er=${m.execution_reason || '(过门链)'}`);
      if (fc) console.log('  factorCheck:', JSON.stringify({ s: fc.status, pass: fc.pass, reason: fc.reason, pvp: fc.pvp && { hit: fc.pvp.hit, branch: fc.pvp.branch }, trace: fc.trace }).slice(0, 700));
    }
  }
  // ticks 轨迹：v131 拦截时刻（08:41:44 前后 90s）
  const { data: rows } = await c.from('wss_price_ticks')
    .select('block_time,block_number,trade_type,bnb_amount,price_bnb,sender_address,trader_address')
    .ilike('token_address', PRE + '%')
    .gte('block_time', '2026-11-03T15:00:00Z').lte('block_time', '2026-11-04T14:00:00Z')
    .order('block_number', { ascending: true }).order('log_index', { ascending: true })
    .range(0, 2000);
  const win = (rows || []).filter((r) => r.block_time >= '2026-11-04T08:40:14' && r.block_time <= '2026-11-04T08:42:30');
  console.log(`\n===== ticks 08:40:14→08:42:30 共 ${win.length} 行 =====`);
  for (const r of win) {
    const w = (r.sender_address || r.trader_address || '?').slice(0, 10);
    console.log(`  ${r.block_time.slice(11, 19)} ${r.trade_type === 'buy' ? '买' : '卖'} ${Number(r.bnb_amount).toFixed(4)}B @${Number(r.price_bnb || 0).toExponential(3)} ${w}`);
  }
  // 大户持仓全貌（拦截时刻窗口末）：≥0.19 单笔钱包的买卖轨迹
  const byW = new Map();
  for (const r of rows || []) {
    if (r.block_time > '2026-11-04T08:41:45') continue;
    const w = r.sender_address || r.trader_address;
    if (!w) continue;
    let e = byW.get(w);
    if (!e) { e = { buy: 0, sell: 0, maxBuy: 0, last: '' }; byW.set(w, e); }
    if (r.trade_type === 'buy') { e.buy += Number(r.bnb_amount || 0); if (Number(r.bnb_amount || 0) > e.maxBuy) e.maxBuy = Number(r.bnb_amount || 0); }
    else e.sell += Number(r.bnb_amount || 0);
    e.last = r.block_time.slice(11, 19);
  }
  console.log('\n===== 08:41:45 前 ≥0.19 单笔钱包持仓 =====');
  for (const [w, e] of byW) {
    if (e.maxBuy < 0.19) continue;
    console.log(`  ${w.slice(0, 12)} 单笔${e.maxBuy.toFixed(3)} 买${e.buy.toFixed(3)} 卖${e.sell.toFixed(3)} 净${(e.buy - e.sell).toFixed(3)} 末动${e.last}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
