'use strict';
// JG-15 备注落库：GWC 0xb712 金狗集合 a8414632 note 追加补档留痕（缺口占位）
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xb71209cbe0ba47afdbc0201f2d2647e9919b7777';
const APPEND = '；JG-15（2026-11-22 补档留痕，留待继续解决）：本票=T205/FP35 立法案源——死盘 56min（top1 100% 独仓/67min 零卖出）→0.84B 真金复活→4 笔尘埃卖 0.164B 空簿打出 −6% 被 tail_dip_knife+act_low 双拦，锚后 +932% 毕业；用户两原则立法（act low 阶段前提 ATH<80 让位+tail_dip 量腿锚前 30s 卖额≥0.3B，三灰度键缺省 false）+同原则贯通 AF1/cheat E 通道；T205b 三反锚落而复撤（FP38，本票=A 腿知情代价留痕，重放中本就死 FP27 轻出货臂）。原实施会话未同步台账（金狗 JG-15/交易 T205 双缺）2026-11-22 已占位补档待复核补全，全档=金狗台账 JG-15+交易台账 T205/T205b';
(async () => {
  const sb = dbManager.getClient();
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('token 不在集合');
  console.log('原 note:', row.note || '(空)');
  if (String(row.note || '').includes('JG-15')) { console.log('已含 JG-15，跳过'); process.exit(0); }
  if (!process.argv.includes('--write')) { console.log('\n[dry] 将追加:', APPEND); process.exit(0); }
  const next = (row.note || '') + APPEND;
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: next }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  const { data: back } = await sb.from('case_collection_tokens')
    .select('note').eq('id', row.id).limit(1);
  const ok = back && back[0] && String(back[0].note).includes('JG-15');
  console.log(ok ? '✅ JG-15 备注已落（回读对账通过）' : '❌ 回读失败');
  console.log('note 长度:', (back && back[0] && back[0].note || '').length);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
