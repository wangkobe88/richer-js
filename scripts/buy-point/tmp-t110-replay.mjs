// FA 直喂重放：来财/ba5e/28ad 真实 DB tick 行 → processTick → fire 时刻 buildFactorMap 读 fB
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dbManager } from '../../src/services/dbManager.js';
const require = createRequire(import.meta.url);
const FourMemeFactorAggregator = require('/home/ubuntu/richer-js/src/services/FourMemeFactorAggregator.js');
const c = await dbManager.getClient();
await FourMemeFactorAggregator.loadFamousCopyWallets();
const rosterV3 = new Set(JSON.parse(readFileSync('/home/ubuntu/richer-js/config/rosters/famous-copy-wallets.json', 'utf8')).wallets.map(w => w.toLowerCase()));
const CASES = [
  ['28ad', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444', ['2026-11-05T07:16:57Z', '2026-11-05T07:17:30Z', '2026-11-05T07:18:24Z']],
  ['来财', '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', ['2026-11-05T12:32:18Z', '2026-11-05T12:33:42Z']],
  ['ba5e', '0xba5ed45b42479e0a75316de7bf990ec90a3e4444', ['2026-11-05T07:41:10Z', '2026-11-05T07:42:34Z']],
];
for (const [tag, addr, fires] of CASES) {
  const { data: ticks, error } = await c.from('wss_price_ticks')
    .select('id, token_address, trade_type, trader_address, sender_address, price_bnb, price_usd, bnb_amount, token_amount, block_number, block_time, tx_hash, log_index, price_outlier, platform, quote_token')
    .eq('token_address', addr).gte('block_time', '2026-11-05T00:00:00Z').lt('block_time', '2026-11-05T14:00:00Z')
    .order('id', { ascending: true }).limit(6000);
  if (error) throw new Error(error.message);
  const fa = new FourMemeFactorAggregator({ factorsUpdated: false });
  fa.registerToken(addr, { platform: 'fourmeme', totalSupply: '1000000000' });
  let fireIdx = 0;
  const fireMs = fires.map(f => Date.parse(f));
  for (const row of ticks) {
    const ts = Date.parse(row.block_time);
    row.timestamp = ts;
    fa.processTick(row);
    while (fireIdx < fireMs.length && ts >= fireMs[fireIdx]) {
      const fm = fa.buildFactorMap(addr, ts);
      console.log(`${tag} fire ${fires[fireIdx].slice(11, 19)}: fB=${fm.sinceLastFamousBigBuySec} fS=${fm.recentFamousSellBnb} → HOLD=${fm.sinceLastFamousBigBuySec != null && fm.sinceLastFamousBigBuySec <= 120}`);
      fireIdx++;
    }
  }
  while (fireIdx < fireMs.length) {
    const fm = fa.buildFactorMap(addr, fireMs[fireIdx]);
    console.log(`${tag} fire ${fires[fireIdx].slice(11, 19)}: fB=${fm.sinceLastFamousBigBuySec} fS=${fm.recentFamousSellBnb}`);
    fireIdx++;
  }
}
process.exit(0);
