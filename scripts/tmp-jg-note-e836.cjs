#!/usr/bin/env node
/**
 * 一次性脚本（本地小结果读写）：金狗集合 a8414632 给 0xe836…7777 追加备注
 * 用户观点 2026-11-21：「这个只能开启第二次交易才能吃到大涨幅」
 * 保留原 note，追加观点段。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0xe83626c404ee63b68ae2a7cdb17fd7d4d2c77777';
const VIEWPOINT = '用户观点（2026-11-21）：只能开启第二次交易才能吃到大涨幅';
const DRY = process.argv.includes('--dry');

async function main() {
  const c = dbManager.getClient();
  const { data: member, error: mErr } = await c.from('case_collection_tokens')
    .select('token_address, platform, sync_state, note, token_meta')
    .eq('collection_id', COLLECTION_ID).eq('token_address', ADDR).maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!member) throw new Error('成员不在金狗集合中: ' + ADDR);
  const meta = member.token_meta || {};
  console.log(`成员在位: ${meta.symbol || '?'} platform=${member.platform} sync_state=${member.sync_state}`);
  console.log(`原 note: ${member.note || '(空)'}`);

  const newNote = member.note
    ? `${member.note}；${VIEWPOINT}`
    : VIEWPOINT;
  console.log(`新 note: ${newNote}`);
  if (DRY) { console.log('[dry] 未写入。'); return; }

  const { data: upd, error: uErr } = await c.from('case_collection_tokens')
    .update({ note: newNote })
    .eq('collection_id', COLLECTION_ID).eq('token_address', ADDR)
    .select('token_address, note').single();
  if (uErr) throw new Error(uErr.message);
  console.log(`已写入。note=${upd.note}`);
}

main().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
