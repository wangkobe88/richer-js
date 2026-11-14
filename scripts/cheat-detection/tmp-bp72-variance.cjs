// 一次性（182 跑）：BP72 对拍补方差——三张贴线票各 ×3（a813 误伤 0.51/蝴蝶 0.50/LABU 0.66）
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334';
const V95 = '675c71a1-0e19-49b6-924b-facffc073afd';
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';
const logger = { info() {}, warn() {}, error() {} };

async function sigsAll(exp, addr) {
  const out = []; let cur = '';
  for (let p = 0; p < 10; p++) {
    let b = dbManager.getClient().from('strategy_signals')
      .select('id,created_at,metadata').eq('experiment_id', exp).eq('signal_type', 'BUY').eq('token_address', addr)
      .order('created_at', { ascending: true }).limit(60); if (cur) b = b.gt('created_at', cur);
    const { data, error } = await b;
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    out.push(...data); cur = data[data.length - 1].created_at; if (data.length < 60) break;
  }
  return out;
}

(async () => {
  const client = await dbManager.getClient();
  const RUNS = [
    { key: 'a813', exp: V94, addr: '0xa813cd684ce664d2dcde26797246e3b4ffd37777', hhmmss: '09:28:07' },
    { key: '蝴蝶人生路', exp: V100, addr: '0xb359716d1affde1fb9d351fec71a0f2e79257777', hhmmss: '12:43:13' },
    { key: 'LABU', exp: V100, addr: '0x1ac4a310874e29290720d2fb55300a91a23e7777', hhmmss: '05:54:09' },
  ];
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', RUNS.map((r) => r.addr));
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V100, V95, V94]).in('token_address', RUNS.map((r) => r.addr));
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));
  for (const r of RUNS) {
    const sigs = await sigsAll(r.exp, r.addr);
    if (!sigs.length) { console.log(`${r.key} 无信号`); continue; }
    const withBp = sigs.filter((s) => s.metadata && s.metadata.buyPoint);
    const anchor = withBp.length ? withBp[withBp.length - 1] : sigs[sigs.length - 1];
    const anchorMs = Date.parse(anchor.created_at);
    const p = metaBy.get(r.addr) || {};
    const meta = { address: r.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(r.addr) || p.platform || 'fourmeme' };
    for (let i = 1; i <= 3; i++) {
      const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
      const res = await bp.gateBuyPoint(r.addr, meta, { experimentId: 'bp72-variance' }, { anchorMs });
      const a = res.assessment || {}, d = res.dimensions || {}, an = res.anchors || {};
      const es = d.entry_shape || {};
      console.log(`[${r.key} #${i}] 综=${a.bucket}(${a.rule}) entry=${es.bucket}(${es.prob != null ? Number(es.prob).toFixed(2) : '?'})` +
        ` chg5=${an.chg5Pct ?? '?'} rDip=${an.recentDip5Pct ?? '?'}@${an.recentDip5SecAgo ?? '?'}s 未收复=${an.recentDip5UnrecoveredPct ?? '?'}`);
    }
  }
  try { if (typeof dbManager.close === 'function') await dbManager.close(); } catch {}
  process.exit(0);
})();
