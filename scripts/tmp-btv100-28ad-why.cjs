// 一次性（182 跑）：bt-v100 里 28ad（restart 立法票）拒绝原因取证
const { dbManager } = require('../src/services/dbManager.js');
(async () => {
  const c = await dbManager.getClient();
  const { data, error } = await c.from('strategy_signals')
    .select('id,signal_type,created_at,metadata,executed')
    .eq('experiment_id', '11fc182a-b051-4665-857c-5c14e6713334')
    .eq('token_address', '0x28ad2c7d08d83a85467bd4afcfd673dfce564444')
    .order('id');
  if (error) throw new Error(error.message);
  console.log(`28ad 信号行：${data.length}`);
  for (const s of data) {
    const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata) : s.metadata || {};
    console.log(`\n--- ${s.signal_type} @${s.created_at} executed=${s.executed} status=${m.execution_status} leg=${m.strategyName}`);
    const tf = m.trendFactors || {};
    console.log(`factors: curVs=${tf.currentVsLaunchPct} tradeCount=${tf.tradeCount} buyVol=${tf.buyVolumeBnb} holders=${tf.holdersExDust} actTotalBnb=${tf.actTotalBnb} age=${tf.tokenAgeSec}`);
    const cc = m.cheatCheck;
    if (cc) {
      console.log(`cheat: grade=${cc.grade}${cc.exempt ? ' 豁免←' + cc.exempt.originalGrade + ' code=' + cc.exempt.code : ''}${cc.exemptDenied ? ' denied=' + JSON.stringify(cc.exemptDenied) : ''} status=${cc.status} reasons=${JSON.stringify(cc.gradeReasons || cc.reasons || '').slice(0, 200)}`);
      const info = cc.info || {};
      if (info.levels) console.log(`  levels: sbw=${info.levels.extLevels && info.levels.extLevels.stall_burst_wave} pump=${info.levels.extLevels && info.levels.extLevels.slow_grind_pump} spike=${info.levels.extLevels && info.levels.extLevels.burst_spike_concentration} act=${info.levels.activityLevel}`);
      if (info.buckets) console.log(`  buckets: ${JSON.stringify(info.buckets).slice(0, 300)}`);
    }
    const bp = m.buyPoint;
    if (bp) {
      const a = bp.assessment || {};
      console.log(`BP: bucket=${a.bucket}(${a.prob}) rule=${a.rule}`);
      const dims = bp.dimensions || {};
      for (const k of Object.keys(dims)) {
        const d = dims[k] || {};
        if (d.bucket != null) {
          let ex = '';
          if (d.exempt) ex = ` exempt=${JSON.stringify(d.exempt)}`;
          console.log(`  ${k}=${d.bucket}(${d.prob})${ex}`);
        }
      }
      const sg = m.signalGate || {};
      if (sg.triggerNo != null) console.log(`signalGate: triggerNo=${sg.triggerNo}`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
