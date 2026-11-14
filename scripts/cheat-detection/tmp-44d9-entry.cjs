// 一次性（182 跑）：用户点名两票（v99=87cc5a7d）——
//   ① 44d9（0x44d9…ffff）买入点位「算 crash 了」：v99 kill 丢信号行，按成交时刻 07:41:20
//      fresh gateBuyPoint 重判 entry_shape + crash 四臂数值全打印。
//   ② 59f5（0x59f5…7777）「famous 为何还是挡不住」：BP61 在场型票（hold 52.9 收割臂不适用、
//      三修区分锚后判 none 放行）——按 v99 成交时刻 fresh 重判 + famous 痕迹材料打印。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V99 = '87cc5a7d-d845-4c46-8edd-f19dde4ef10f';
const TARGETS = [
  { tag: '44d9', addr: '0x44d93abb648b7d1d1d20a49002047fb588ccffff', anchors: ['2026-11-05T07:41:20Z', '2026-11-05T07:41:19Z'] },
  { tag: '59f5', addr: '0x59f5ccb671f1651db2ca8aba4fd0254fcef87777', anchors: null }, // null=查 v99 首成交
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TARGETS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('platform,payload,block_time').eq('kind', 'token_create').in('token_address', addrs).limit(10);
  const metaBy = new Map();
  for (const r of creates || []) {
    const p = r.payload || {};
    if ((p.symbol || p.name) && !metaBy.has(r.token_address)) metaBy.set(r.token_address, { platform: r.platform, payload: p });
  }
  const { data: et } = await client.from('experiment_tokens').select('token_address,platform').eq('experiment_id', V99).in('token_address', addrs);
  const platBy = new Map((et || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});

  for (const t of TARGETS) {
    console.log(`\n===== ${t.tag} ${t.addr} =====`);
    let anchorList = (t.anchors || []).slice();
    if (!anchorList.length) {
      const { data: tr } = await client.from('trades').select('trade_direction,created_at,input_amount,output_amount,metadata')
        .eq('experiment_id', V99).eq('token_address', t.addr).order('created_at').limit(10);
      for (const x of tr || []) console.log(`  v99 trade: ${x.trade_direction} ${x.created_at.slice(5, 19)} in=${x.input_amount} out=${x.output_amount} card=${JSON.stringify((x.metadata || {}).cardTrade || {})}`);
      const firstBuy = (tr || []).find((x) => x.trade_direction === 'buy');
      if (!firstBuy) { console.log('  无成交跳过'); continue; }
      anchorList = [firstBuy.created_at];
    }
    const m = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: m.payload ? m.payload.symbol : null, name: m.payload ? m.payload.name : null, platform: platBy.get(t.addr) || m.platform || 'flap' };
    console.log(`  meta: ${meta.symbol || '?'} platform=${meta.platform}`);
    for (const iso of anchorList) {
      const anchorMs = Date.parse(iso);
      const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'tmp-2tickets' }, { anchorMs });
      const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
      const es = d.entry_shape || {}, mp = d.market_pattern || {};
      console.log(`  -- ${iso.slice(11, 19)} → bp=${r.status} 综=${a.bucket}(${a.rule}) entry=${es.bucket}(${es.prob != null ? Number(es.prob).toFixed(2) : '?'}) pattern=${mp.bucket}(${mp.prob != null ? Number(mp.prob).toFixed(2) : '?'}) v=${r.questionVersion || '?'}`);
      console.log('     crash 致数值:', JSON.stringify({
        curVs: an.currentVsLaunchPct, curVsAth: an.currentVsAthPct, chg5: an.chg5Pct, chg10: an.chg10Pct,
        chg30: an.chg30Pct, nDn5: an.nearMaxDn5Pct, nUp5: an.nearMaxUp5Pct, minGap: an.curVsMinGapPct, athVs: an.athVsLaunchPct,
      }));
      const dims = Object.entries(d).map(([k, v]) => `${k}=${v.bucket}`).join(' ');
      console.log('     全维度:', dims);
      if (a.exempt) console.log('     exempt:', JSON.stringify(a.exempt));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
