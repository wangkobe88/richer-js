#!/usr/bin/env node
// 一次性：金狗集合 a8414632 ZKind(0xa79e…7777) 票备注追加（JG-31），保留原 note。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TAG = 'JG-31';
const TOKEN = '0xa79e736482f55c89e42000151e04af630f2b7777';
const APPEND = '；JG-31（2026-11-22，用户提问「豁免等额分仓门」三轮收敛立法）：bt-v177 12:15:20 唯一信号被 FP22 双贴线拒（HHI0.099/流通17.3）——成因≠立法语义：开盘 0.938B 砸盘派发给 0.1B 级接刀者+165s 沉寂后新簇点火，锚同块 blk4567 六钱包 0.1B 档全走 GMGN 路由（to=0x1de460f3 gas 全 1M 六路独立滑点，等额/等量指纹判不出）；散户 HHI 0.0746→同首买块合并 0.3475（51% 实体）=新实体接管主力盘非均分残局。立法 T207/FP41（捆绑购买=一个钱包：实体 HHI≥0.10 豁免腿）；全域两窗豁免面 43 行 fwdPeak 中位 +10.8 vs 照拦 +1.7 零深亏峰，单臂放行 4 行本尊 +256% 最肥。遗留：bt-v177 相位 BP 位置门（curVs≈40.4）接棒该行仍买不进（实跑相位可达）。全档=金狗台账 JG-31+交易台账 T207';
(async () => {
  const sb = dbManager.getClient();
  const WRITE = process.argv.includes('--write');
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLL).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('ZKind 不在集合');
  if (String(row.note || '').includes(TAG)) { console.log(`${TAG} 已含，跳过`); process.exit(0); }
  console.log(`原 note (${String(row.note || '').length} 字): ${row.note}`);
  const next = (row.note || '') + APPEND;
  if (!WRITE) { console.log('dry-run（--write 落库）'); process.exit(0); }
  const { error: upErr } = await sb.from('case_collection_tokens')
    .update({ note: next }).eq('id', row.id);
  if (upErr) throw new Error(upErr.message);
  const { data: back } = await sb.from('case_collection_tokens')
    .select('note').eq('id', row.id).limit(1);
  console.log('回读对账:', back[0].note.includes(TAG) ? '✅ 含 JG-31' : '❌ 未写入');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
