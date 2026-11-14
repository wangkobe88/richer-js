// 一次性（182 跑）：ea78 第一个 BUY 信号价格取证 v2——按平台选常量（flap=FL 常量），
// 修正信号行列名（无 price 列），补轨迹（≤27.5 窗时长/后续价格/最高点）。
const { dbManager } = require('../../src/services/dbManager.js');
const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const T = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';
const FM = 4496173469e-18;
const FL = 6.14 / (107036752 + 1e9);

async function main() {
  const sb = await dbManager.getClient();
  const { data: creates } = await sb.from('wss_events')
    .select('block_time,payload').eq('kind', 'token_create').eq('token_address', T).limit(1);
  const c = (creates || [])[0] || {};
  console.log(`token_create: ${String(c.block_time).slice(0, 19)} symbol=${(c.payload || {}).symbol} name=${(c.payload || {}).name} platform=${(c.payload || {}).platform}`);

  // 平台：buy_point_analyses 行自带 platform 列
  const { data: bpa } = await sb.from('buy_point_analyses')
    .select('platform,question_version,assessment,dimensions,anchor_tick_count,analyzed_at,snapshot_digest')
    .eq('token_address', T).order('analyzed_at').limit(2);
  const plat = (bpa && bpa[0] && bpa[0].platform) || (c.payload || {}).platform || 'fourmeme';
  const L = plat === 'flap' ? FL : FM;
  console.log(`平台=${plat} 发行价常量=${L.toExponential(7)}`);

  // 首 2 行 BUY 信号（price 列不存在，用 metadata）
  const { data: sigs, error: sigErr } = await sb.from('strategy_signals')
    .select('id,created_at,metadata').eq('experiment_id', V100).eq('signal_type', 'BUY')
    .eq('token_address', T).order('created_at').limit(2);
  if (sigErr) console.log('信号查询 error:', sigErr.message);
  for (const s of sigs || []) {
    const m = s.metadata || {};
    console.log(`\nBUY ${s.created_at.slice(0, 23)} metadata keys: ${Object.keys(m).join(',')}`);
    const f = m.factorResults || m.factors || m.factorSnapshot || null;
    if (f) console.log('  因子: curVs=' + f.currentVsLaunchPct + ' curPrice=' + f.currentPriceBnb +
      ' tradeCount=' + f.tradeCount + ' buyVol=' + f.buyVolumeBnb + ' holdersExDust=' + f.holdersExDust);
    const sg = m.signalGate || {}, cc = m.cheatCheck || {}, bp = m.buyPoint || {};
    console.log(`  sg: leg=${sg.legId} triggerNo=${sg.triggerNo}`);
    if (Object.keys(cc).length) console.log(`  cheat: ${cc.status}/${cc.grade} act=${cc.activityLevel || '-'}`);
    if (Object.keys(bp).length) {
      const a = bp.assessment || {}, d = bp.dimensions || {}, an = bp.anchors || {};
      console.log(`  bp: 综=${a.bucket}(${a.rule}) entry=${(d.entry_shape || {}).bucket}(${(d.entry_shape || {}).prob}) act=${(d.activity_level || {}).bucket} curVs=${an.currentVsLaunchPct}`);
    }
  }

  // BP 行 dimensions/anchors 细节
  if (bpa && bpa.length) {
    for (const r of bpa) {
      const d = r.dimensions || {};
      console.log(`\nBPA ${String(r.analyzed_at).slice(5, 23)} plat=${r.platform} 综=${r.assessment} anchorTicks=${r.anchor_tick_count}`);
      console.log('  dims:', Object.keys(d).map((k) => `${k}=${(d[k] || {}).bucket}(${(d[k] || {}).prob})`).join(' '));
      const dig = r.snapshot_digest || {};
      const an = dig.anchors || dig.ANCHORS || null;
      if (an) console.log('  anchors: curVs=' + (an.currentVsLaunchPct ?? '?') + ' curVsAth=' + (an.currentVsAthPct ?? '?') +
        ' athVs=' + (an.athVsLaunchPct ?? '?') + ' minVs=' + (an.minVsLaunchPct ?? '?') +
        ' launchPriceBnb=' + (an.launchPriceBnb ?? '?') + ' secSinceAth=' + (an.secSinceAth ?? '?'));
      else console.log('  digest keys:', Object.keys(dig).join(','));
    }
  }

  // 全史 ticks + FL 口径轨迹
  const rows = [];
  let fromId = 0;
  for (;;) {
    const { data, error } = await sb.from('wss_price_ticks')
      .select('id,block_time,trade_type,bnb_amount,price_bnb,trader_address')
      .eq('token_address', T).gt('id', fromId).order('id', { ascending: true }).limit(1000);
    if (error) throw error;
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
    fromId = data[data.length - 1].id;
  }
  let firstBuy = null;
  for (const r of rows) if (r.trade_type === 'buy' && r.price_bnb > 0) { firstBuy = r.price_bnb; break; }
  const launch = Math.min(L, firstBuy || L);
  const curVs = (p) => (p / launch - 1) * 100;
  console.log(`\n首买价=${firstBuy ? firstBuy.toExponential(6) : '无'}（较常量 ${firstBuy ? ((firstBuy / L - 1) * 100).toFixed(1) + '%' : '-'}）launch=${launch.toExponential(6)} ticks=${rows.length}`);

  console.log('\n首 14 笔（n/时刻/向/价/BNB/curVs）:');
  rows.slice(0, 14).forEach((r, i) => {
    console.log(`  n=${i + 1} ${r.block_time.slice(11, 23)} ${r.trade_type} price=${r.price_bnb ? r.price_bnb.toExponential(5) : '-'} bnb=${(r.bnb_amount || 0).toFixed(4)}` +
      (r.price_bnb > 0 ? ` curVs=${curVs(r.price_bnb).toFixed(2)}%` : ''));
  });

  // ≤27.5 窗：首末时刻与时长；后续里程碑
  let wStart = null, wEnd = null, min = null, max = null;
  for (const r of rows) if (r.price_bnb > 0) {
    const v = curVs(r.price_bnb);
    if (v <= 27.5) { if (!wStart) wStart = r; wEnd = r; }
    if (min === null || v < min.v) min = { r, v };
    if (max === null || v > max.v) max = { r, v };
  }
  console.log(`\n≤27.5 买窗: ${wStart ? wStart.block_time.slice(11, 19) + ' → ' + wEnd.block_time.slice(11, 19) + '（' + ((Date.parse(wEnd.block_time) - Date.parse(wStart.block_time)) / 1000).toFixed(0) + 's）' : '全程无'}`);
  console.log(`全史最低=${min ? min.v.toFixed(2) + '% @' + min.r.block_time.slice(11, 19) : '-'} 全史最高=${max ? max.v.toFixed(1) + '% @' + max.r.block_time.slice(11, 19) : '-'}`);
  // 首信号后 +1min/+5min/+30min 价格
  const s0 = sigs && sigs[0];
  if (s0) {
    const t0 = Date.parse(s0.created_at);
    for (const [lbl, dt] of [['+1min', 60e3], ['+5min', 300e3], ['+30min', 1800e3], ['+2h', 7200e3]]) {
      let last = null;
      for (const r of rows) { const t = Date.parse(r.block_time); if (t <= t0 + dt && r.price_bnb > 0) last = r; else if (t > t0 + dt) break; }
      console.log(`首信号后${lbl}: ${last ? 'price=' + last.price_bnb.toExponential(5) + ' curVs=' + curVs(last.price_bnb).toFixed(1) + '% @' + last.block_time.slice(11, 19) : '无tick'}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
