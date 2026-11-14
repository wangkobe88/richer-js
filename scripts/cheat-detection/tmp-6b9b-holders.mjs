// 一次性重放：0x6b9b…7777 锚 29 笔 snapshot——看正净持有者数与持仓分布明细
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');

const ADDR = '0x6b9b863cdd95d6986b67df7d395fca89fe247777';
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

const c = await dbManager.getClient();

const { data: rows, error: e1 } = await c.from('wss_price_ticks')
  .select(TICK_COLS).eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(29);
if (e1) throw e1;

const { data: evs, error: e2 } = await c.from('wss_events')
  .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR)
  .order('id', { ascending: true }).limit(5);
if (e2) throw e2;
const hit = (evs || []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
const p = hit ? hit.payload : {};
const meta = {
  address: ADDR, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
  createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
  creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
  totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null),
};

const snap = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: rows.length });
const d = snap.derived;

const posHolders = (snap.wallets || [])
  .map((w) => ({ ...w, netTok: (w.buyTok || 0) - (w.sellTok || 0) }))
  .filter((w) => w.netTok > 0)
  .sort((a, b) => b.netTok - a.netTok);
const posTotal = posHolders.reduce((s, w) => s + w.netTok, 0);

console.log(`symbol=${meta.symbol} platform=${meta.platform} creator=${meta.creatorAddress}`);
console.log(`锚=${rows.length} 笔 | 出场钱包=${d.walletCount} | 正净持有者数=${posHolders.length}`);
console.log(`Σ正净=${(posTotal / 1e6).toFixed(2)}M / totalSupply=${meta.totalSupply / 1e9}B`);
console.log(`top1 供/流 = ${d.top1HoldSupplyPct?.toFixed(2)}% / ${d.top1HoldCircPct?.toFixed(2)}%`);
console.log(`\n持仓分布（正净降序全部 ${posHolders.length} 个持有者）:`);
for (const w of posHolders) {
  const supplyPct = meta.totalSupply ? (w.netTok / meta.totalSupply * 100).toFixed(2) : '?';
  const circPct = posTotal > 0 ? (w.netTok / posTotal * 100).toFixed(2) : '?';
  console.log(`  ${w.w} 供${supplyPct}% 流${circPct}% 净持${(w.netTok / 1e6).toFixed(2)}M 买${(w.buyBnb || 0).toFixed(4)}×${w.buyN || 0} 卖${(w.sellBnb || 0).toFixed(4)}×${w.sellN || 0}${w.isCreator ? ' [CREATOR]' : ''}`);
}
console.log(`\nholdingsProfile(derived 前三): ${JSON.stringify(d.holdingsProfile, null, 1).slice(0, 1500)}`);
