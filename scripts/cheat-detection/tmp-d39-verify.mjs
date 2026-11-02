// D3.9 验证：CD13/CD17 run.mjs 同链路组装 state，打印 [TOKEN] createTx 行+[TICKS] 首行+[WALLETS] 尾行（零 Jev 配额）
import { createRequire } from 'module';
const require_ = createRequire(import.meta.url);
require_('dotenv').config({ path: 'config/.env' });
const { dbManager } = require_('../../src/services/dbManager.js');
const { buildSnapshotFromRows } = require_('../../src/market-analysis/cheat-snapshot.js');
const { buildCheatState } = require_('../../src/market-analysis/cheat-state-builder.js');
const c = dbManager.getClient();

async function load(token, n) {
  const [ev, tk] = await Promise.all([
    c.from('wss_events').select('platform,payload,block_time').eq('kind', 'token_create').eq('token_address', token).order('id', { ascending: true }).limit(5),
    c.from('wss_price_ticks').select('*').eq('token_address', token).gte('block_number', 0).order('block_number', { ascending: true }).order('log_index', { ascending: true }).limit(2000),
  ]);
  const rows = (tk.data ?? []).sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index).slice(0, n);
  const hit = (ev.data ?? []).find((r) => r.payload && (r.payload.symbol || r.payload.name || r.payload.creator));
  const p = hit ? hit.payload : {};
  return { rows, meta: {
    address: token, symbol: p.symbol || null, name: p.name || null, platform: hit ? hit.platform : null,
    createdAt: p.blockTimeMs ? new Date(p.blockTimeMs).toISOString() : (hit ? hit.block_time : null),
    creatorAddress: p.creator || null, createTxHash: p.txHash || p.tx_hash || null,
  } };
}

for (const [id, addr, n] of [
  ['CD13', '0x8a182a38668979d8c0a77f3f4d49bf297b937777', 46],
  ['CD17', '0xb3566fd337409e09bb39fd7f3b4e75b783007777', 31],
]) {
  const { rows, meta } = await load(addr, n);
  const snap = buildSnapshotFromRows(rows, meta, { capped: false, anchorTickCount: n });
  const { state } = buildCheatState(snap);
  const lines = state.split('\n');
  console.log(`===== ${id} createTxHash=${(meta.createTxHash || 'NULL').slice(0, 10)} =====`);
  console.log(lines.filter((l) => l.includes('created=')).join('\n'));
  const tickLines = lines.filter((l) => /^t\+\d+s /.test(l));
  console.log('[TICKS] 首2行:\n' + tickLines.slice(0, 2).map((l) => l.slice(0, 150)).join('\n'));
  const wLines = lines.filter((l) => /^0x[0-9a-f]{4}…/.test(l));
  console.log(`[WALLETS] 共 ${wLines.length} 行，末5行（纯卖出沉底形状）:\n` + wLines.slice(-5).map((l) => l.slice(0, 160)).join('\n'));
}
