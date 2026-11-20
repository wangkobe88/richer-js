// FP27 端到端重放：真 armHolderQuietUnload 对三窗全量成交票
require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const M = require('../src/market-analysis/factor-pre-buy-check.js');
const EXPS = [
  ['w1019', '7ae8e398-c875-454a-942b-bc1accfacd53'],
  ['w1012', '8ebaccce-62c6-4209-a2a0-40f361c49bf9'],
  ['w1103', '2448116a-bebe-457d-9d8a-b4556c9a8e0d'],
];
async function load(expId) {
  const sb = dbManager.getClient();
  const { data: trades } = await sb.from('trades')
    .select('token_address,token_symbol,trade_direction,input_amount,output_amount,signal_id')
    .eq('experiment_id', expId).order('created_at', { ascending: true }).limit(500);
  const byToken = new Map();
  for (const t of trades) {
    const k = t.token_address;
    if (!byToken.has(k)) byToken.set(k, { symbol: t.token_symbol, cost: 0, got: 0, buySigId: null });
    const e = byToken.get(k);
    if (t.trade_direction === 'buy') { e.cost += Number(t.input_amount || 0); e.buySigId = t.signal_id; }
    else e.got += Number(t.output_amount || 0);
  }
  const tokens = [...byToken.entries()].map(([addr, v]) => ({ addr, symbol: v.symbol, cost: v.cost, got: v.got, pnl: v.got - v.cost, buySigId: v.buySigId }));
  const ids = tokens.map(t => t.buySigId).filter(Boolean);
  const metaById = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await sb.from('strategy_signals').select('id,metadata').in('id', ids.slice(i, i + 50));
    for (const r of data || []) metaById.set(r.id, r.metadata || {});
  }
  return tokens.map(t => ({ ...t, A: ((metaById.get(t.buySigId) || {}).buyPoint || {}).anchors || {} }));
}
(async () => {
  console.log('模块版本:', M.FACTOR_PREBUY_VERSION);
  const num = (s, k) => Number(s.A[k]);
  for (const [w, id] of EXPS) {
    const ss = await load(id);
    const hit = ss.filter(s => M.armHolderQuietUnload({ bigHolderSellBnb60: num(s, 'bigHolderSellBnb60'), athVsLaunchPct: num(s, 'athVsLaunchPct') }));
    const expect = ss.filter(s => { const b = num(s, 'bigHolderSellBnb60'), a = num(s, 'athVsLaunchPct'); return b >= 0.1 && b < 0.3 && a < 80; });
    const h = new Set(hit.map(s => s.addr)), e = new Set(expect.map(s => s.addr));
    const miss = expect.filter(s => !h.has(s.addr)), extra = hit.filter(s => !e.has(s.addr));
    // FP26 先认领的重叠面（这些票 reason 会是 FP26 不是 FP27——行为等价都拒）
    const fp26 = s => num(s, 'actNearTail5BuyN') <= 1 && num(s, 'win30SellN') >= 5;
    const overlap = hit.filter(fp26);
    console.log(`[${w}] 真模块命中 ${hit.length} | 离线口径 ${expect.length} | 漏 ${miss.length} 多 ${extra.length} | 其中 FP26 重叠(else-if 先认领) ${overlap.length}`);
    console.log(`  命中面净 pnl: ${hit.reduce((a, s) => a + s.pnl, 0).toFixed(4)}（负=止血）`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
