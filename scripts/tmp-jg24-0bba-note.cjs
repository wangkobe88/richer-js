#!/usr/bin/env node
/**
 * 一次性脚本（本地小结果读写）：金狗集合 a8414632 给 0x0bba…7777（猪五花·扁头）追加 JG-24 备注。
 * 用户提问 2026-11-22「前期没买入的原因」→ 已核验：9 钱包 0.110B 等额簇 5s 闪拉穿域（T135 抢速门拦）
 * →46s 同块全清砸 −9.46%（holders 崩 0，与回拉进域窗错位）→+603% 穿全部买域 → 8h 残局唯一触发 FP 五臂拒。
 * 保留原 note，追加段。用后可删。
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../config/.env') });
const { dbManager } = require('../src/services/dbManager');

const COLLECTION_ID = 'a8414632-7c24-4762-9253-c49bb0f53105';
const ADDR = '0x0bba00ba64c147a6477fd18720b782a640357777';
const VIEWPOINT = 'JG-24 前期无信号复盘（2026-11-22）：9 钱包 0.110B 等额簇 5s 闪拉穿域（T135 抢速门+开盘簇门拦）→46s 同块全清砸 −9.46% holders 崩 0（与回拉进域窗错位）→+603% 穿全部买域→8h 残局唯一触发 FP 五臂拒（holder_scatter/even_split_crew/act_low/tail_no_buyer/tail_activity）；三道防线按设计工作非 bug';
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
