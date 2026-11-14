// 一次性取证（182 跑）：ba5e/ea78/258e 在 v98 的信号 metadata 细节——
// cheat 拒绝细节（grade/activityLevel/exempt/exemptDenied/levels/anchors burst 三键）
// + 258e 的 BP assessment 全文（为何没判 crash）。
const { dbManager } = require('../../src/services/dbManager.js');

const V98 = 'fe029df4-cd1f-490c-bfaf-f945feed287b';
const V97 = 'afe7faa8-bb8b-4b40-b57e-35000f3ad472';
const ROWS = [
  { key: 'ba5e', exp: V98, addr: '0xba5ed45b42479e0a75316de7bf990ec90a3e4444' },
  { key: 'ea78', exp: V98, addr: '0xea7886d590ba1d7d6d4e7761148ba26405c67777' },
  { key: '258e', exp: V98, addr: '0x258e485725b8d799b885b9f079241e2c812d7777' },
  { key: '258e-v97成交锚', exp: V97, addr: '0x258e485725b8d799b885b9f079241e2c812d7777' },
];

async function main() {
  const client = await dbManager.getClient();
  for (const r of ROWS) {
    const { data, error } = await client.from('strategy_signals')
      .select('id,created_at,metadata')
      .eq('experiment_id', r.exp).eq('token_address', r.addr)
      .eq('signal_type', 'BUY').order('created_at', { ascending: true }).limit(12);
    if (error) { console.log(`${r.key} err ${error.message}`); continue; }
    console.log(`\n########## ${r.key} ##########`);
    for (const row of (data || [])) {
      const md = row.metadata || {};
      const cc = md.cheatCheck || {};
      const bp = md.buyPoint || {};
      const lines = [];
      lines.push(`${row.created_at.slice(5, 19)} leg=${(md.signalGate || {}).legId || '?'}`);
      if (cc.status || cc.grade) {
        lines.push(`  cheat: status=${cc.status} grade=${cc.grade} act=${cc.activityLevel ?? '-'}` +
          ` exempt=${JSON.stringify(cc.exempt) ?? '-'} denied=${cc.exemptDenied ?? '-'}` +
          ` cached=${cc.cached ?? '-'} reasons=${JSON.stringify(cc.reasons || [])}`);
        const lv = cc.levels || {};
        const lvk = Object.entries(lv).filter(([k, v]) => v && v !== 'none').map(([k, v]) => `${k}=${v}`).join(' ');
        if (lvk) lines.push(`  levels 非 none: ${lvk}`);
        const an = cc.anchors || {};
        const pick = ['burstMaxGapSec', 'burstWaveBuyBnb', 'burstWaveWallets', 'burstWaveStartVsLaunchPct', 'stallBurstWave', 'tickCount', 'spanSec'];
        const anstr = pick.filter((k) => an[k] != null).map((k) => `${k}=${an[k]}`).join(' ');
        if (anstr) lines.push(`  anchors: ${anstr}`);
      }
      const a = bp.assessment || {};
      if (bp.status || a.bucket) {
        lines.push(`  bp: status=${bp.status} 综=${a.bucket}(${a.rule})`);
        const dims = bp.dimensions || {};
        for (const [k, v] of Object.entries(dims)) {
          if (v && v.bucket) lines.push(`    ${k}=${v.bucket}(${v.prob != null ? Number(v.prob).toFixed(2) : '?'})`);
        }
        const an = bp.anchors || {};
        const pick = ['currentVsLaunchPct', 'minVsLaunchPct', 'athVsLaunchPct', 'chg5Pct', 'chg10Pct', 'chg30Pct', 'curVsAthPct', 'curVsMinGapPct', 'nearMaxDn5Pct'];
        const anstr = pick.filter((k) => an[k] != null).map((k) => `${k}=${an[k]}`).join(' ');
        if (anstr) lines.push(`    anchors: ${anstr}`);
      }
      console.log(lines.join('\n'));
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
