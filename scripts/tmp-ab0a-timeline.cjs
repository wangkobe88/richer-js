const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const TOKEN = '0xab0ad29b9d701aa2607dbc5392aba032b33e7777';

(async () => {
  const { dbManager } = require('../src/services/dbManager.js');
  const client = dbManager.getClient();

  // 1) cheat_detection 全行（该 token 顶帽 4）
  const { data: cheats, error: ce } = await client.from('cheat_detection')
    .select('analyzed_at,verdict,snapshot_digest')
    .eq('token_address', TOKEN).order('analyzed_at', { ascending: true }).limit(10);
  if (ce) { console.error('cheat err:', ce.message); process.exit(1); }
  console.log('=== cheat_detection 轨迹 ===');
  for (const r of cheats || []) {
    const d = r.snapshot_digest || {};
    console.log('---', r.analyzed_at, 'verdict:', r.verdict, 'digest.tickCount:', d.tickCount ?? null);
    console.log('  grade:', d.grade, '| reasons:', JSON.stringify(d.gradeReasons));
    const lv = d.observation?.levels || d.levels || {};
    const anc = d.observation?.anchors || d.anchors || {};
    console.log('  levels:', JSON.stringify(lv));
    console.log('  anchors: act=', JSON.stringify({ ticksPerMin: d.ticksPerMin ?? anc.ticksPerMin, famous: d.famousDominancePct ?? anc.famousDominancePct, noBuySellPct: anc.noBuySellPct }));
  }

  // 2) 价格弧线（该票生命周期短，全量 ticks 小）
  const { data: ticks, error } = await client.from('wss_price_ticks')
    .select('block_time,trade_type,bnb_amount,token_amount,price_bnb,price_outlier')
    .eq('token_address', TOKEN).order('block_time', { ascending: true }).limit(5000);
  if (error) { console.error('ticks err:', error.message); process.exit(1); }
  console.log('\n=== ticks ===');
  console.log('total:', ticks.length, 'range:', ticks[0]?.block_time, '~', ticks[ticks.length - 1]?.block_time);
  let peak = null;
  for (const t of ticks) if (t.price_bnb != null && !t.price_outlier && (!peak || t.price_bnb > peak.price_bnb)) peak = t;
  console.log('peak(剔 outlier):', peak?.block_time, peak?.price_bnb);

  // 关键时刻价格就近采样
  const marks = [
    ['create      ', '2026-11-02T16:54:50'],
    ['narrDone    ', '2026-11-02T16:54:58.373'],
    ['fire1(拒)   ', '2026-11-02T16:54:59.737'],
    ['fire2       ', '2026-11-02T16:55:03.435'],
    ['buyExec     ', '2026-11-02T16:55:09.441'],
    ['sell        ', '2026-11-02T16:55:18.730'],
    ['+60s        ', '2026-11-02T16:56:00'],
    ['+5min       ', '2026-11-02T16:59:50'],
    ['+30min      ', '2026-11-02T17:24:50'],
  ];
  console.log('\n=== 时间线就近价（剔 outlier） ===');
  for (const [label, ts] of marks) {
    const target = Date.parse(ts);
    let best = null;
    for (const t of ticks) {
      if (t.price_bnb == null || t.price_outlier) continue;
      const dt = Math.abs(Date.parse(t.block_time) - target);
      if (!best || dt < best.dt) best = { dt, t };
    }
    if (best) console.log(label, new Date(target).toISOString(), '→', best.t.block_time, best.t.price_bnb?.toExponential(4), 'trade:', best.t.trade_type);
  }

  // 每 2 秒价格采样（前 60 秒）看弧形
  console.log('\n=== 前 60s 价格采样（每 2s 最近一档剔 outlier） ===');
  const t0 = Date.parse('2026-11-02T16:54:50');
  for (let s = 0; s <= 60; s += 2) {
    const target = t0 + s * 1000;
    let best = null;
    for (const t of ticks) {
      if (t.price_bnb == null || t.price_outlier) continue;
      const dt = Math.abs(Date.parse(t.block_time) - target);
      if (!best || dt < best.dt) best = { dt, t };
    }
    if (best) console.log(`T+${String(s).padStart(3)}s`, best.t.block_time.slice(17, 23), best.t.price_bnb.toExponential(4));
  }
  process.exit(0);
})();
