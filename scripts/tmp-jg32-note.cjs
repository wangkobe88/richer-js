#!/usr/bin/env node
// JG-32 登马甲票备注追加（a8414632），保留原 note。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TAG = 'JG-32';
const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
const APPEND = '；JG-32（2026-11-22，用户质疑「大户买入是否一定要推迟」深度复核）：bt-v177（v1 包）05:50:32 唯一信号 FP 双臂拒 big_buy_defer+launch_fail_dead；信号价入场回撤仅 +6.9% 此后未回入场价（「点位不差」坐实）；新取证=A组建仓组回收率207%/B拉起组147%终局均零持仓（31s 建仓→拉起→派发流水线，「盘面干净」=他们在建仓不在派发）；三重锁死=推迟窗覆盖黄金买点（拉起在信号后4s，任何>0推迟=错过）+BP位置门封死晚买通道+fpRetry 30s地平线<45s解锁线结构性救不了（T203 修瞬间误拦非时间窗拦截）；维持 JG-2 四窗否证不立法（域内不推迟EV为负），FP32 在集合错失面仅1/30 vs act族17/30';
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
  console.log('回读对账:', (back[0].note||'').includes(TAG) && (back[0].note||'').includes('回收率207%') ? '✓ 通过' : '✗ 失败');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
