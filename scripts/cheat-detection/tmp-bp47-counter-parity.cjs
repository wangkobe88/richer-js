// 一次性反例对拍（182 跑）：BP47 精简后 famous 轴适用域不误放早期薄盘票。
// BEM Miner 0x75d5286d…7777（BPA-025，极薄盘 25 ticks，famous 控盘 74.5% 照判 dominant）
// + FIGHT 0x490da05a…4444（BPA-036，复数 famous t+7s/t+13s 抢筹照判③）
// 两票都还在早期薄盘域（BP45 价格维度不命中：从未离开过 almost_launch；
// BP47 厚度维度不命中：极早薄盘）→ famous 轴照常生效。
// 对拍锚=成交时刻（trades 源口径），experimentId=c6efed13（v73 trades 源实验）。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const SRC_EXP = 'c6efed13-ce9d-41b0-89a5-8ca8b029a609';
const CASES = [
  { tag: 'BEM(BPA-025)', token: '0x75d5286d3ac478334fe098f015624486d7a77777', symbol: 'BEM Miner', anchorIso: '2026-11-05T07:03:44.330+00:00' },
  { tag: 'FIGHT(BPA-036)', token: '0x490da05a44bd886391d48f6cbfb1d7bbc7584444', symbol: 'FIGHT', anchorIso: '2026-11-05T07:55:43.847+00:00' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const { data: creates, error } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create')
    .in('token_address', CASES.map((c) => c.token));
  if (error) throw error;
  const bp = new BuyPointCheckService({
    enabled: true,
    gate: { awaitMs: 120000 },
    settleDelayMs: 0,
    persist: false,
  }, logger, {});
  for (const c of CASES) {
    const row = (creates || []).find((r) => r.token_address === c.token);
    const p = (row && row.payload) || {};
    const meta = { address: c.token, symbol: p.symbol || c.symbol, name: p.name || null, platform: p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(c.token, meta, { experimentId: 'bp47-counter-parity' },
      { anchorMs: Date.parse(c.anchorIso) });
    const a = r.assessment || {};
    const d = r.dimensions || {};
    const an = r.anchors || {};
    console.log(`${c.tag} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'}` +
      ` pattern=${(d.market_pattern || {}).bucket}(${(d.market_pattern || {}).prob != null ? Number(d.market_pattern.prob).toFixed(2) : '?'})` +
      ` famous=${(d.famous_domination || {}).bucket}(${(d.famous_domination || {}).prob != null ? Number(d.famous_domination.prob).toFixed(2) : '?'})` +
      ` holder=${(d.holder_concentration || {}).bucket}` +
      ` act=${(d.activity_level || {}).bucket} curVs=${an.currentVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
