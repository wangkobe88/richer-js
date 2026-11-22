'use strict';
// JG-16 备注落库：0x2ee9（躺赢人生）金狗集合 a8414632 note 追加 T198b 立法案源档
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0x2ee9458681c134e9c7cd933b7af94be50a1f7777';
const APPEND = '；JG-16/T198b 立法案源（2026-11-21，已核验）：06:50 两触发被 arb_bot_holdings 拒（机器持筹 31.47→35.18%/3户）——实为两镜像 sandwich_bot（0xedcbcc31…/0x073c01e7…等额同块差 ~30 log 位双开机）刚 load 完货的瞬时库存，06:55:30 双砸 0.39B@2.2×、07:03:56 顶部区再砸@~5×，全天往返非坐筹死盘；流通仅 13.7/14.5%（机器占总供应≈4.8% 砸不深），锚后 ~6.9×（峰 4.33e-8@07:03）。立法=FP36 流通腿豁免（持筹≥30 ∧ 流通≥16.5 才拦，<16.5 豁免；四窗深跌分离放回面 0 票 ≤−30% vs 保留面 15 票），台账交易 T198b';
(async () => {
  const sb = dbManager.getClient();
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('token 不在集合');
  if (String(row.note || '').includes('JG-16')) { console.log('已含 JG-16，跳过'); process.exit(0); }
  const next = (row.note || '') + APPEND;
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: next }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  // 回读对账
  const { data: back } = await sb.from('case_collection_tokens')
    .select('note').eq('id', row.id).limit(1);
  const ok = back && back[0] && String(back[0].note).includes('JG-16/T198b');
  console.log(ok ? '✅ JG-16 备注已落（回读对账通过）' : '❌ 回读失败');
  console.log('note 长度:', (back && back[0] && back[0].note || '').length);
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message, e); process.exit(1); });
