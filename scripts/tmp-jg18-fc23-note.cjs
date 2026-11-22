'use strict';
// JG-18 备注落库：0xfc23（一姐）金狗集合 a8414632 note 追加
require('dotenv').config({ path: require('path').join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLLECTION = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TOKEN = '0xfc23bfc0371d8296d26d034a4e8b155661a57777';
const APPEND = '；JG-18（2026-11-22，signals 页复盘「23:43:02 无信号」已核验）：全票仅 2 信号——15:42:04/15:42:32 两笔 P1（buy_0_1 预算 2/2）全被 FP 拒（holder_quiet_unload：top5卖 0.151B/ath39.9% → tail_dip_knife：chg30 −32.8% 崩塌进行时）。15:43:02（本地 23:43:02）主升第一秒 7 笔 burst 0.76B 全新钱包（5 个在跟单/女巫簇名单+1 famous），FA 真重放证明 P9（无 ExDust 门）在 burst 第 2~4 笔 tick 条件全 true、P2（ExDust≥6）第 3~4 笔 true——真窗存在；但回测 T154 所有买腿统一 debounce（2026-11-17 裁定撤销 per-tick），同秒 burst 合并后 advance 末笔重读因子 curVs=32.2 已出 28.5 域 → 14 腿全 false，条件窗被吞；后续 burst 末笔 36.3/41.1 全出域，+350% 毕业永无回落。与 T132 立项动机（ea78「真窗只存在于一笔 tick」）同形状——实时侧 per-tick 缺省开会触发、回测侧结构性失明。攒批不立法';
(async () => {
  const sb = dbManager.getClient();
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLLECTION).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('token 不在集合');
  if (String(row.note || '').includes('JG-18')) { console.log('已含 JG-18，跳过'); process.exit(0); }
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: (row.note || '') + APPEND }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  const { data: back } = await sb.from('case_collection_tokens')
    .select('note').eq('id', row.id).limit(1);
  const ok = back && back[0] && String(back[0].note).includes('JG-18');
  console.log(ok ? '✅ JG-18 备注已落（回读对账通过）' : '❌ 回读失败');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
