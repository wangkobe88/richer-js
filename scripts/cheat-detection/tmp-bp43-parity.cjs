// 一次性对拍（182 跑）：BP43 ④高活跃豁免+famous 回撤入仓域
// 苍蝇 0xb30f0b8a…7777（flap）05:10:06/09 两信号（cangying-bp42-v2=608df82f）真调
// BuyPointCheckService——旧 mapper 下 pattern_gate 拒（④0.49/0.44 贴线误杀）；
// 新 mapper 预期：④∧ultra∧≤40 豁免+ultra 连带+famous dominant∧回撤位退出
// → 三门全放行走质量聚合（rule=any_*，exempts=['esd_activity','famous_pullback']）。
// 注意：真调重跑 Jev 有 run-to-run 方差（BP11 ±0.1+）——对拍目标=门链行为（豁免
// 逻辑），档位方差留痕即可。
const { dbManager } = require('../../src/services/dbManager.js');
const { BuyPointCheckService } = require('../../src/market-analysis/BuyPointCheckService');

const EXP = '608df82f-73c5-4714-bc4a-df099bbfd81c'; // cangying-bp42-v2
const TOKEN = '0xb30f0b8a8270271989e37d6bc00e627a07637777'; // 苍蝇（flap）
const logger = { info() {}, warn() {}, error() {} };

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error: e1 } = await client.from('strategy_signals')
    .select('id,created_at').eq('experiment_id', EXP).eq('signal_type', 'BUY')
    .eq('token_address', TOKEN).order('created_at');
  if (e1) throw e1;
  const at = (hhmmss) => {
    const r = sigs.find((s) => s.created_at.slice(11, 19) === hhmmss);
    if (!r) throw new Error(hhmmss + ' 信号行未找到');
    return Date.parse(r.created_at);
  };
  const { data: creates, error: e2 } = await client.from('wss_events')
    .select('token_address,payload').eq('kind', 'token_create').eq('token_address', TOKEN);
  if (e2) throw e2;
  const p = (creates[0] && creates[0].payload) || {};
  const meta = { address: TOKEN, symbol: p.symbol || 'CANGYING', name: p.name || null, platform: p.platform || 'flap' };

  const bp = new BuyPointCheckService({
    enabled: true,
    gate: { awaitMs: 120000 },
    settleDelayMs: 0,
    persist: false,
  }, logger, {});
  for (const hhmmss of ['05:10:06', '05:10:09']) {
    const r = await bp.gateBuyPoint(TOKEN, meta, { experimentId: 'bp43-parity' },
      { anchorMs: at(hhmmss) });
    const a = r.assessment || {};
    const d = r.dimensions || {};
    const an = r.anchors || {};
    console.log(`${hhmmss} → ${r.status} 综=${a.bucket}(${a.rule}) p=${a.prob != null ? Number(a.prob).toFixed(2) : '?'}` +
      ` exempts=${JSON.stringify(a.exempts || [])}` +
      ` pattern=${(d.market_pattern || {}).bucket}(${(d.market_pattern || {}).prob != null ? Number(d.market_pattern.prob).toFixed(2) : '?'})` +
      ` act=${(d.activity_level || {}).bucket} entry=${(d.entry_position || {}).bucket}` +
      ` famous=${(d.famous_domination || {}).bucket}` +
      ` curVs=${an.currentVsLaunchPct ?? '?'} v=${r.questionVersion ?? '?'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
