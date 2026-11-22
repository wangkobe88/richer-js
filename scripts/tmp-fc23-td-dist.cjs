'use strict';
// tail_dip_knife 破发豁免验证①：bt-v164 (9e9163de) 被拒行 launchMinVsFloorPct 分布
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const EXP = '9e9163de-a677-4d39-9c33-9ec9df05e400';
(async () => {
  const sb = dbManager.getClient();
  // 分页拉被 FP 拒且 arms 恰好只有 tail_dip_knife（=豁免后真正放回的单臂行）的 BUY 行
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb.from('strategy_signals')
      .select('token_address,created_at,metadata')
      .eq('experiment_id', EXP).eq('signal_type', 'BUY')
      .order('created_at', { ascending: true }).range(from, from + 499);
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      const fc = (r.metadata || {}).factorCheck;
      if (fc && fc.pass === false && Array.isArray(fc.arms) && fc.arms.length === 1 && fc.arms[0] === 'tail_dip_knife') {
        rows.push({ token: r.token_address, t: r.created_at, tf: (r.metadata || {}).trendFactors || {}, arms: fc.arms });
      }
    }
    if (!data || data.length < 500) break;
    from += 500;
  }
  console.log(`tail_dip_knife 拒行总数: ${rows.length}`);
  // 分层
  const buckets = { 'deepBreak(<-10)': [], 'break(<=0)': [], 'shallow(0,10]': [], 'noBreak(>10)': [], 'null': [] };
  for (const r of rows) {
    const v = r.tf.launchMinVsFloorPct;
    if (v == null) buckets['null'].push(r);
    else if (v < -10) buckets['deepBreak(<-10)'].push(r);
    else if (v <= 0) buckets['break(<=0)'].push(r);
    else if (v <= 10) buckets['shallow(0,10]'].push(r);
    else buckets['noBreak(>10)'].push(r);
  }
  for (const [k, arr] of Object.entries(buckets)) {
    console.log(`\n[${k}] ${arr.length} 行`);
    const uniq = new Set(arr.map(r => r.token));
    console.log(`  独立票数: ${uniq.size}`);
  }
  // 深破/破发档明细（前 15）
  for (const k of ['deepBreak(<-10)', 'break(<=0)']) {
    console.log(`\n--- ${k} 明细（${buckets[k].length}）---`);
    for (const r of buckets[k].slice(0, 15)) {
      console.log(`  ${r.token.slice(0, 10)} ${r.t.slice(11, 19)} minVsFloor=${r.tf.launchMinVsFloorPct} curVs=${r.tf.currentVsLaunchPct} ath=? chg30=${r.tf.chg30Pct} arms=${JSON.stringify(r.arms)}`);
    }
  }
  process.exit(0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
