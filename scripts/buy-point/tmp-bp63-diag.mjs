// BP63 诊断（182 跑）：两张翻案票 Jev 未采信新臂——打全 market_pattern answer reasons+state 痕迹行/③桶题面命中情况
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { BuyPointCheckService } = require_('../../src/market-analysis/BuyPointCheckService.js');
const { buildBuyPointSnapshot } = require_('../../src/market-analysis/buy-point-snapshot.js');
const { buildBuyPointState } = require_('../../src/market-analysis/buy-point-state-builder.js');

const V105 = '79aedc57-3493-40be-9ed0-9c067f2c2cec';
const TOKENS = [
  { key: '股股嘎嘎', addr: '0xb9dea15c7a92df7cae8657bcec876c2dc8ae4444', hint: '2026-11-05T08:14:08' },
  { key: 'FOUR米米', addr: '0x9c08bd8e1f1e6e8564e378bab47ce76d98724444', hint: '2026-11-05T09:26:29' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').eq('experiment_id', V105).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});
  for (const t of TOKENS) {
    const { data } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', V105).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(50);
    const ht = Date.parse(t.hint + 'Z');
    let best = data[0], bestD = Infinity;
    for (const r of data) { const d = Math.abs(Date.parse(r.created_at) - ht); if (d < bestD) { bestD = d; best = r; } }
    const anchorMs = Date.parse(best.created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp63-diag' }, { anchorMs });
    const d = (r.dimensions || {}).market_pattern || {};
    console.log(`\n### ${t.key} mp answer=${d.bucket}(${d.prob})`);
    console.log('  reasons=' + JSON.stringify(d.reasons || d.reason || null));
    // state 里 famous 相关关键行
    const pull = await bp._pullTicksDb(t.addr, anchorMs);
    const snap = buildBuyPointSnapshot(pull.rows, meta, { anchorMs, capped: pull.capped, anchorTickCount: pull.anchorTickCount });
    const { state } = buildBuyPointState(snap);
    for (const line of String(state).split('\n')) {
      if (line.includes('famous 痕迹') || line.includes('筹码结构')) console.log('  | ' + line.trim().slice(0, 500));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
