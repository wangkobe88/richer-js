// bt-v159（FP26+FP27）vs bt-v158（基底）同窗对比
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');

const OLD = '7ae8e398-c875-454a-942b-bc1accfacd53';
const NEW = 'ce102e94-293c-4f8f-af98-cd06f4b0e98c';

async function load(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(600);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else e.got += Number(t.output_amount || 0);
  }
  return [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, pnl: v.got - v.cost, cost: v.cost, buySigId: v.buySigId }));
}

(async () => {
  const sb = dbManager.getClient();
  const [o, n] = [await load(OLD), await load(NEW)];
  const sum = a => a.reduce((x, s) => x + s.pnl, 0);
  const winN = a => a.filter(s => s.pnl > 0.0005).length;
  console.log(`bt-v158（基底）: ${o.length} 票 | 净 ${sum(o).toFixed(4)} | 胜 ${winN(o)}/${o.length} (${Math.round(winN(o)/o.length*100)}%)`);
  console.log(`bt-v159（FP26+27）: ${n.length} 票 | 净 ${sum(n).toFixed(4)} | 胜 ${winN(n)}/${n.length} (${Math.round(winN(n)/n.length*100)}%)`);
  console.log(`Δ 净: ${(sum(n) - sum(o)).toFixed(4)}`);

  // 两实验票集差
  const oMap = new Map(o.map(s => [s.addr, s]));
  const nMap = new Map(n.map(s => [s.addr, s]));
  const dropped = o.filter(s => !nMap.has(s.addr));
  const added = n.filter(s => !oMap.has(s.addr));
  const both = o.filter(s => nMap.has(s.addr));
  console.log(`\n少买 ${dropped.length} 票（v158 买 v159 没买）Σpnl ${sum(dropped).toFixed(4)}：`);
  for (const s of dropped) console.log('  ✂', (s.symbol || '').slice(0, 10).padEnd(11), s.pnl.toFixed(4).padStart(7));
  console.log(`\n新增买 ${added.length} 票（v159 新买，顶上效应）Σpnl ${sum(added).toFixed(4)}：`);
  for (const s of added) console.log('  ＋', (s.symbol || '').slice(0, 10).padEnd(11), s.pnl.toFixed(4).start || s.pnl.toFixed(4));
  console.log(`\n共同持有 ${both.length} 票：v158 Σ${sum(both).toFixed(4)} → v159 Σ${both.reduce((a, s) => a + nMap.get(s.addr).pnl, 0).toFixed(4)}（Jev 方差+顶上效应）`);

  // FP26/FP27 拒因留痕（signals）
  for (const code of ['tail_no_buyer_pressure', 'holder_quiet_unload']) {
    const { count } = await sb.from('strategy_signals')
      .select('id', { count: 'exact', head: true })
      .eq('experiment_id', NEW).eq('signal_type', 'BUY')
      .like('reason', '%' + code + '%');
    const { count: c2 } = await sb.from('strategy_signals')
      .select('id', { count: 'exact', head: true })
      .eq('experiment_id', NEW).eq('signal_type', 'BUY').eq('status', 'failed')
      .like('reason', '%factor_gate_' + code + '%');
    console.log(`\nFP 拒因 ${code}: reason 含=${count || 0}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
