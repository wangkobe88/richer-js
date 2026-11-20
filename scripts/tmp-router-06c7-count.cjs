require('dotenv').config({ path: 'config/.env' });
const { dbManager } = require('../src/services/dbManager');
const { AGGREGATOR_ROUTER_ADDRS } = require('../src/trading-engine/pre-check/aggregator-routers');
async function main() {
  const routers = new Set([...AGGREGATOR_ROUTER_ADDRS].map(a => a.toLowerCase()));
  console.log('router 址数:', routers.size);
  const sb = dbManager.getClient();
  const { data } = await sb.from('wss_price_ticks')
    .select('block_time,trade_type,trader_address,bnb_amount')
    .eq('token_address', '0x06c78718d19d9a19721d4794f80606976e428888')
    .lte('block_time', '2026-10-04T18:15:53Z')
    .order('block_time').limit(500);
  const buys = (data || []).filter(t => t.trade_type === 'buy');
  const viaRouter = buys.filter(t => routers.has((t.trader_address || '').toLowerCase()));
  console.log(`锚窗(全窗 G17 口径): 总买 ${buys.length} 笔, 走路由 ${viaRouter.length} 笔, count 占比 ${buys.length ? (viaRouter.length / buys.length * 100).toFixed(1) : 'n/a'}%`);
  // G17 fail-open 线: 买 <15 笔不评
  console.log('G17 ROUTER_ENTRY_MIN_BUYS=15 →', buys.length < 15 ? 'fail-open 不评(<15笔)' : '已评');
  // 最近 60s 金额口径 (BP r60 同款)
  const tEnd = Date.parse('2026-10-04T18:15:53Z');
  const w60 = buys.filter(t => tEnd - Date.parse(t.block_time) <= 60000);
  const rBnb = w60.filter(t => routers.has((t.trader_address || '').toLowerCase())).reduce((s, t) => s + Number(t.bnb_amount), 0);
  const totBnb = w60.reduce((s, t) => s + Number(t.bnb_amount), 0);
  console.log(`最近60s: 买 ${w60.length} 笔 ${totBnb.toFixed(3)}B, 路由金额 ${rBnb.toFixed(4)}B, r60=${totBnb ? (rBnb / totBnb * 100).toFixed(1) : 'n/a'}%`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
