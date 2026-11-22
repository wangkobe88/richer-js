'use strict';
// JG-6f 备注落库：0xc0e8（쿠우타）金狗集合 a8414632 note 追加「接刀门已豁免」核验档
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xc0e896ddec43881055a25786c17fa5d5d6337777';
const APPEND = '；JG-6f（2026-11-22，用户观点「接刀门应该已经豁免了」已核验）：FP34 转正（default tailDipOrganicExempt=true，2026-11-21）后对拍臂 bt-v169 两笔 tail_dip_knife 拦行（02:30:40 P1/02:33:46 P10）均 verdict.tailDipExempt=organic 豁免生效，bt-v164 信号页所见拦截=旧配置历史快照（跑中/已跑实验须重启或重跑才吃到新配置）；但豁免≠成交：02:30:40 豁免释放该臂后露下一命中臂 fam_low_exit_cooldown（FP20）拦、02:33:46 FP 全过（fcPass=true）死 AF1 act_front_low、02:31:58~02:32:09 三笔 lifecycle_sell_residual（T192 裁定不豁）——死因碎片化与 JG-6d 留档一致，全链仍未成交';
(async () => {
  const sb = dbManager.getClient();
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('token 不在集合');
  console.log('原 note:', row.note || '(空)');
  if (String(row.note || '').includes('JG-6f')) { console.log('已含 JG-6f，跳过'); process.exit(0); }
  if (!process.argv.includes('--write')) { console.log('\n[dry] 将追加:', APPEND); process.exit(0); }
  const next = (row.note || '') + APPEND;
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: next }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  // 回读对账
  const { data: back } = await sb.from('case_collection_tokens')
    .select('note').eq('id', row.id).limit(1);
  const ok = back && back[0] && String(back[0].note).includes('JG-6f');
  console.log(ok ? '✅ JG-6f 备注已落（回读对账通过）' : '❌ 回读失败');
  console.log('note 长度:', (back && back[0] && back[0].note || '').length);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
