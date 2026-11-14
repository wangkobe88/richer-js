// tmp 探针：noBuySellWallets（零买入纯卖钱包数）分布——CD73「单钱包获利了结 vs
// 多钱包分发」刀可行性（L 通道加钱包数维度的反例验证：纯 L 通道票 CD13/CD56/CD119
// 须 ≥2 才不翻案）。182 跑；口径=runner 同款（锚窗前 anchorN 笔 + buildSnapshotFromRows）。
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const { dbManager } = require_(resolve(HERE, '../../src/services/dbManager.js'));
const { buildSnapshotFromRows } = require_(resolve(HERE, '../../src/market-analysis/cheat-snapshot.js'));

const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';

const TARGETS = ['CD73', 'CD13', 'CD56', 'CD119', 'CD93', 'CD118', 'CD5', 'CD80', 'CD123', 'CD71', 'CD108', 'CD126'];

const fx = JSON.parse(readFileSync(resolve(HERE, 'fixtures.json'), 'utf8'));
const cases = Object.values(fx).find((v) => Array.isArray(v));
const byId = new Map(cases.map((c) => [c.caseId, c]));

for (const cid of TARGETS) {
  const c = byId.get(cid);
  if (!c) { console.log(cid, '缺 fixtures 条目'); continue; }
  const { data, error } = await dbManager.getClient().from('wss_price_ticks')
    .select(TICK_COLS)
    .eq('token_address', c.addr)
    .order('block_number', { ascending: true })
    .order('log_index', { ascending: true })
    .limit(3000);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const n = c.anchor.tickCount;
  if (rows.length < n) { console.log(cid, c.symbol, '锚窗不足', rows.length, '/', n); continue; }
  const snap = buildSnapshotFromRows(rows.slice(0, n), {
    address: c.addr, symbol: c.symbol, name: null, platform: c.platform,
    createdAt: null, creatorAddress: null, createTxHash: null, totalSupply: null,
    quoteToken: rows.find((r) => r.quote_token)?.quote_token ?? null,
  }, { capped: false, anchorTickCount: n });
  const d = snap.derived;
  console.log(cid, (c.symbol || '').padEnd(14), '纯卖%', String(d.noBuySellPct).padStart(5), '钱包数', d.noBuySellWallets, '纯卖额', (d.noBuySellBnb ?? 0).toFixed(3), '总卖', (d.totalSellBnb ?? 0).toFixed(3), '| grade 通道记忆：', (c.expectBecause || '').match(/unhealthy\[[^\]]*\]|cheat\[[^\]]*\]/)?.[0] ?? '-');
}
process.exit(0);
