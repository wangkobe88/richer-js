// 一次性（182 跑）：v100 ba5e BUY 行 metadata——核对 act low 拒 + cheat sbw=burst 现状。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xba5ed45b42479e0a75316de7bf990ec90a3e4444';
async function main() {
  const sb = await dbManager.getClient();
  const { data, error } = await sb.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', V100).eq('token_address', T)
    .order('created_at').limit(10);
  if (error) console.log('err:', error.message);
  console.log('ba5e@v100 信号行:', (data || []).length);
  for (const r of (data || [])) {
    const m = r.metadata || {};
    const cc = m.cheatCheck || {}, bp = m.buyPoint || {}, sg = m.signalGate || {};
    console.log('row ' + r.id + ' ' + r.created_at.slice(5, 19));
    console.log(' signalGate:', JSON.stringify(sg).slice(0, 300));
    console.log(' cheat:', JSON.stringify({
      grade: cc.grade, exempt: cc.exempt,
      sbw: cc.levels && cc.levels.stallBurstWave, act: cc.levels && cc.levels.activityLevel,
      gap: cc.anchors && cc.anchors.burstMaxGapSec, bnb: cc.anchors && cc.anchors.burstWaveBuyBnb,
      wallets: cc.anchors && cc.anchors.burstWaveWallets, exitVs: cc.anchors && cc.anchors.burstExitVsLaunchPct,
    }).slice(0, 500));
    const a = bp.assessment || {}, dims = bp.dimensions || {};
    console.log(' bp:', JSON.stringify({
      status: bp.status, rule: a.rule,
      act: dims.activity_level,
      pattern: dims.market_pattern && dims.market_pattern.bucket,
      entry: dims.entry_shape && dims.entry_shape.bucket,
    }).slice(0, 400));
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
