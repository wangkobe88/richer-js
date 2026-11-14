// 一次性对拍（182 跑）：BP55 ②桶大户参与 0.2 级判据单笔口径（v100-R2 案）——fresh gateBuyPoint persist:false。
//   a8e70（v100）旧口径累计 0.23×2 满足双臂判 none 放行 → 新口径单笔最大 0.1264=灰区单+0.2286 恰 1 个
//     凑不成双臂+两钱包买点前清仓离场 → 期望翻②retail_pvp → pattern_gate 拒
//   反例（防误伤）：米/施工鸭（bt-v94 对倒低价票）保持 neutral 放行——单笔口径只影响「大户参与
//     不满足」判定路径，正常换手票不落②
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const V100 = '11fc182a-b051-4665-857c-5c14e6713334'; // bt-v100
const V94 = '85cbad14-696f-49b2-baa4-a5407df4a2d2';   // bt-v94
const TOKENS = [
  { exp: V100, key: 'a8e70-翻②',   addr: '0xa8e70ca07b68a07683c963513a26f2fa91647777', expect: '翻②retail_pvp → pattern_gate 拒' },
  { exp: V94, key: '米-反例',      addr: '0x338a510c6c7abd4c714d74225086542270427777', expect: '保持 neutral 放行' },
  { exp: V94, key: '施工鸭-反例',  addr: '0x459f1d098437fad48931372f9b16b6ad25297777', expect: '保持 neutral 放行' },
];
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const addrs = TOKENS.map((t) => t.addr);
  const { data: creates } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').in('token_address', addrs);
  const metaBy = new Map((creates || []).map((r) => [r.token_address, r.payload || {}]));
  const { data: etRows } = await client.from('experiment_tokens')
    .select('token_address,platform').in('experiment_id', [V100, V94]).in('token_address', addrs);
  const platBy = new Map((etRows || []).map((r) => [r.token_address, r.platform]));

  const bp = new BuyPointCheckService({
    enabled: true, gate: { awaitMs: 120000 }, settleDelayMs: 0, persist: false,
  }, logger, {});

  for (const t of TOKENS) {
    const { data: sigs, error } = await client.from('strategy_signals')
      .select('id,created_at').eq('experiment_id', t.exp).eq('signal_type', 'BUY')
      .eq('token_address', t.addr).order('created_at', { ascending: true }).limit(1);
    if (error || !sigs || !sigs.length) { console.log(`${t.key} 无信号行跳过`); continue; }
    const anchorMs = Date.parse(sigs[0].created_at);
    const p = metaBy.get(t.addr) || {};
    const meta = { address: t.addr, symbol: p.symbol || null, name: p.name || null, platform: platBy.get(t.addr) || p.platform || 'fourmeme' };
    const r = await bp.gateBuyPoint(t.addr, meta, { experimentId: 'bp55-parity' }, { anchorMs });
    const a = r.assessment || {}, d = r.dimensions || {}, an = r.anchors || {};
    const dim = (k) => { const o = d[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`${t.key} ${sigs[0].created_at.slice(11, 19)} → ${r.status} 综=${a.bucket}(${a.rule})` +
      ` pattern=${dim('market_pattern')} entry=${dim('entry_shape')} act=${dim('activity_level')}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'} || 期望=${t.expect}`);
    if (a.reasons && a.reasons.length) console.log(`   reasons=${JSON.stringify(a.reasons).slice(0, 220)}`);
  }
  const stats = bp.getStats ? bp.getStats() : {};
  console.log('stats=' + JSON.stringify(stats).slice(0, 400));
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
