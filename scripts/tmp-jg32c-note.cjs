#!/usr/bin/env node
// JG-32c 登马甲票备注追加（两提案四窗重放结论）。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TAG = 'JG-32c';
const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
const APPEND = '；JG-32c（2026-11-22，用户「低价+承接赌局」「首波卖光+后波持有豁免」两提案四窗重放）：登马甲双中 A1+B 形状；发现①B 形状触发面跨窗真实存在（四窗 24 张 20/2/1/1，推翻零样本前提）②EV 判别力否证——B 组 +713% 全由本票贡献，其余 23 张 −8.9%/票三冷窗全负，「后波持有大户」≠看好散户（丁真/牢大/女大/麦麦后波持 3~5 家照样 −22~−38）③出口损耗 53pt/票新瓶颈（B 组非本票 max60 均 +43 vs stall −10=峰值都在断流卖半山腰）。豁免不立法维持 JG-2；新增用户裁定项=B 形状 0.05B 彩票臂灰度（四窗 ROI+30% 但 100% 单票贡献）+持有侧出口改进观察';
(async () => {
  const sb = dbManager.getClient();
  const WRITE = process.argv.includes('--write');
  const { data: cur, error } = await sb.from('case_collection_tokens')
    .select('id,note').eq('collection_id', COLL).eq('token_address', TOKEN).limit(1);
  if (error) throw new Error(error.message);
  const row = (cur || [])[0];
  if (!row) throw new Error('不在集合');
  if (String(row.note || '').includes(TAG)) { console.log(`${TAG} 已含，跳过`); process.exit(0); }
  const next = (row.note ? row.note : '') + APPEND;
  if (!WRITE) { console.log('[dry]', next.length); process.exit(0); }
  const { error: e2 } = await sb.from('case_collection_tokens').update({ note: next }).eq('id', row.id);
  if (e2) throw new Error(e2.message);
  const { data: back } = await sb.from('case_collection_tokens').select('note').eq('id', row.id).limit(1);
  console.log('回读对账:', (back[0].note||'').includes(TAG) ? '✓' : '✗');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
