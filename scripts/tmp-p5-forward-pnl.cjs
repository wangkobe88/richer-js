// d345 P5 六笔+bt-v150 增三笔的前向收益（卖后 15min 最高价 vs 卖价）——误伤面论证
const { dbManager } = require('../src/services/dbManager');
const CASES = [
  // [token, symbol, sellAt, sellPriceBnb(信号帧价), srcExp]
  ['0x40efb3d5dda1638a1a3926bce89a369702387777', '狸花猫', '2026-10-12T10:28:48'],
  ['0x?', 'BNCBSI', '2026-10-12T15:31:35'],
  ['0x7fce36b5f638d1cfc33b8dee09aeed236ee07777', 'BIBI', '2026-10-12T17:47:19'],
  ['0x2f17249e8d291ecb422fc5c0fc0eb313b7a57777', '熊二', '2026-10-12T18:23:49'],
  ['0x?', '熊翠花', '2026-10-12T18:32:28'],
  ['0x?', '大美', '2026-10-12T18:38:09'],
  ['0x?', 'Ritual', '2026-10-12T20:38:44'],
  ['0x?', 'Mity', '2026-10-13T07:06:05'],
  ['0x?', 'Winverse AI', '2026-10-13T11:53:30'],
];
async function main() {
  const sb = dbManager.getClient();
  // 地址从 d345 信号行反查（symbol 对齐）
  const sigs = await sb.from('strategy_signals').select('token_address,token_symbol,created_at,metadata')
    .eq('experiment_id', 'd3453504-03d5-480c-89e0-483db930361c')
    .eq('signal_type', 'SELL').limit(100);
  const bySym = {};
  for (const s of (sigs.data || [])) {
    if ((s.metadata || {}).strategyName !== '卖出策略 P5') continue;
    bySym[s.token_symbol] = { addr: s.token_address, at: s.created_at, tf: (s.metadata || {}).trendFactors || {} };
  }
  for (const [addrOrQ, sym, atHint] of CASES) {
    const c = bySym[sym];
    if (!c) { console.log(sym, ': d345 无此票（bt-v150 增量票）跳过'); continue; }
    const sellPrice = c.tf.currentPriceBnb || c.tf.currentPrice;
    if (!sellPrice) { console.log(sym, ': 卖价缺失'); continue; }
    const t0 = new Date(c.at), t1 = new Date(t0.getTime() + 15 * 60 * 1000);
    const r = await sb.from('wss_price_ticks').select('price_bnb')
      .eq('token_address', c.addr)
      .gt('block_time', c.at).lt('block_time', t1.toISOString())
      .order('block_time', { ascending: true }).limit(2000);
    const px = (r.data || []).map((x) => x.price_bnb).filter((x) => x > 0);
    if (!px.length) { console.log(sym, ': 卖后无 ticks'); continue; }
    const maxP = Math.max(...px), lastP = px[px.length - 1];
    console.log(`${sym} | 卖价 ${(sellPrice * 100).toFixed(2)}e-2 | 卖后15min峰 +${((maxP / sellPrice - 1) * 100).toFixed(1)}% | 末值 ${((lastP / sellPrice - 1) * 100).toFixed(1)}% | ${c.addr.slice(0, 10)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
