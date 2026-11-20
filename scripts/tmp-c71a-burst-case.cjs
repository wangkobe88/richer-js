#!/usr/bin/env node
// 0xc71a 为何判 burst——查信号行 cheatCheck 轨迹 + cheat_detection 观测行 digest/state
const { dbManager } = require('../src/services/dbManager');

const EXP = 'd29420e7-9d5a-48b4-9e72-0b3dfe00c22f';
const TOKEN = '0xc71a685b7ccb5dcd119ddc889f78f048e4e37777';

(async () => {
  const client = dbManager.getClient();
  const sigs = await client.from('strategy_signals')
    .select('id,signal_type,action,created_at,executed,reason,metadata')
    .eq('experiment_id', EXP)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  if (sigs.error) throw sigs.error;
  console.log(`== signals ${sigs.data.length} 行 ==`);
  for (const s of sigs.data) {
    const md = s.metadata || {};
    const cc = md.cheatCheck || {};
    console.log(`\n--- sig ${s.id} ${s.signal_type} ${s.action} ${s.created_at} ${s.executed}`);
    if (md.signalGate) console.log('  signalGate.triggerNo=', md.signalGate.triggerNo, 'leg=', md.signalGate.legName || md.signalGate.name);
    if (md.actFrontGate) console.log('  actFront:', JSON.stringify(md.actFrontGate).slice(0, 400));
    if (Object.keys(cc).length) {
      console.log('  cheatCheck.status=', cc.status, 'grade=', cc.grade, 'reason=', cc.reason);
      if (cc.levels) console.log('  levels.stallBurstWave=', cc.levels.stallBurstWave, 'activity=', cc.levels.activityLevel);
      if (cc.levels && cc.levels.anchors) console.log('  anchors=', JSON.stringify(cc.levels.anchors));
      if (cc.reasons) console.log('  reasons=', JSON.stringify(cc.reasons));
      if (cc.exempt) console.log('  exempt=', JSON.stringify(cc.exempt));
      if (cc.buckets) console.log('  buckets=', JSON.stringify(cc.buckets));
    } else {
      console.log('  (metadata 无 cheatCheck 段)');
    }
  }

  const obs = await client.from('cheat_detection')
    .select('*')
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true });
  if (obs.error) throw obs.error;
  console.log(`\n== cheat_detection ${obs.data.length} 行 ==`);
  for (const o of obs.data) {
    console.log(`\n--- obs ${o.id} verdict=${o.verdict} grade=${o.grade} anchor=${o.anchor_time || o.created_at} qv=${o.question_version} gv=${o.grade_version}`);
    const d = o.snapshot_digest || {};
    if (d.burstLastGapSec !== undefined || d.burstWaveSegBuyBnb !== undefined) {
      const pick = {};
      for (const k of Object.keys(d)) if (/burst|Last|Seg|Sec/i.test(k)) pick[k] = d[k];
      console.log('  digest.burst族=', JSON.stringify(pick));
    }
    if (d.levels) console.log('  levels=', JSON.stringify(d.levels));
    if (d.stateText || d.state) {
      const st = d.stateText || d.state;
      const txt = typeof st === 'string' ? st : JSON.stringify(st);
      const i = txt.indexOf('停滞突发波');
      if (i >= 0) console.log('  state[停滞突发波事实行]:', txt.slice(i, i + 800).replace(/\n/g, ' | '));
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
