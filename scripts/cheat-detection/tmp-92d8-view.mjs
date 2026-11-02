#!/usr/bin/env node
/**
 * 一次性查看（0x92d8…7777 review 辅助，不进 git）：全量行数+早期逐笔时序+钱包表。
 * 用户裁定=作弊盘（一买四卖+随后协同入场）；本票不在 aed2091d 基线（无成功买入），
 * 输出供选 --add 锚。182 跑。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/trading-engine/pre-check/cheat-snapshot.js');
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x92d82b1d8951358b02d917c8afd19f179c277777';
const VIEW_N = 90; // 早期逐笔窗口
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

const sb = dbManager.getClient();
const { data, error } = await sb.from('wss_price_ticks')
  .select(TICK_COLS).eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true })
  .limit(3001);
if (error) throw new Error(error.message);
const rows = data ?? [];
console.log(`全量行数=${rows.length}${rows.length > 3000 ? '（超帽截断）' : ''}`);

const { data: evs } = await sb.from('wss_events')
  .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR)
  .order('id', { ascending: true }).limit(5);
const hit = (evs ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
const meta = {
  address: ADDR, symbol: hit?.payload?.symbol ?? null, name: hit?.payload?.name ?? null,
  platform: hit?.platform ?? null,
  createdAt: hit?.payload?.blockTimeMs ? new Date(hit.payload.blockTimeMs).toISOString() : hit?.block_time ?? null,
  creatorAddress: hit?.payload?.creator ?? null, quoteToken: null,
};
console.log(`meta: symbol=${meta.symbol} creator=${meta.creatorAddress} createdAt=${meta.createdAt}`);

const { data: tr } = await sb.from('trades')
  .select('experiment_id,trade_direction,success,created_at').eq('token_address', ADDR).limit(10);
console.log('trades（为何不在基线）:', JSON.stringify(tr));

const t0 = Date.parse(meta.createdAt);
const short = (w) => (w ? w.slice(0, 6) + '…' + w.slice(-4) : '?');

console.log(`\n=== 前 ${Math.min(VIEW_N, rows.length)} 笔逐笔 ===`);
rows.slice(0, VIEW_N).forEach((r, i) => {
  const dt = ((Date.parse(r.block_time) - t0) / 1000).toFixed(1);
  const side = r.trade_type === 'buy' ? 'BUY ' : 'SELL';
  const w = short((r.sender_address || r.trader_address || '').toLowerCase());
  console.log(`#${i + 1} t+${dt}s ${side} ${Number(r.bnb_amount).toFixed(4)} @${Number(r.price_bnb).toExponential(3)} w=${w}${(r.sender_address || r.trader_address || '').toLowerCase() === (meta.creatorAddress || '').toLowerCase() ? '(creator)' : ''} blk=${r.block_number}`);
});

for (const N of [40, 60, 90]) {
  if (rows.length < N) break;
  const snap = buildSnapshotFromRows(rows.slice(0, N), meta, { capped: false, anchorTickCount: N });
  const d = snap.derived;
  console.log(`\n@锚${N}: 买${d.totalBuyBnb.toFixed(3)}/${d.buyN} 卖${d.totalSellBnb.toFixed(3)}/${d.sellN} 钱包${d.walletCount} top1=${d.top1BuyPct?.toFixed(1)}% churn${d.churn60sWalletCount} 同块${d.sameBlockClusters.length} 等额${d.equalClusters.length}`);
  const ws = [...snap.wallets].sort((a, b) => b.buyBnb - a.buyBnb).slice(0, 8);
  for (const w of ws) {
    console.log(`  ${short(w.w)} 买${w.buyBnb.toFixed(4)}(${w.buyN}) 卖${w.sellBnb.toFixed(4)}(${w.sellN})${w.w === (meta.creatorAddress || '').toLowerCase() ? ' ←creator' : ''}`);
  }
}
