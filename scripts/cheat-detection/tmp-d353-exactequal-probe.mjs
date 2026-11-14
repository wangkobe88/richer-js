// 一次性（182 跑）：D3.53 精确等额同块锚真实数据反例探针（零 Jev）
// RAM（同块金额各异撞块正常盘）/MAI（0.1 档 62 钱包跨块长尾）应无合格簇=null；
// 0xf5e6 立项票（@17 生产锚窗）应有 2-3 簇高占比。锚与 tmp-d341-ram-mai.mjs 同源。
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const sb = dbManager.getClient();
const TICK_COLS = 'block_time,block_number,log_index,tx_hash,trade_type,bnb_amount,token_amount,price_bnb,price_outlier,trader_address,sender_address,quote_token';
const PLANS = [
  ['RAM@41', '0xec74ec6b297fbe318ff09da24023319a36737777', 41],
  ['RAM@全窗', '0xec74ec6b297fbe318ff09da24023319a36737777', 0],
  ['MAI@全窗', '0x732bd5190992ecb2365e080c2d3d37880cb17777', 0],
  ['f5e6@17', '0xf5e642bc79bd3dff16bb02794c6854933bb57777', 17],
];
async function pull(token, n) {
  let q = sb.from('wss_price_ticks').select(TICK_COLS).eq('token_address', token).order('block_number', { ascending: true }).order('log_index', { ascending: true });
  if (n > 0) q = q.limit(n);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}
async function loadMeta(token) {
  const { data } = await sb.from('wss_events').select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', token).order('id', { ascending: true }).limit(5);
  const hit = (data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return { address: token, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null, createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null), creatorAddress: p.creator || null, totalSupply: p.totalSupply ?? ((hit && (hit.platform === 'flap' || hit.platform === 'gang')) ? 1e9 : null) };
}
function quoteOf(rows) { for (let i = rows.length - 1; i >= 0; i--) if (rows[i].quote_token) return rows[i].quote_token; return null; }
for (const [tag, addr, n] of PLANS) {
  const rows = await pull(addr, n);
  const snap = buildSnapshotFromRows(rows, { ...(await loadMeta(addr)), quoteToken: quoteOf(rows) });
  const d = snap.derived;
  const cls = d.exactEqualBlockClusters || [];
  console.log(`\n== ${tag} ${addr.slice(0, 8)}… rows=${rows.length} ==`);
  console.log(`exactEqualBlock: pct=${d.exactEqualBlockBuyPct} count=${d.exactEqualBlockClusterCount} maxWallets=${d.exactEqualBlockMaxWallets}`);
  for (const c of cls.slice(0, 5)) console.log(`  簇 块${c.block} amt=${c.amt.toFixed(4)} wallets=${c.wallets} n=${c.n} sum=${c.sumBnb.toFixed(4)} t+${c.firstDt}s`);
  const st = buildCheatState(snap).state;
  console.log(`state 行渲染: ${st.includes('精确等额同块购买') ? '在场' : '缺席'}${d.exactEqualBlockBuyPct === null ? '（正常——无合格簇反例语义）' : ''}`);
}
process.exit(0);
