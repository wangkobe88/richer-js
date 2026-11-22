#!/usr/bin/env node
// JG-33 登马甲票备注追加（a8414632），保留原 note。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TAG = 'JG-33';
const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
const APPEND = '；JG-33（2026-11-22，用户观点「快速 sniper 已跑+几个看好的用户买入承接，不算坏事；前两个入场钱包已跑路」）：FP32 基数 0.8302 逐钱包核验=5 钱包构成，前两个入场（0xf484 10s 入 17s 跑倒赚/0x94af 15s 入 29s 跑已闭合）信号时刻确已跑路=观察精确成立；但在场 3 个（0xe90d/0xf204/0x51a8，基数 76%）也是信号后 9~19s 快闪全清仓，真承接者（0x95e 净持 0.402/0xf0ce 0.396 全持/0x4a48 等 0.297×3 全持）05:50:36 后才进场=FP32 判定时刻不可见，且 B 组承接者回收率 147% 终局零持仓（波段客非长期看好）；口径主张=已闭合 sniper 往返不该算点火基数（FP41 实体口径=忠实度量同理念），净口径 0.830−0.197=0.594<0.79 档→本票不拦→+918%；真确的核=sniper 17s/29s 已砸过一轮价格仍坚挺 +23%＝FP32 推迟想等的「砸不砸」答案盘面已提前给出（砸了被接住）；统计约束=JG-2 v3 已含大户净持>50% 腿（本票 71.6% 满足）四窗否证核心=别窗无票，净口径≈v3 近亲预期翻转面集中 w1003；用户裁定先留档不开净口径四窗验证，无机制动作';
(async () => {
  const sb = dbManager.getClient();
  const WRITE = process.argv.includes('--write');
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLL).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('登马甲 不在集合');
  if (String(row.note || '').includes(TAG)) { console.log(`${TAG} 已含，跳过`); process.exit(0); }
  console.log(`原 note (${String(row.note || '').length} 字): ${row.note}`);
  const next = (row.note ? row.note : '') + APPEND;
  if (!WRITE) { console.log('\n[dry] 将写入:', next); process.exit(0); }
  const { error: e2 } = await sb.from('case_collection_tokens').update({ note: next }).eq('id', row.id);
  if (e2) throw new Error(e2.message);
  const { data: back } = await sb.from('case_collection_tokens').select('note').eq('id', row.id).limit(1);
  console.log('回读对账:', (back[0].note||'').includes(TAG) && (back[0].note||'').includes('净口径 0.594') ? '✓ 通过' : '✗ 失败');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
