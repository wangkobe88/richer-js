#!/usr/bin/env node
// JG-32b 登马甲票备注追加（流量接力对倒框架）。--write 才落库。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
const COLL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const TAG = 'JG-32b';
const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';
const APPEND = '；JG-32b（2026-11-22，用户「流量接力对倒」框架）：上升链=三波等额双钱包对波次接力（A 0.198×2+0.066×2/B 0.3465×2/C 0.2575×2+0.1155×2 秒级轮换），15.1B 卖压全程被吸收=「高位卖出正常、有下一棒」成立；框架已赢卖出侧（stallClose 胜大户离场卖臂=接力断裂才是顶）；FP32 批评落点准（供给方存在性判据不测接力）但买侧三障碍=事前接力零显影（信号时刻 9 钱包全 0.1B+，散户 05:50:42 才首现）+round2 小户买入反向分离+base rate 1/4 窗；框架对判据错位，无机制动作';
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
  if (!WRITE) { console.log('[dry] 长度', next.length); process.exit(0); }
  const { error: e2 } = await sb.from('case_collection_tokens').update({ note: next }).eq('id', row.id);
  if (e2) throw new Error(e2.message);
  const { data: back } = await sb.from('case_collection_tokens').select('note').eq('id', row.id).limit(1);
  console.log('回读对账:', (back[0].note||'').includes(TAG) ? '✓' : '✗');
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
