#!/usr/bin/env node
// 一次性：读金狗集合成员+备注（30 行小查询，本地可跑）。用后可删。
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');
(async () => {
  const db = dbManager.getClient();
  const { data, error } = await db.from('case_collection_tokens')
    .select('token_address, note, sync_state, added_at')
    .eq('collection_id', 'a8414632-7c24-4762-9253-c49bb0f53105')
    .order('added_at', { ascending: true });
  if (error) throw new Error(error.message);
  console.log(`共 ${data.length} 票：`);
  for (const r of data) {
    console.log(`\n=== ${r.token_address} (sync=${r.sync_state}, added=${r.added_at})`);
    console.log(`备注: ${r.note || '(空)'}`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
