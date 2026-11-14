// BP83 对拍（182 跑）：⑨one_wave_dump 卖期主导性（卖占首卖后成交 ≥80% 参考/捆绑计入买向/2:1 交织不立）
//   用户裁定：「买期买入占绝对主导，卖期卖占绝对主导。这差不多 2:1，肯定不算主导」。
//   FLIP 候选 9（btv111 owd 拒票卖占比 <75% 交织面——应翻 none 走统一门/其它桶）；
//   保持对照 7（卖占比 ≥75% 单向流——one_wave_dump 须保持，不许翻坏）；
//   边界 2（75~77% 贴线——观察方差）；
//   SAMSUNG ⑨主案回归 1（BP79 立法票——主导比 ≥80% 则保持，交织则归 none=BP83 语义内，看数说话）。
import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { dbManager } = require_('../../src/services/dbManager.js');
const { BuyPointCheckService } = require_('../../src/market-analysis/BuyPointCheckService.js');

const V111 = '5390bbfa-0c86-48a2-b9e1-94537c54ac17';
const V104 = '18db4a3e-b25d-44f3-9fc6-32d3c2f2857b';
const TOKENS = [
  // FLIP 候选（btv111 owd 误拒——卖占比 <75% 交织，期望翻 none）
  { exp: V111, key: 'Cashless-FLIP(67.3%主案+463%)', addr: '0xbcb728291999b8fc26629530ea97d5a218df7777', hint: '2026-11-13T11:34:46', expect: '翻 none（交织非卖期）' },
  { exp: V111, key: 'Cashless2-FLIP(68.9%)', addr: '0xfd571fd6f29d0a72135233ae0a21868d6ca27777', hint: '2026-11-13T11:30:03', expect: '翻 none' },
  { exp: V111, key: '初号姬-FLIP(14.7%)', addr: '0x60382452a880fa7e7655f2c362d076489b897777', hint: '2026-11-13T08:53:21', expect: '翻 none' },
  { exp: V111, key: 'CBDC-FLIP(25.8%)', addr: '0x6fceff81a2709d98af348c610097bdcf26cc7777', hint: '2026-11-13T11:52:53', expect: '翻 none' },
  { exp: V111, key: 'JOB-FLIP(49.9%)', addr: '0xe2a32834d17a4776be81b85b50d170778ef07777', hint: '2026-11-13T14:40:14', expect: '翻 none' },
  { exp: V111, key: '2bi-FLIP(52.3%)', addr: '0x3677f5793611e2ef9d642ca67667543b474a7777', hint: '2026-11-13T14:36:09', expect: '翻 none' },
  { exp: V111, key: 'DUNDUN-FLIP', addr: '0xe8804709946b76aee02180e99888b62212517777', hint: '2026-11-13T14:40:20', expect: '翻 none' },
  { exp: V111, key: '画地为牢-FLIP', addr: '0x32059ea3719c7efecd007e1896cf5c9765087777', hint: '2026-11-13T09:03:35', expect: '翻 none' },
  { exp: V111, key: '羊-FLIP', addr: '0xce85402dbba18a7d4ff5a929c02f256a57ce7777', hint: '2026-11-13T09:01:07', expect: '翻 none' },
  // 保持对照（卖占比 ≥75% 单向流——one_wave_dump 须保持）
  { exp: V111, key: 'NONONO-保持(96.2%)', addr: '0x46672f758a7012280aaeeb242fbe9a4af8e57777', hint: '2026-11-02T17:13:04', expect: 'one_wave_dump 保持' },
  { exp: V111, key: 'RICH-保持(95.8%)', addr: '0x79bf40946e874943c6ac5c3b9560e843ffdd7777', hint: '2026-11-02T18:41:24', expect: 'one_wave_dump 保持' },
  { exp: V111, key: '5000-保持(100%)', addr: '0xeb295c8b9b30a28a137b3fd899d8e53d8d4c7777', hint: '2026-11-02T21:16:50', expect: 'one_wave_dump 保持' },
  { exp: V111, key: 'GOAT-保持(100%)', addr: '0xf2b809093261322787521a08a176e53eef857777', hint: '2026-11-03T01:20:44', expect: 'one_wave_dump 保持' },
  { exp: V111, key: 'CAT-保持', addr: '0x9e69e59262339307acfb296dda43b96287427777', hint: '2026-11-02T16:51:33', expect: 'one_wave_dump 保持' },
  { exp: V111, key: 'BSI-保持', addr: '0xbb44bdd4b79b03d634bde6a2cc9814ea28f37777', hint: '2026-11-13T14:33:39', expect: 'one_wave_dump 保持' },
  { exp: V111, key: '차르-保持(100%)', addr: '0xd95d44b888d34d8261eb5f4613f4e19b0a197777', hint: '2026-11-13T07:30:41', expect: 'one_wave_dump 保持' },
  // 边界（75~77% 贴线——方差观察）
  { exp: V111, key: 'ㅤ-边界(75.2%)', addr: '0xe9749404b883aa047e4bb01de5c7edeb56047777', hint: '2026-11-13T17:02:57', expect: '观察（贴线）' },
  { exp: V111, key: 'POORNANCE-边界(76.4%)', addr: '0xe583c60b4ea4d3dc92bad9238a8de7463ced7777', hint: '2026-11-13T18:39:03', expect: '观察（贴线）' },
  // ⑨主案回归（BP79 立法票——主导比看数：≥80% 保持/交织归 none 均 BP83 语义内）
  { exp: V104, key: 'SAMSUNG-⑨主案回归', addr: '0x54117eb6d2481dc8d89ee377e00e683f882f7777', expect: '主导比 ≥80% 保持 one_wave_dump/交织归 none（看数）' },
];
const REPEAT = 3;
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V111, V104]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
  for (const t of (ONLY.length ? TOKENS.filter((x) => ONLY.some((o) => x.key.startsWith(o))) : TOKENS)) {
    let anchorMs = null, anchorAt = null;
    const { data, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(50);
    if (error || !data || !data.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    if (t.hint) {
      const ht = Date.parse(t.hint + 'Z');
      let best = data[0], bestD = Infinity;
      for (const r of data) { const d = Math.abs(Date.parse(r.created_at) - ht); if (d < bestD) { bestD = d; best = r; } }
      anchorAt = best.created_at;
    } else {
      anchorAt = data[t.anchorIndex || 0].created_at;
    }
    anchorMs = Date.parse(anchorAt);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const rounds = [];
    for (let i = 0; i < REPEAT; i++) {
      const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp83-parity' }, { anchorMs });
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
    console.log(`\n### ${t.key} ${t.addr.slice(0, 8)} 锚=${anchorAt.slice(5, 19)} v=${bp._version}`);
    for (const line of rounds) console.log('  ' + line);
    console.log(`  || 期望=${t.expect}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
