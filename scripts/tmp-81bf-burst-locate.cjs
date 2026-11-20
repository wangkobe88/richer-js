#!/usr/bin/env node
// 0x81bf burst 定位 v3：全量 signals metadata 摘要 + burst 波钱包提取
const { dbManager } = require('../src/services/dbManager');
const TOKEN = '0x81bf04448ad0b72258ab5d9e0a1f77e59cdf7777';
const EXP = 'd3453504-03d5-480c-89e0-483db930361c';

function pick(o, re) { const r = {}; for (const k of Object.keys(o || {})) if (re.test(k)) r[k] = o[k]; return r; }

async function main() {
  const sb = dbManager.getClient();
  const { data: sig, error } = await sb.from('strategy_signals')
    .select('created_at,signal_type,action,executed,confidence,reason,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('created_at', { ascending: true }).limit(30);
  if (error) throw error;
  console.log(`signals 行数=${sig.length}`);
  for (const s of sig) {
    const m = s.metadata || {};
    console.log(`\n=== ${s.created_at} ${s.signal_type} executed=${s.executed} conf=${s.confidence} reason=${(s.reason || '').slice(0, 60)}`);
    const af = m.actFrontGate || {};
    if (Object.keys(af).length) {
      console.log(`  actFront: path=${af.path} act=${af.activityLevel} sbw=${af.levels?.stallBurstWave}`);
      console.log(`  af.levels.burst: ${JSON.stringify(pick(af.levels || {}, /burst/i))}`);
    }
    const cc = m.cheatCheck || {};
    const info = cc.info || {};
    if (Object.keys(info).length) {
      console.log(`  cheat: ${info.status}/${info.grade} act=${info.levels?.activityLevel} sbw=${info.levels?.stallBurstWave}`);
      console.log(`  cheat.anchors.burst: ${JSON.stringify(pick(info.anchors || {}, /burst/i))}`);
    }
    const bp = m.buyPoint || {};
    if (Object.keys(bp).length) {
      const bi = bp.info || bp;
      console.log(`  bp: ${bp.status ?? bi.status}/${bi.bucket ?? bp.bucket} rule=${bi.rule ?? bp.rule}`);
    }
    const fk = m.factorCheck || {};
    if (Object.keys(fk).length) console.log(`  factorCheck: ${JSON.stringify(pick(fk, /status|rule|blocked/i))} raw=${JSON.stringify(fk).slice(0, 200)}`);
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
