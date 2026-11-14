// 一次性（182 跑）：c84a v3 补跑（BP66 轴修正票——放行依据=有换手有回调非速度缓）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const logger = { info() {}, warn() {}, error() {} };
(async () => {
  const client = await dbManager.getClient();
  const addr = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
  const exp = '675c71a1-0e19-49b6-924b-facffc073afd';
  const { data: sigs } = await client.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY').eq('token_address', addr)
    .order('created_at', { ascending: true }).limit(60);
  const withBp = (sigs || []).filter((s) => s.metadata && s.metadata.buyPoint);
  const anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
  const { data: creates } = await client.from('wss_events').select('payload').eq('kind', 'token_create').eq('token_address', addr).limit(1);
  const p = (creates && creates[0] && creates[0].payload) || {};
  for (let i = 1; i <= 2; i++) {
    const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
    const res = await bp.gateBuyPoint(addr, { address: addr, symbol: p.symbol || null, name: p.name || null, platform: 'fourmeme' }, { experimentId: 'bp72-v3-c84a' }, { anchorMs: Date.parse(anchor.created_at) });
    const a = res.assessment || {}, d = res.dimensions || {}, an = res.anchors || {};
    const es = d.entry_shape || {};
    console.log(`[V3-c84a #${i}] 锚${anchor.created_at.slice(11, 19)} 综=${a.bucket}(${a.rule}) entry=${es.bucket}(${es.prob != null ? Number(es.prob).toFixed(2) : '?'}) chg5=${an.chg5Pct ?? '?'} rDip=${an.recentDip5Pct ?? '?'}@${an.recentDip5SecAgo ?? '?'}s`);
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
