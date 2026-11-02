#!/usr/bin/env node
/**
 * 一次性分析（CD13 review 辅助，不进 git）：0x8a18…7777 SAFU @锚46 的钱包明细，
 * 焦点=用户指出的主导买入钱包 0xffbd…6dcc。182 跑。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { buildSnapshotFromRows } = require_('../../src/trading-engine/pre-check/cheat-snapshot.js');
const { dbManager } = require_('../../src/services/dbManager.js');

const ADDR = '0x8a182a38668979d8c0a77f3f4d49bf297b937777';
const FOCAL = '0xffbd5a03e1e936bfae82c567f8b41e0a95296dcc';
const ANCHOR = 46;
const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

const sb = dbManager.getClient();

const { data, error } = await sb.from('wss_price_ticks')
  .select(TICK_COLS).eq('token_address', ADDR)
  .order('block_number', { ascending: true }).order('log_index', { ascending: true })
  .limit(3001);
if (error) throw new Error(error.message);
const rows = data ?? [];
console.log(`全量行数=${rows.length}（${rows.length > 3000 ? '超帽截断' : '未超帽'}）`);

const { data: evs } = await sb.from('wss_events')
  .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', ADDR)
  .order('id', { ascending: true }).limit(5);
const hit = (evs ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
const meta = {
  address: ADDR, symbol: hit?.payload?.symbol ?? null, name: hit?.payload?.name ?? null,
  platform: hit?.platform ?? null,
  createdAt: hit?.payload?.blockTimeMs ? new Date(hit.payload.blockTimeMs).toISOString() : hit?.block_time ?? null,
  creatorAddress: hit?.payload?.creator ?? null,
  quoteToken: null,
};
console.log(`meta: symbol=${meta.symbol} creator=${meta.creatorAddress} createdAt=${meta.createdAt}`);

const anchored = rows.slice(0, ANCHOR);
const snapshot = buildSnapshotFromRows(anchored, meta, { capped: false, anchorTickCount: ANCHOR });

const t0 = Date.parse(meta.createdAt);

console.log('\n=== 锚内钱包表（按买入额降序 top12） ===');
const ws = [...snapshot.wallets].sort((a, b) => b.buyBnb - a.buyBnb).slice(0, 12);
for (const w of ws) {
  const tag = w.w === FOCAL ? ' ←焦点' : (w.w === meta.creatorAddress ? ' ←creator' : '');
  console.log(`${w.w} 买${w.buyBnb.toFixed(4)}(${w.buyN}笔) 卖${w.sellBnb.toFixed(4)}(${w.sellN}笔) 首买t+${w.firstBuyDt ?? '-'}s 末卖t+${w.lastSellDt ?? '-'}s${tag}`);
}

console.log('\n=== 焦点钱包 0xffbd…6dcc 全程逐笔（含锚后） ===');
for (const r of rows) {
  const w = (r.sender_address || r.trader_address || '').toLowerCase();
  if (w !== FOCAL) continue;
  const dt = ((Date.parse(r.block_time) - t0) / 1000).toFixed(1);
  const side = r.trade_type === 'buy' ? 'BUY ' : 'SELL';
  console.log(`t+${dt}s ${side} ${r.bnb_amount?.toFixed?.(4) ?? r.bnb_amount} @${r.price_bnb?.toExponential?.(3) ?? r.price_bnb} blk=${r.block_number} out=${r.price_outlier}`);
}

const beyond = rows.slice(ANCHOR);
const focalBeyond = beyond.filter((r) => (r.sender_address || r.trader_address || '').toLowerCase() === FOCAL);
console.log(`\n=== 锚后摘要 ===`);
console.log(`锚后总行数=${beyond.length}；焦点钱包锚后 买${focalBeyond.filter((r) => r.trade_type === 'buy').length}笔 卖${focalBeyond.filter((r) => r.trade_type === 'sell').length}笔 Σ卖BNB=${focalBeyond.filter((r) => r.trade_type === 'sell').reduce((s, r) => s + (r.bnb_amount || 0), 0).toFixed(4)}`);
if (beyond.length) {
  const prices = beyond.filter((r) => !r.price_outlier && r.price_bnb).map((r) => r.price_bnb);
  if (prices.length) console.log(`锚后价格: 首${prices[0].toExponential(3)} 末${prices[prices.length - 1].toExponential(3)} max=${Math.max(...prices).toExponential(3)} min=${Math.min(...prices).toExponential(3)}`);
}
