#!/usr/bin/env node
// 一次性：金狗集合 a8414632 릴테이(0x28ea…7777) 票备注追加（JG-22），保留原 note。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TAG = 'JG-22';
const TOKEN = '0x28ea270ad6cd7151fc2cf563079dcf4e530d7777';
const APPEND = '；JG-22（2026-11-22，用户提问「未买入原因」已核验）：3 信号全灭——05:51:49/05:51:52 P1 两触发被 tail_dip_knife 拒（ath137.6∧curVs24.4 域内 chg5 −9.75/−9.33 chg30 −38.4 崩塌进行时）、05:51:56 P2 被 cd414_dense_dump 拒（30s 卖方20 卖2.11B 净−1.56B，chg5 已翻正=同域换臂接棒），触发预算 2+1 耗尽门链后段（AF1/cheat/BP）未达。拒点即滚动最低区（curVs=minVs=24.4%）：05:52 回升→06:05:16 毕业，峰值 0.0000564=拒买点价 ×10.87。非 bug；JG-6 专题已剥洋葱=同域围堵（FP33 单臂豁免→死 FP26 tail_no_buyer；FP34 两臂→死 FP11 fam_early_flip 族，右尾 5 张已知成本裁定不再剥）；FP39/FP40 深破豁免不适用（minVs +18~24% 远在 −10 线外）、T205 域外（ath≥80）。攒批不立法。全档=金狗台账 JG-22';
(async () => {
  const sb = dbManager.getClient();
  const WRITE = process.argv.includes('--write');
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLL).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('릴테이 不在集合');
  if (String(row.note || '').includes(TAG)) { console.log(`${TAG} 已含，跳过`); process.exit(0); }
  console.log(`原 note (${String(row.note || '').length} 字): ${row.note}`);
  if (!WRITE) { console.log(`[dry] 将追加 ${APPEND.length} 字`); process.exit(0); }
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: (row.note || '') + APPEND }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  const { data: back } = await sb.from('case_collection_tokens').select('note').eq('id', row.id).limit(1);
  const ok = back && back[0] && String(back[0].note).includes(TAG);
  console.log(ok ? `✅ ${TAG} 已落（回读对账通过，长度 ${String(back[0].note).length}）` : `❌ ${TAG} 回读失败`);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
