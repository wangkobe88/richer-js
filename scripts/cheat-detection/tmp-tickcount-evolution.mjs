#!/usr/bin/env node
/**
 * 一次性探针（不进 git）：五票（MAI+四票）逐 tickCount 累计窗的锚演化。
 * 回答：①tradeCount≥20 点位输入 vs ≥15 差多少 ②早窗是否「只有价格增长」（买卖结构）
 * 锚用 buildSnapshotFromRows 官方口径（sbHold/eqHold/纯卖/t1流）+ 买卖笔数与价格倍数。
 */
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');

const TICK_COLS = 'block_time,block_number,log_index,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const CUTS = [15, 20, 30, 40, 60, 80, 100, 150, 200, 300, 500, 1000];
const sb = dbManager.getClient();
const ADDRS = [
  ['MAI', '0x732bd5190992ecb2365e080c2d3d37880cb17777'],
  ['RAM', '0xec74ec6b297fbe318ff09da24023319a36737777'],
  ['眉眉', '0x5a3f19b5bd587c4a127096ff37f6c9d59f007777'],
  ['에코', '0x43705ac9eb429777f3d993d854a29bcd61837777'],
  ['猴子币', '0xd827bc26713cb6412f4d163766938dee3d0c7777'],
];

async function pullFull(token) {
  const { data, error } = await sb.from('wss_price_ticks')
    .select(TICK_COLS).eq('token_address', token)
    .order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(3001);
  if (error) throw new Error(error.message);
  return (data ?? []).slice(0, 3000);
}

for (const [name, addr] of ADDRS) {
  const rows = await pullFull(addr);
  const { data: evs } = await sb.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', addr).limit(1);
  const hit = (evs ?? [])[0];
  const meta = {
    address: addr, symbol: name, platform: hit?.platform ?? null,
    createdAt: hit?.block_time ?? null, creatorAddress: hit?.payload?.creator ?? null,
    totalSupply: hit?.platform === 'flap' ? 1e9 : (hit?.payload?.totalSupply ?? null),
  };
  console.log(`\n== ${name} (${rows.length} ticks) ==`);
  console.log(['tickCount'.padEnd(10), '龄s'.padEnd(6), '买/卖笔'.padEnd(9), '价格x'.padEnd(7), 'sbHold'.padEnd(7), 'eqHold'.padEnd(7), 't1流%'.padEnd(7), '纯卖%'.padEnd(7), ' wallets'.padEnd(8)].join(''));
  for (const n of CUTS) {
    if (n > rows.length) break;
    const window = rows.slice(0, n);
    const snap = buildSnapshotFromRows(window, meta, { anchorTickCount: n });
    const d = snap.derived;
    const ageS = meta.createdAt ? Math.round((Date.parse(window[window.length - 1].block_time) - Date.parse(meta.createdAt)) / 1000) : null;
    const px = window.filter((t) => t.price_bnb > 0 && !t.price_outlier).map((t) => Number(t.price_bnb));
    const mult = px.length >= 2 ? (px[px.length - 1] / px[0]).toFixed(1) : '—';
    const f = (v) => (v === null || v === undefined) ? '—' : v.toFixed(1);
    console.log([String(n).padEnd(10), String(ageS ?? '—').padEnd(6), `${d.buyN}/${d.sellN}`.padEnd(9), String(mult + 'x').padEnd(7), f(d.sameBlockHoldPct).padEnd(7), f(d.equalBandHoldPct).padEnd(7), f(d.top1HoldCircPct).padEnd(7), f(d.noBuySellPct).padEnd(7), String(d.walletCount).padEnd(8)].join(''));
  }
}
