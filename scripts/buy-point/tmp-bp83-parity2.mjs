// BP83 对拍二跑（修正锚点）：锚=生产 owd 拒信号真锚（DB 直查），零手敲地址
import { createRequire } from 'node:module';
const require_ = createRequire('/home/ubuntu/richer-js/scripts/buy-point/tmp.mjs');
const { dbManager } = require_('/home/ubuntu/richer-js/src/services/dbManager.js');
const { BuyPointCheckService } = require_('/home/ubuntu/richer-js/src/market-analysis/BuyPointCheckService.js');
const V111 = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
// 目标锚：时间判别（生产 owd 行 created_at 的 HH:MM:SS 唯一）+ 期望
const TARGETS = [
  { key: 'Cashless-FLIP(67.3%主案)', t: '11-03T11:34:46', expect: '翻 none（交织非卖期）' },
  { key: 'Cashless2-FLIP(68.9%)', t: '11-03T11:30:03', expect: '翻 none' },
  { key: '初号姬-FLIP(14.7%)', t: '11-03T08:53:21', expect: '翻 none' },
  { key: 'CBDC-FLIP(25.8%)a', t: '11-03T11:52:50', expect: '翻 none' },
  { key: 'CBDC-FLIP(32.1%)b', t: '11-03T11:52:53', expect: '翻 none' },
  { key: 'JOB-FLIP(49.9%)', t: '11-03T14:40:14', expect: '翻 none' },
  { key: '2bi-FLIP(52.3%)', t: '11-03T14:36:09', expect: '翻 none' },
  { key: 'DUNDUN-FLIP(60.0%)', t: '11-03T14:40:20', expect: '翻 none' },
  { key: '画地为牢-FLIP(63.7%)', t: '11-03T09:03:35', expect: '翻 none' },
  { key: '羊-FLIP(65.2%)', t: '11-03T09:01:07', expect: '翻 none' },
  { key: 'BSI-保持(94.2%)', t: '11-03T14:33:39', expect: 'one_wave_dump 保持' },
  { key: '차르-保持(100%)', t: '11-03T07:30:41', expect: 'one_wave_dump 保持（地址以 DB 为准）' },
  { key: 'ㅤ-边界(75.2%)a', t: '11-02T17:02:54', expect: '贴线观察' },
  { key: 'ㅤ-边界(68.5%)b', t: '11-02T17:02:57', expect: '翻 none（<80）' },
  { key: 'ㅤ-边界(51.7%)c', t: '11-02T17:03:01', expect: '翻 none' },
  { key: 'POORNANCE-边界(76.4%)a', t: '11-02T18:38:45', expect: '贴线观察' },
];
const REPEAT = 3;
const logger = { info() {}, warn() {}, error() {} };
async function main() {
  const client = await dbManager.getClient();
  // 全量拉 V111 owd 拒信号（分页 500/页）
  const all = [];
  let from = 0;
  while (true) {
    const { data } = await client.from('strategy_signals')
      .select('token_address,created_at,metadata').eq('experiment_id', V111).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 499);
    if (!data || !data.length) break;
    all.push(...data.filter((r) => r.metadata?.buyPoint?.dimensions?.market_pattern?.bucket === 'one_wave_dump'));
    if (data.length < 500) break;
    from += 500;
  }
  const byTime = new Map();
  for (const r of all) {
    const hhmmss = r.created_at.slice(5, 19);
    if (!byTime.has(hhmmss)) byTime.set(hhmmss, r);
  }
  const addrs = [...new Set(all.map((r) => r.token_address))];
  const { data: creates } = await client.from('wss_events').select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens').select('token_address,platform').eq('experiment_id', V111).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));
  const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
  console.log(`V111 owd 拒信号共 ${all.length} 行/${addrs.length} 票`);
  for (const t of TARGETS) {
    const row = byTime.get(t.t);
    if (!row) { console.log(`\n### ${t.key} 未匹配到 owd 行 ${t.t}（跳过）`); continue; }
    const anchorMs = Date.parse(row.created_at);
    const p = metaBy.get(row.token_address) || {};
    const meta = { address: row.token_address, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(row.token_address) || p.platform || 'fourmeme' };
    const an0 = row.metadata.buyPoint.anchors || {};
    const b0 = an0.phaseSplitPostBuyBnb ?? 0, s0 = an0.phaseSplitPostSellBnb ?? 0;
    const share0 = b0 + s0 > 0 ? (s0 / (b0 + s0) * 100).toFixed(1) : '?';
    const rounds = [];
    for (let i = 0; i < REPEAT; i++) {
      const r = await bp.gateBuyPoint(row.token_address, meta, { experimentId: 'bp83-parity2' }, { anchorMs });
      const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
      const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
      let ps = 'ps[nil]';
      if (an.phaseSplitSecSinceFirstSell != null) {
        const buy = an.phaseSplitPostBuyBnb ?? 0, sell = an.phaseSplitPostSellBnb ?? 0;
        const share = buy + sell > 0 ? (sell / (buy + sell) * 100).toFixed(1) : '?';
        ps = `ps[t-${an.phaseSplitSecSinceFirstSell}s/pre${an.phaseSplitPreBuySharePct}%/post买${buy}/卖${sell}/卖占${share}%]`;
      }
      rounds.push(`#${i + 1} ${r.status} 综=${a.bucket}(${a.rule}) mp=${dim('market_pattern')} es=${dim('entry_shape')} act=${dim('activity_level')} curVs=${an.currentVsLaunchPct ?? '?'} ${ps}`);
    }
    console.log(`\n### ${t.key} ${row.token_address.slice(0, 10)} 锚=${row.created_at.slice(5, 19)}（生产卖占${share0}%）v=${bp._version}`);
    for (const line of rounds) console.log('  ' + line);
    console.log(`  || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
