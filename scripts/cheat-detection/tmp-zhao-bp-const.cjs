// 一次性对拍（182 跑）：quote 盘 FL 常量锚落码后赵公主 0x5793b7ea…7777
// bt-v89 11:17:12 买点锚 BP 门重判——改前=BP53 ultra_router_entry 豁免放行
//（exempt curVsLaunchPct:38.5/routerBuyPct60:30.7，首 tick 8.26e-9 锚偏松）；
// 改后 curVs=常量口径 +107.3>40 → BP53 价格腿失效 → ④桶 pattern_gate 拒（翻拒验证）。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');
const { FLAP_LAUNCH_PRICE_BNB } = require('../../src/market-analysis/launch-price.js');

const ADDR = '0x5793b7ead75851206529f98cfe89db54511a7777';
const AT = '2026-11-05T11:17:12Z';
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const { data: ev } = await client.from('wss_events')
    .select('payload').eq('kind', 'token_create').eq('token_address', ADDR);
  const p = (ev[0] && ev[0].payload) || {};
  const meta = { address: ADDR, symbol: p.symbol || '?', name: p.name || null, platform: p.platform || 'flap' };
  console.log(`token platform=${meta.platform} symbol=${meta.symbol} FL常量=${FLAP_LAUNCH_PRICE_BNB.toExponential(4)}`);

  const bp = new BuyPointCheckService({ enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false }, logger, {});
  const r = await bp.gateBuyPoint(ADDR, meta, { experimentId: 'zhao-bp-const' }, { anchorMs: Date.parse(AT) });
  const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
  const mp = d.market_pattern || {}, heat = d.market_heat || {}, act = d.activity_level || {};
  console.log(`status=${r.status} 综=${a.bucket}${a.rule ? '(' + a.rule + ')' : ''}${a.exempt ? ' exempt=' + JSON.stringify(a.exempt) : ''}` +
    `\npattern=${mp.bucket}(${mp.prob != null ? Number(mp.prob).toFixed(2) : '?'}) heat=${heat.bucket || '?'} act=${act.bucket || '?'}` +
    `\ncurVs=${an.currentVsLaunchPct ?? '?'} launchBnb=${an.launchPriceBnb ?? '?'} minVs=${an.minVsLaunchPct ?? '?'} athVs=${an.athVsLaunchPct ?? '?'} router60=${an.routerBuyPct60 ?? '?'}`);

  // CD 侧 reset 截窗同锚对拍（launchPrice 常量化后 exitThreshold=FL×1.1）
  const { CheatCheckService } = require('../../src/market-analysis/CheatCheckService.js');
  const svc = new CheatCheckService({ enabled: true, gate: { awaitMs: 120000, activityExemptLevels: ['high', 'ultra'] } }, logger, {});
  const rc = await svc.gateBuyPoint(ADDR, meta, { experimentId: 'zhao-bp-const' }, { anchorMs: Date.parse(AT) });
  const ra = rc.result || rc, digest = (ra && ra.digest) || {};
  console.log(`\nCD 侧: status=${rc.status} grade=${ra && ra.grade} reset=${digest.marketReset ?? '?'} fullAnchorTicks=${digest.fullAnchorTickCount ?? '?'}`);

  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
