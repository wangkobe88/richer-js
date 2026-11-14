// tmp 探针：D3.50 样本句参数——锚窗 noBuySell 冲击口径（纯卖额÷窗口总买）实值
// （CD73/CD56/CD118/CD93/CD123 五票；182 跑；口径=runner 同款）
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_(resolve(HERE, '../../src/services/dbManager.js'));
const { buildSnapshotFromRows } = require_(resolve(HERE, '../../src/market-analysis/cheat-snapshot.js'));

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

const TARGETS = ['CD73', 'CD56', 'CD118', 'CD93', 'CD123', 'CD13', 'CD119', 'CD71', 'CD5', 'CD80', 'CD108', 'CD126'];

const fx = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const cases = Object.values(fx).find((v) => Array.isArray(v));
const byId = new Map(cases.map((c) => [c.caseId, c]));

for (const cid of TARGETS) {
  const c = byId.get(cid);
  const { data, error } = await dbManager.getClient().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', c.addr)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const n = c.anchor.tickCount;
  const snap = buildSnapshotFromRows(rows.slice(0, n), {
    address: c.addr, symbol: c.symbol, name: null, platform: c.platform,
    createdAt: null, creatorAddress: null, createTxHash: null, totalSupply: null,
    quoteToken: rows.find((r) => r.quote_token)?.quote_token ?? null,
  }, { capped: false, anchorTickCount: n });
  const d = snap.derived;
  const impact = d.totalBuyBnb > 0 ? (d.noBuySellBnb / d.totalBuyBnb * 100) : null;
  const volPct = (d.totalBuyBnb + d.totalSellBnb) > 0
    ? (d.noBuySellBnb / (d.totalBuyBnb + d.totalSellBnb) * 100) : null;
  console.log(cid, (c.symbol || '').padEnd(12),
    '钱包数', d.noBuySellWallets,
    '纯卖额', (d.noBuySellBnb ?? 0).toFixed(3),
    '总卖', (d.totalSellBnb ?? 0).toFixed(3),
    '总买', (d.totalBuyBnb ?? 0).toFixed(3),
    '占卖%', (d.noBuySellPct ?? 0).toFixed(1),
    '占买%', impact === null ? 'null' : impact.toFixed(1),
    '占总交易量%', volPct === null ? 'null' : volPct.toFixed(1));
}
process.exit(0);
