#!/usr/bin/env node
// 一次性：金狗集合 a8414632 给 0xac50…7777 追加已核验观点备注。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COL = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0xac5055c15c1b4d166e60fefcdcbaf631a7d87777';
const VIEWPOINT = '用户观点（2026-11-21，已核验）：沉寂后对应一个超大的burst，超出了我们的购买价格——276s 无足额成交静默 → 12s 内 67 笔 16.25B 净买（25 钱包），波前 +2.1% 在位置门内、burst 首秒即越 +28.5% 上限、12s ×12.4 至 +1163%；bt-v164 零信号零成交=引擎完全未参与';

(async () => {
  const sb = dbManager.getClient();
  const { data: member, error: mErr } = await sb.from('case_collection_tokens')
    .select('note').eq('collection_id', COL).eq('token_address', ADDR).maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!member) throw new Error('成员不在集合');
  const newNote = member.note ? `${member.note}；${VIEWPOINT}` : VIEWPOINT;
  const { data: upd, error: uErr } = await sb.from('case_collection_tokens')
    .update({ note: newNote }).eq('collection_id', COL).eq('token_address', ADDR)
    .select('token_address, note').single();
  if (uErr) throw new Error(uErr.message);
  console.log('已写入:', upd.note);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
