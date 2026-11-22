'use strict';
// tail_no_buyer_pressure 破发豁免验证（182 跑）：三窗单臂拒行 → minVsFloor 分层 → 锚后 30min（FP26 臂，用户裁定同 FP39 深破线）
// 案源=一姐 0xfc23（JG-18）：15:42:32 tail_dip 拒时 minVsFloor=-11.21，用户裁定方向「破发豁免——基本到底部没啥可跌」
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const WINDOWS = [
  { name: 'w1003-bt-v164(热)', exp: '9e9163de-a677-4d39-9c33-9ec9df05e400' },
  { name: 'w1019-bt-v159(中)', exp: 'ce102e94-293c-4f8f-af98-cd06f4b0e98c' },
  { name: 'w1012-bt-v155(冷)', exp: 'dddbe79e-480a-402a-aa35-85a72d2f591e' },
];
const FWD_MS = 30 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const sb = dbManager.getClient();
  const all = [];
  for (const w of WINDOWS) {
    const rows = [];
    let from = 0;
    while (true) {
      const { data, error } = await sb.from('strategy_signals')
        .select('token_address,created_at,metadata')
        .eq('experiment_id', w.exp).eq('signal_type', 'BUY')
        .order('created_at', { ascending: true }).range(from, from + 499);
      if (error) throw new Error(w.name + ': ' + error.message);
      for (const r of data || []) {
        const md = r.metadata || {};
        const fc = md.factorCheck;
        if (fc && fc.pass === false && Array.isArray(fc.arms) && fc.arms.length === 1 && fc.arms[0] === 'tail_no_buyer_pressure') {
          const tf = md.trendFactors || {};
          rows.push({ win: w.name, token: r.token_address, t: r.created_at, minVs: tf.launchMinVsFloorPct, curVs: tf.currentVsLaunchPct, chg30: tf.chg30Pct });
        }
      }
      if (!data || data.length < 500) break;
      from += 500;
      await sleep(120);
    }
    // per-token 首拒行
    const seen = new Set();
    for (const r of rows) { if (!seen.has(r.token)) { seen.add(r.token); r.first = true; all.push(r); } }
    console.log(`[${w.name}] 单臂拒行 ${rows.length} 行 / 首拒行票 ${seen.size}`);
  }
  console.log(`\n合计首拒行票: ${all.length}，开始锚后 ticks 前向收益…`);
  let done = 0;
  for (const r of all) {
    done++;
    if (done % 50 === 0) console.log(`  进度 ${done}/${all.length}`);
    const t0 = new Date(new Date(r.t).getTime() - 90 * 1000).toISOString();
    const t1 = new Date(new Date(r.t).getTime() + FWD_MS).toISOString();
    let tries = 0;
    while (true) {
      try {
        const { data, error } = await sb.from('wss_price_ticks')
          .select('block_time,price_bnb,bnb_amount,price_outlier')
          .eq('token_address', r.token).gte('block_time', t0).lte('block_time', t1)
          .order('block_time', { ascending: true }).range(0, 4999);
        if (error) throw new Error(error.message);
        const ok = (data || []).filter(x => !x.price_outlier && x.price_bnb);
        let anchorPx = null, peak = null, endPx = null;
        for (const x of ok) {
          if (new Date(x.block_time) <= new Date(r.t)) { anchorPx = x.price_bnb; continue; }
          if (peak === null || x.price_bnb > peak) peak = x.price_bnb;
          endPx = x.price_bnb;
        }
        r.anchorPx = anchorPx; r.fwd = (anchorPx && endPx) ? (endPx / anchorPx - 1) * 100 : null;
        r.peak = (anchorPx && peak) ? (peak / anchorPx - 1) * 100 : null;
        break;
      } catch (e) {
        tries++;
        if (tries >= 4) { console.log(`  ${r.token.slice(0, 10)} ticks 查询失败: ${e.message}`); r.fwd = null; r.peak = null; break; }
        await sleep(1500 * tries);
      }
    }
    await sleep(60);
  }
  // 分层汇总
  const layers = { 'deepBreak(<-10)': r => r.minVs != null && r.minVs < -10, 'break[-10,0]': r => r.minVs != null && r.minVs >= -10 && r.minVs <= 0, 'shallow(0,10]': r => r.minVs != null && r.minVs > 0 && r.minVs <= 10, 'noBreak(>10)': r => r.minVs != null && r.minVs > 10, 'null': r => r.minVs == null };
  console.log('\n===== 分层汇总（per-token 首拒行锚，锚后 30min）=====');
  console.log('层            票数  有数据  正票率   中位fwd   ≥+50%  ≥+100%  ≤-30%  Σpeak');
  for (const [name, fn] of Object.entries(layers)) {
    const arr = all.filter(r => r.first && fn(r));
    const valid = arr.filter(r => r.fwd !== null);
    if (!arr.length) { console.log(`${name.padEnd(13)} 0`); continue; }
    const pos = valid.filter(r => r.fwd > 0).length;
    const sorted = valid.map(r => r.fwd).sort((a, b) => a - b);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const g50 = valid.filter(r => r.peak >= 50).length, g100 = valid.filter(r => r.peak >= 100).length, d30 = valid.filter(r => r.fwd <= -30).length;
    const sumPeak = valid.reduce((s, r) => s + (r.peak || 0), 0);
    console.log(`${name.padEnd(13)} ${String(arr.length).padStart(4)} ${String(valid.length).padStart(6)} ${valid.length ? (100 * pos / valid.length).toFixed(0) + '%' : '-'}   ${med != null ? med.toFixed(1) : '-'}   ${String(g50).padStart(4)}   ${String(g100).padStart(4)}  ${String(d30).padStart(4)}  ${sumPeak.toFixed(0)}`);
  }
  // 深破+破发档的 ≥+100% 右尾票明细
  console.log('\n===== 右尾明细 FP26（minVs≤0 ∧ peak≥+100%）=====');
  for (const r of all.filter(x => x.first && x.minVs != null && x.minVs <= 0 && (x.peak || 0) >= 100)) {
    console.log(`  ${r.token} [${r.win}] minVs=${r.minVs} fwd=${r.fwd.toFixed(1)}% peak=${r.peak.toFixed(1)}%`);
  }
  console.log('\n===== 深跌明细（minVs≤0 ∧ fwd≤-30%）=====');
  for (const r of all.filter(x => x.first && x.minVs != null && x.minVs <= 0 && x.fwd !== null && x.fwd <= -30).slice(0, 20)) {
    console.log(`  ${r.token} [${r.win}] minVs=${r.minVs} fwd=${r.fwd.toFixed(1)}%`);
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
