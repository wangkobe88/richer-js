'use strict';
// JG-17 备注落库：0xe4e4（喵蛙）金狗集合 a8414632 note 追加用户观点+核验档
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xe4e4149ed653e10d45d640f14445ae744ffb7777';
const APPEND = '；JG-17（2026-11-22，用户观点「可买入价格区间活跃度低」已核验）：bt-v164 97s 内 6 BUY 信号（P10/P1/P1/P2/P3/P4）零成交——act 族三拦（act_near_dead：临近中位 0.033~0.05B∧吞吐 0.48~0.87B/min）+P2 过 FP 后死 AF1 reject_low（act=low）+cd400/cd403 低承接二拦（卖方 9 承接比 0.13/0.27）+fam_holding 二拦（自卖比 0 总买 3.2B chg30 −21.8%）。锚前 ATH +75.6% 先冲高后回落，回落承接真空期=可买区间内临近段死寂，后续 >500%（第二批金狗）。与 JG-14 铁匠同族（活跃度/买入域错开）；ath75.6<80=T205 阶段放行（灰度未开）的理论放行面。攒批不立法';
(async () => {
  const sb = dbManager.getClient();
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('token 不在集合');
  if (String(row.note || '').includes('JG-17')) { console.log('已含 JG-17，跳过'); process.exit(0); }
  const next = (row.note || '') + APPEND;
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: next }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  // 回读对账
  const { data: back } = await sb.from('case_collection_tokens')
    .select('note').eq('id', row.id).limit(1);
  const ok = back && back[0] && String(back[0].note).includes('JG-17');
  console.log(ok ? '✅ JG-17 备注已落（回读对账通过）' : '❌ 回读失败');
  console.log('note 长度:', (back && back[0] && back[0].note || '').length);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
