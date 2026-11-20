// T189 sbw 资格线净效果对拍：confirmed 保住的卖面 vs unconfirmed 挡掉的卖面
const { dbManager } = require('../src/services/dbManager');
const EXP = '2bdf98ab-d85f-40fa-84b5-d79099e1006c';
async function main() {
  const sb = dbManager.getClient();
  const { data: sells } = await sb.from('strategy_signals').select('token_address,created_at,metadata,reason')
    .eq('experiment_id', EXP).eq('signal_type', 'SELL').like('reason', 'burst%').order('created_at');
  const toks = [...new Set((sells || []).map(s => s.token_address))];
  const { data: buys } = await sb.from('strategy_signals').select('token_address,created_at,metadata')
    .eq('experiment_id', EXP).eq('signal_type', 'BUY').in('token_address', toks).order('created_at');
  const buyMeta = new Map();
  for (const b of buys || []) {
    const m = b.metadata || {};
    buyMeta.set(b.token_address, { sbw: m.cheatCheck?.levels?.stallBurstWave ?? null, afSbw: m.actFrontGate?.sbw ?? null });
  }
  const rows = [];
  for (const s of sells || []) {
    const b = buyMeta.get(s.token_address) || {};
    const confirmed = b.sbw === 1 || b.afSbw === 'burst';
    // 卖时刻前后 ticks：卖前最后可靠价 + 卖后15min maxRel
    const t0 = new Date(Date.parse(s.created_at) - 5000).toISOString();
    const t1 = new Date(Date.parse(s.created_at) + 15 * 60000).toISOString();
    const { data: ticks } = await sb.from('wss_price_ticks')
      .select('block_time,price_bnb,price_outlier').eq('token_address', s.token_address)
      .gte('block_time', t0).lte('block_time', t1).order('block_time').limit(500);
    let pre = null, post = 0;
    for (const tk of ticks || []) {
      if (tk.price_outlier) continue;
      const before = Date.parse(tk.block_time) <= Date.parse(s.created_at);
      if (before) pre = tk.price_bnb;
      else if (pre && tk.price_bnb > post) post = tk.price_bnb;
    }
    const risePct = pre && post ? (post / pre - 1) * 100 : null;
    rows.push({ tok: s.token_address.slice(0, 10), confirmed, risePct, pre, post });
    console.log(rows.length, s.token_address.slice(0, 10), confirmed ? '[sbw✓]' : '[sbw✗]', 'rise15m=', risePct === null ? 'n/a' : risePct.toFixed(1) + '%');
  }
  for (const confirmed of [true, false]) {
    const g = rows.filter(r => r.confirmed === confirmed && r.risePct !== null);
    const all = rows.filter(r => r.confirmed === confirmed);
    const hurt = g.filter(r => r.risePct > 5), saved = g.filter(r => r.risePct <= 0);
    console.log(`\n== ${confirmed ? 'sbw 确认(资格线保住)' : 'sbw 未确认(资格线挡掉)'}: ${all.length} 笔（有走势 ${g.length}）`);
    console.log(`   卖后>5%=${hurt.length} 笔（误伤面） 卖后≤0%=${saved.length} 笔（止血面） 中位涨幅=${g.length ? (g.map(r => r.risePct).sort((a, b) => a - b)[Math.floor(g.length / 2)]).toFixed(1) + '%' : 'n/a'}`);
    console.log(`   明细: ${g.map(r => r.tok + (r.risePct > 0 ? '+' : '') + r.risePct.toFixed(0) + '%').join(' ')}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
