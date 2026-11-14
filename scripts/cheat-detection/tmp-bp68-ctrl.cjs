// BP68 对照实验：只跑米+c84a（判断 act low/③ 漂移是否 BP68 引入）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const TOKENS = [
  { exp: V94, key: '米', addr: '0x338a510c6c7abd4c714d74225086542270427777', anchorIndex: 0 },
  { exp: V96, key: 'c84a', addr: '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777', anchorIndex: 1 },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V94, V96]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));
  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});
  for (const t of TOKENS) {
    const { data: sigs } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(t.anchorIndex + 1);
    const anchorMs = Date.parse(sigs[t.anchorIndex].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp68-ctrl' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} → 综=${a.bucket}(${a.rule}) pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
