#!/usr/bin/env node
/**
 * 一次性查看（review 辅助，不进 git）：argv[2]=地址（必填）argv[3]=逐笔窗口 N（缺省 90）。
 * 全量行数+meta+trades+逐笔时序+三档锚摘要钱包表。182 跑。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/trading-engine/pre-check/cheat-snapshot.js');
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = String(process.argv[2] || '').toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(ADDR)) { console.error('用法: node tmp-view.mjs <addr> [viewN]'); process.exit(2); }
const VIEW_N = Number(process.argv[3] || 90);
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
console.log('trades:', JSON.stringify(tr));

const t0 = Date.parse(meta.createdAt);
const short = (w) => (w ? w.slice(0, 6) + '…' + w.slice(-4) : '?');
const creatorLc = (meta.creatorAddress || '').toLowerCase();

console.log(`\n=== 前 ${Math.min(VIEW_N, rows.length)} 笔逐笔 ===`);
rows.slice(0, VIEW_N).forEach((r, i) => {
  const dt = ((Date.parse(r.block_time) - t0) / 1000).toFixed(1);
  const side = r.trade_type === 'buy' ? 'BUY ' : 'SELL';
  const w = (r.sender_address || r.trader_address || '').toLowerCase();
  console.log(`#${i + 1} t+${dt}s ${side} ${Number(r.bnb_amount).toFixed(4)} @${Number(r.price_bnb).toExponential(3)} w=${short(w)}${w === creatorLc ? '(creator)' : ''} blk=${r.block_number}${r.price_outlier ? ' OUT' : ''}`);
});

for (const N of [40, 60, 90]) {
  if (rows.length < N) break;
  const snap = buildSnapshotFromRows(rows.slice(0, N), meta, { capped: false, anchorTickCount: N });
  const d = snap.derived;
  console.log(`\n@锚${N}: 买${d.totalBuyBnb.toFixed(3)}/${d.buyN} 卖${d.totalSellBnb.toFixed(3)}/${d.sellN} 钱包${d.walletCount} top1=${d.top1BuyPct?.toFixed(1)}% top2=${d.top2BuyPct?.toFixed(1)}% churn${d.churn60sWalletCount} 同块${d.sameBlockClusters.length} 等额${d.equalClusters.length} router${d.routerPct?.toFixed(1)}%`);
  const ws = [...snap.wallets].sort((a, b) => b.buyBnb - a.buyBnb).slice(0, 10);
  for (const w of ws) {
    console.log(`  ${short(w.w)} 买${w.buyBnb.toFixed(4)}(${w.buyN}) 卖${w.sellBnb.toFixed(4)}(${w.sellN})${w.w === creatorLc ? ' ←creator' : ''}`);
  }
}
