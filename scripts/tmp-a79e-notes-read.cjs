#!/usr/bin/env node
/**
 * 一次性读取脚本：①金狗集合 30 票备注（用户观点记录源）②bt-v164 0xf38f…7777 全信号行+metadata（大户门拒因取证）
 * 小结果读取，本地可跑。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105'; // 大金狗-尽量保证买入
const EXP_ID = '9e9163de-a677-4d39-9c33-9ec9df05e400'; // bt-v164
const TOKEN = '0xf38f48cfe9e84920e7de4d47823a0fba95a87777';

(async () => {
  const db = dbManager.getClient();

  // 1) 金狗集合 tokens + 备注
  const tokRes = await db.from('case_collection_tokens')
    .select('token_address, note, sync_state, tick_count')
    .eq('collection_id', COLLECTION_ID)
    .order('added_at', { ascending: true });
  if (tokRes.error) throw new Error(tokRes.error.message);
  console.log('=== 金狗集合备注 (%d 票) ===', tokRes.data.length);
  for (const t of tokRes.data) {
    console.log(`${t.token_address}\t${(t.note || '').replace(/\n/g, ' ⏎ ')}`);
  }

  // 2) 0xf38f…7777 信号行（含 metadata）
  const sigRes = await db.from('strategy_signals')
    .select('id, created_at, signal_type, action, reason, executed, metadata')
    .eq('experiment_id', EXP_ID)
    .eq('token_address', TOKEN)
    .order('created_at', { ascending: true })
    .limit(50);
  if (sigRes.error) throw new Error(sigRes.error.message);
  console.log('\n=== 0xf38f…7777 信号 %d 行 ===', sigRes.data.length);
  for (const s of sigRes.data) {
    console.log(`\n--- ${s.created_at} type=${s.signal_type} action=${s.action} status=${s.status} reason=${s.reason}`);
    if (s.metadata) console.log(JSON.stringify(s.metadata, null, 1));
  }
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
