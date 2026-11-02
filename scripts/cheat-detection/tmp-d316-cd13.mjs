// D3.16 对拍追记归因探针：CD13 SAFU insider_supply_sell strong(D3.12)→moderate(D3.16)（零 Jev 配额）
// 新题面=「无买入的卖出」占比单轴（≥30% 主导性 / 10~30% 明显在场，参考），且创建者自身买卖剔除不作证据。
// 手算三口径：①全口径零买入（买入额<卖出额10%）钱包卖出占窗内总卖出比例（对齐旧 49.9% 立项数）
//           ②剔除 createTx 创建者后的同口径 ③创建者自身买卖形状对照
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const c = dbManager.getClient();

const ADDR = '0x8a182a38668979d8c0a77f3f4d49bf297b937777';
const ANCHOR = 46; // fixtures CD13 anchor.tickCount

// 1) createTx（形态对齐 Service _loadCreateMeta）
const ev = await c.from('wss_events').select('payload')
  .eq('token_address', ADDR).eq('kind', 'token_create').limit(1);
if (ev.error) throw new Error(ev.error.message);
const createTx = ev.data?.[0]?.payload?.txHash || ev.data?.[0]?.payload?.tx_hash || null;

// 2) 全量 ticks 链序
const { data, error } = await c.from('wss_price_ticks')
  .select('block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,sender_address,trader_address')
  .eq('token_address', ADDR)
  .order('block_number', { ascending: true })
  .order('log_index', { ascending: true })
  .limit(3000);
if (error) throw new Error(error.message);
const all = data ?? [];
const W = (r) => (r.sender_address || r.trader_address || '').toLowerCase();

// 3) 锚窗 per-wallet 聚合
const win = all.slice(0, ANCHOR);
const agg = new Map();
for (const r of win) {
  const w = W(r); if (!w) continue;
  const a = agg.get(w) || { buy: 0, sell: 0, buys: 0, sells: 0, txs: new Set() };
  if (r.trade_type === 'buy') { a.buy += Number(r.bnb_amount); a.buys++; }
  else { a.sell += Number(r.bnb_amount); a.sells++; }
  a.txs.add(r.tx_hash);
  agg.set(w, a);
}
const totBuy = [...agg.values()].reduce((s, a) => s + a.buy, 0);
const totSell = [...agg.values()].reduce((s, a) => s + a.sell, 0);

const creatorWallets = new Set(win.filter((r) => createTx && r.tx_hash === createTx).map(W));
const isZeroBuy = (a) => a.sell > 0 && a.buy < a.sell * 0.10;
const zw = [...agg].filter(([, a]) => isZeroBuy(a)).sort((x, y) => y[1].sell - x[1].sell);
const zSell = zw.reduce((s, [, a]) => s + a.sell, 0);
const zSellExC = zw.filter(([w]) => !creatorWallets.has(w)).reduce((s, [, a]) => s + a.sell, 0);

console.log('createTx=', createTx ? createTx.slice(0, 14) : null, '| createTx 窗内钱包=', [...creatorWallets].map((w) => w.slice(0, 10)));
console.log(`窗=${ANCHOR} 行 | 总买=${totBuy.toFixed(3)} 总卖=${totSell.toFixed(3)} | 钱包=${agg.size}`);
console.log(`①全口径零买入卖出钱包 n=${zw.length}：卖出合计=${zSell.toFixed(3)} 占窗内总卖出=${((zSell / totSell) * 100).toFixed(1)}%`);
console.log(`②剔除创建者后 n=${zw.filter(([w]) => !creatorWallets.has(w)).length}：卖出合计=${zSellExC.toFixed(3)} 占比=${((zSellExC / totSell) * 100).toFixed(1)}%`);
for (const [w, a] of zw) {
  console.log(`  ${w.slice(0, 10)} 买${a.buy.toFixed(4)}/${a.buys}笔 卖${a.sell.toFixed(4)}/${a.sells}笔 tx数=${a.txs.size}${creatorWallets.has(w) ? ' ←createTx 钱包' : ''}`);
}
for (const w of creatorWallets) {
  const a = agg.get(w);
  if (a) console.log(`[creator ${w.slice(0, 10)}] 买${a.buy.toFixed(4)}/${a.buys}笔 卖${a.sell.toFixed(4)}/${a.sells}笔`);
}
process.exit(0);
