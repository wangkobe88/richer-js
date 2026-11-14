// 一次性取证（本地小查询）：ea78@v100 为何被判 spike 拒——BP68 案证据
// 用户观察：锚窗内仅两笔买入（0.136/0.16 BNB 正常额度）却被 entry_gate(spike) 拒
const { dbManager } = require('../../src/services/dbManager.js');

const V100 = 'ed113d10-8d0b-495d-b1f1-9b597f564c21';
const EA78 = '0xea7886d590ba1d7d6d4e7761148ba26405c67777';

async function main() {
  const client = await dbManager.getClient();
  const { data, error } = await client.from('strategy_signals')
    .select('id,created_at,metadata')
    .eq('experiment_id', V100).eq('signal_type', 'BUY').eq('token_address', EA78)
    .order('created_at', { ascending: true }).limit(30);
  if (error || !data) { console.log('信号行拉取失败', error); process.exit(1); }
  console.log(`== ea78@v100 BUY 行 ${data.length} 行 ==`);
  for (const s of data) {
    const m = s.metadata || {};
    const cc = m.cheatCheck || {};
    const bp = m.buyPoint || {};
    const a = bp.assessment || {};
    const dims = bp.dimensions || {};
    const dim = (k) => { const o = dims[k] || {}; return `${o.bucket}(${o.prob != null ? Number(o.prob).toFixed(2) : '?'})`; };
    console.log(`\n-- ${s.created_at} cheat=${cc.grade || '?'}(sbw=${(cc.levels && cc.levels.stallBurstWave) ?? '?'})`
      + ` BP=${bp.status || '?'} 综=${a.bucket || '?'}(${a.rule || '?'})`);
    console.log(`   entry=${dim('entry_shape')} act=${dim('activity_level')} pattern=${dim('market_pattern')}`
      + ` holder=${dim('holder_concentration')} trend=${dim('price_trend')} lvl=${dim('price_level')}`);
    const an = bp.anchors || {};
    if (Object.keys(an).length) console.log(`   anchors=${JSON.stringify(an)}`);
    const dig = bp.digest || bp.snapshotDigest || null;
    if (dig) {
      const sDig = typeof dig === 'string' ? dig : JSON.stringify(dig);
      console.log(`   digest(${sDig.length}字)首600=${sDig.slice(0, 600)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
