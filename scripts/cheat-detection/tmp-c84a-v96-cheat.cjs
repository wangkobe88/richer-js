// 一次性（182 跑）：v96 c84a 12:31:39 成交锚的 cheatCheck 判读（对照 v100 同位锚 act=mid 拉黑）。
const { dbManager } = require('../../src/services/dbManager.js');
const V96 = 'e582e873-7f1a-44a5-b50f-0fca576847be';
const T = '0xc84a0ff2e7bab3d32cb6426f07855b70694f7777';
async function main() {
  const sb = await dbManager.getClient();
  const { data: rows } = await sb.from('strategy_signals')
    .select('created_at,metadata').eq('experiment_id', V96).eq('token_address', T).order('created_at');
  for (const r of rows || []) {
    const m = r.metadata || {};
    const cc = m.cheatCheck || {};
    const ex = cc.exempt || {};
    console.log(`${r.created_at.slice(5, 19)} cheat=${cc.grade || '-'}@${cc.status || '-'}${ex.code ? ' 豁免=' + ex.code + '(原判' + ex.originalGrade + ')' : ' 无豁免'} reasons=${(cc.reasons || []).join(';') || '-'} act=${cc.activityLevel || cc.act || '-'}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e && e.stack || e); process.exit(1); });
