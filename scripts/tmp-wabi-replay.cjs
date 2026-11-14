// 一次性：蛙币 0x275c17eb 09:33:43 信号 BP 门重放——质量题明细（庄盘豁免验证）
const { dbManager } = require('../src/services/dbManager.js');
const { BuyPointCheckService } = require('../src/market-analysis/BuyPointCheckService');

(async () => {
  const c = await dbManager.getClient();
  const A = '0x275c17eb37d8e5d4184d2f12565e4b4722727777';
  const { data: cr } = await c.from('wss_events').select('block_time,payload').eq('kind', 'token_create').eq('token_address', A).limit(1);
  const p = (cr[0] && cr[0].payload) || {};
  const svc = new BuyPointCheckService(
    { enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false },
    { info() {}, warn() {}, error() {} }, {}
  );
  const res = await svc.gateBuyPoint(
    A,
    { address: A, symbol: p.symbol || null, name: p.name || null, platform: 'fourmeme', createdAtMs: Date.parse(cr[0].block_time) },
    { experimentId: 'probe', signalCreatedAt: '2026-11-05T09:33:43.500Z' },
    { awaitMs: 120000, anchorMs: Date.parse('2026-11-05T09:33:43.500Z') }
  );
  const a = res.assessment || {};
  console.log('bucket=', a.bucket, a.rule, a.prob);
  const q = a.qualities || {};
  for (const k of Object.keys(q)) console.log(' ', k, '=', q[k].bucket, q[k].prob != null ? 'p=' + q[k].prob : '');
  const d = res.dimensions || {};
  for (const k of ['market_pattern', 'entry_position', 'price_level', 'market_heat', 'activity_level']) {
    if (d[k]) console.log(' dim:', k, '=', d[k].bucket, d[k].prob != null ? 'p=' + d[k].prob : '');
  }
  const an = res.anchors || {};
  console.log('anchors: vsLaunch=', an.currentVsLaunchPct, 'maxChg5=', an.maxChg5Pct, 'vsAth=', an.currentVsAthPct,
    'tail=', an.actNearTail5BuySharePct);
  // state 里开盘段/前列关键行
  const raw = JSON.stringify(res);
  for (const pat of [/开盘段[^"]{0,150}/g, /尾段[^"]{0,120}/g, /前列[^"]{0,150}/g]) {
    const m = raw.match(pat) || [];
    for (const l of m.slice(0, 3)) console.log(' state:', l);
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
