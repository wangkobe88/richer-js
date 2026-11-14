// 一次性探针（182 跑）：dc191037 完整 metadata dump——定位用户看到的「high」在哪一段（cheatCheck/act 展示链）。
const { dbManager } = require('../../src/services/dbManager.js');

const EXP = '675c71a1-0e19-49b6-924b-facffc073afd';
const TOKEN = '0xdc1910375c1c1c3d0c25c13ee6e5f2bec1887777';

async function main() {
  const client = await dbManager.getClient();
  const { data: sigs, error } = await client.from('strategy_signals')
    .select('id,created_at,signal_type,metadata')
    .eq('experiment_id', EXP).eq('token_address', TOKEN)
    .order('id', { ascending: true }).limit(10);
  if (error) throw new Error(error.message);
  for (const s of sigs || []) {
    console.log(`\n===== ${s.created_at} ${s.signal_type} =====`);
    const md = s.metadata || {};
    for (const k of Object.keys(md)) {
      if (k === 'buyPoint') { console.log(`[buyPoint] 综=${md.buyPoint.assessment && md.buyPoint.assessment.bucket}（已诊断，跳过全文）`); continue; }
      console.log(`[${k}]=${JSON.stringify(md[k]).slice(0, 1800)}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
